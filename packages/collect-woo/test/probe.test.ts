import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeWooCheckout } from '../src/index.ts';
import type { ProbeOptions, ProbeTarget } from '../src/index.ts';
import { API_BASE, createFakeShop, makeContext, obs, usd } from './fake-store.ts';

const ADD = `${API_BASE}/cart/add-item`;
const UPDATE = `${API_BASE}/cart/update-customer`;
const SHIP_TO: ProbeOptions['shipTo'] = { country: 'US', postcode: '94103', state: 'CA', city: 'San Francisco' };
const TEE_M: ProbeTarget = {
  variantId: '102',
  productId: '100',
  sku: 'TEE-BLU-M',
  url: 'https://shop.example/product/classic-tee/',
};
const OWNERSHIP = 'the checkout probe needs proof that you control this shop; see the ownership token in the documentation';

const trace = (calls: { method: string; path: string }[]) => calls.map((c) => `${c.method} ${c.path}`);

test('one target: price, shipping and landed total come from the cart, in order, on one cart token', async () => {
  const shop = createFakeShop();
  const result = await probeWooCheckout(makeContext(shop), [TEE_M], { shipTo: SHIP_TO });

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings, [
    {
      surface: 'checkout',
      scope: 'variant',
      ids: { variantId: '102', productId: '100', sku: 'TEE-BLU-M', url: TEE_M.url },
      purchasable: obs(true, 'added', ADD, 'checkout'),
      price: obs(usd(390000), '3900', `${UPDATE}#/items/0/prices/price`, 'checkout'),
      shipping: obs({ free: false, cost: usd(62000), country: 'US' }, '620', `${UPDATE}#/totals/total_shipping`, 'checkout'),
      landedTotal: obs(usd(452000), '4520', `${UPDATE}#/totals/total_price`, 'checkout'),
    },
  ]);

  assert.deepEqual(trace(shop.calls), ['GET /cart', 'POST /cart/add-item', 'POST /cart/update-customer', 'DELETE /cart/items', 'GET /cart']);
  assert.deepEqual(shop.calls[0]?.headers, {});
  assert.deepEqual(shop.calls[1]?.json, { id: 102, quantity: 1 });
  assert.deepEqual(shop.calls[2]?.json, { shipping_address: SHIP_TO, billing_address: SHIP_TO });
  for (const call of shop.calls.slice(1)) {
    assert.equal(call.headers['cart-token'], 'cart-1', `${call.method} ${call.path} carries the token`);
  }
  assert.equal(shop.cartSize('cart-1'), 0);
});

test('free shipping above the threshold reads as free with a zero cost', async () => {
  const shop = createFakeShop();
  const result = await probeWooCheckout(makeContext(shop), [{ variantId: '500' }], { shipTo: SHIP_TO });

  assert.deepEqual(result.issues, []);
  const [sighting] = result.sightings;
  assert.deepEqual(sighting?.shipping, obs({ free: true, cost: usd(0), country: 'US' }, '0', `${UPDATE}#/totals/total_shipping`, 'checkout'));
  assert.deepEqual(sighting?.landedTotal, obs(usd(890000), '8900', `${UPDATE}#/totals/total_price`, 'checkout'));
});

test('an out-of-stock target is not purchasable, carries the code as raw, and has no price', async () => {
  const shop = createFakeShop();
  const result = await probeWooCheckout(makeContext(shop), [{ variantId: '103' }], { shipTo: SHIP_TO });

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings, [
    {
      surface: 'checkout',
      scope: 'variant',
      ids: { variantId: '103' },
      purchasable: obs(false, 'woocommerce_rest_product_out_of_stock', ADD, 'checkout'),
    },
  ]);
  assert.deepEqual(trace(shop.calls), ['GET /cart', 'POST /cart/add-item', 'DELETE /cart/items', 'GET /cart']);
});

test('a target the cart refuses as not purchasable gives purchasable false with that code', async () => {
  const shop = createFakeShop();
  const result = await probeWooCheckout(makeContext(shop), [{ variantId: '401', productId: '400' }], { shipTo: SHIP_TO });

  assert.deepEqual(result.issues, []);
  assert.equal(result.sightings.length, 1);
  assert.deepEqual(result.sightings[0]?.purchasable, obs(false, 'woocommerce_rest_product_not_purchasable', ADD, 'checkout'));
  assert.equal(result.sightings[0]?.price, undefined);
  assert.equal(shop.cartSize('cart-1'), 0);
});

test('three targets in a row leave an empty cart and each target gets its own DELETE', async () => {
  const shop = createFakeShop();
  const result = await probeWooCheckout(
    makeContext(shop),
    [{ variantId: '101' }, { variantId: '102' }, { variantId: '500' }],
    { shipTo: SHIP_TO },
  );

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings.map((s) => s.ids.variantId), ['101', '102', '500']);
  assert.deepEqual(result.sightings.map((s) => s.price?.value), [usd(390000), usd(390000), usd(890000)]);
  assert.deepEqual(trace(shop.calls), [
    'GET /cart',
    'POST /cart/add-item',
    'POST /cart/update-customer',
    'DELETE /cart/items',
    'POST /cart/add-item',
    'POST /cart/update-customer',
    'DELETE /cart/items',
    'POST /cart/add-item',
    'POST /cart/update-customer',
    'DELETE /cart/items',
    'GET /cart',
  ]);
  assert.equal(shop.cartSize('cart-1'), 0);
});

test('no shipping rate gives no shipping observation and a no-shipping-rate issue', async () => {
  const shop = createFakeShop({ shippingRates: false });
  const result = await probeWooCheckout(makeContext(shop), [TEE_M], { shipTo: SHIP_TO });

  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'no-shipping-rate', message: 'no shipping rate for US on TEE-BLU-M' },
  ]);
  const [sighting] = result.sightings;
  assert.ok(sighting);
  assert.equal(sighting.shipping, undefined);
  assert.deepEqual(sighting.purchasable, obs(true, 'added', ADD, 'checkout'));
  assert.deepEqual(sighting.landedTotal, obs(usd(390000), '3900', `${UPDATE}#/totals/total_price`, 'checkout'));
});

test('update-customer failing keeps the purchasable and add-item price, and adds a probe-failed issue', async () => {
  const shop = createFakeShop({ fail: { '/cart/update-customer': 500 } });
  const result = await probeWooCheckout(makeContext(shop), [TEE_M], { shipTo: SHIP_TO });

  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'probe-failed', message: '102: update-customer failed: HTTP 500' },
  ]);
  assert.deepEqual(result.sightings, [
    {
      surface: 'checkout',
      scope: 'variant',
      ids: { variantId: '102', productId: '100', sku: 'TEE-BLU-M', url: TEE_M.url },
      purchasable: obs(true, 'added', ADD, 'checkout'),
      price: obs(usd(390000), '3900', `${ADD}#/items/0/prices/price`, 'checkout'),
    },
  ]);
  assert.equal(shop.cartSize('cart-1'), 0);
});

test('a failing add-item is a probe-failed issue with no sighting, and the cart is still emptied', async () => {
  const shop = createFakeShop({ fail: { '/cart/add-item': 500 } });
  const result = await probeWooCheckout(makeContext(shop), [TEE_M], { shipTo: SHIP_TO });

  assert.deepEqual(result.sightings, []);
  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'probe-failed', message: '102: add-item returned HTTP 500', locator: ADD },
  ]);
  assert.deepEqual(trace(shop.calls), ['GET /cart', 'POST /cart/add-item', 'DELETE /cart/items', 'GET /cart']);
});

test('a missing cart token is probe-failed and no write is attempted', async () => {
  const shop = createFakeShop({ missingCartToken: true });
  const result = await probeWooCheckout(makeContext(shop), [TEE_M, { variantId: '101' }], { shipTo: SHIP_TO });

  assert.deepEqual(result, {
    sightings: [],
    issues: [{ surface: 'checkout', code: 'probe-failed', message: 'the shop did not return a cart token' }],
  });
  assert.ok(shop.calls.every((c) => c.method === 'GET'), 'only reads were made');
  assert.equal(shop.calls.length, 1);
});

test('writes refused for ownership gives exactly one issue and no further requests', async () => {
  const shop = createFakeShop({ refuseWrites: true });
  const result = await probeWooCheckout(makeContext(shop), [TEE_M, { variantId: '101' }], { shipTo: SHIP_TO });

  assert.deepEqual(result, {
    sightings: [],
    issues: [{ surface: 'checkout', code: 'ownership-not-verified', message: OWNERSHIP }],
  });
  assert.deepEqual(trace(shop.calls), ['GET /cart', 'POST /cart/add-item']);
});

test('a cart that will not empty is reported after the target and again at the end', async () => {
  const shop = createFakeShop({ cartWontEmpty: true });
  const result = await probeWooCheckout(makeContext(shop), [TEE_M], { shipTo: SHIP_TO });

  const codes = result.issues.map((i) => i.code);
  assert.deepEqual(codes, ['cart-not-emptied', 'cart-not-emptied']);
  assert.deepEqual(result.issues[1], {
    surface: 'checkout',
    code: 'cart-not-emptied',
    message: 'the probe cart still holds items; remove them from the shop admin',
  });
  assert.equal(result.sightings.length, 1, 'the reading taken before the failure is kept');
  assert.equal(shop.cartSize('cart-1'), 1);
});

test('a nonce from GET /cart is echoed on every later request', async () => {
  const shop = createFakeShop({ nonce: 'n-123' });
  const result = await probeWooCheckout(makeContext(shop), [TEE_M], { shipTo: SHIP_TO });

  assert.deepEqual(result.issues, []);
  assert.deepEqual(shop.calls[0]?.headers, {});
  for (const call of shop.calls.slice(1)) {
    assert.equal(call.headers.nonce, 'n-123', `${call.method} ${call.path} echoes the nonce`);
    assert.equal(call.headers['cart-token'], 'cart-1');
  }
});

test('empty targets make no requests at all', async () => {
  const shop = createFakeShop();
  const result = await probeWooCheckout(makeContext(shop), [], { shipTo: SHIP_TO });

  assert.deepEqual(result, { sightings: [], issues: [] });
  assert.equal(shop.calls.length, 0);
});

test('a refusal about the request (an expired nonce) is a probe failure, not an unpurchasable product', async () => {
  const at = '2026-10-09T12:00:00.000Z';
  const reply = (url: string, status: number, body: unknown, headers: Record<string, string> = {}) => ({ url, status, headers, body: JSON.stringify(body), fetchedAt: at });
  const fetcher = {
    get: async (url: string) => reply(url, 200, { items: [], items_count: 0 }, { 'cart-token': 'T' }),
    send: async (method: string, url: string) =>
      url.endsWith('/cart/add-item')
        ? reply(url, 403, { code: 'woocommerce_rest_invalid_nonce', message: 'Nonce is invalid.', data: { status: 403 } })
        : reply(url, 200, method === 'DELETE' ? [] : {}),
  };
  const result = await probeWooCheckout(makeContext(fetcher), [{ variantId: '102', sku: 'TEE-BLU-M' }], { shipTo: { country: 'US' } });
  assert.equal(result.sightings.length, 0);
  assert.deepEqual(result.issues.map((i) => i.code), ['probe-failed']);
});
