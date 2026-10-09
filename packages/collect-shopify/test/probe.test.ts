import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FetchRefused } from '@regmark/core';
import type { Fetched } from '@regmark/core';
import { probeShopifyCart } from '../src/index.ts';
import type { ShopifyProbeOptions, ShopifyProbeTarget } from '../src/index.ts';
import { createFakeCart, makeContext, obs, ORIGIN, usd } from './fake-cart.ts';
import type { Call, FakeCart } from './fake-cart.ts';

const ADD = `${ORIGIN}/cart/add.js`;
const RATES = `${ORIGIN}/cart/async_shipping_rates.json`;
const SHIP_TO: ShopifyProbeOptions['shipTo'] = { country: 'US', postcode: '94103', state: 'CA', city: 'San Francisco' };
const QUERY = 'shipping_address%5Bzip%5D=94103&shipping_address%5Bcountry%5D=US&shipping_address%5Bprovince%5D=CA';
const TEE_M: ShopifyProbeTarget = { variantId: '101', productId: '10', sku: 'TEE-M', url: `${ORIGIN}/products/classic-tee` };
const TEE_L: ShopifyProbeTarget = { variantId: '102', productId: '10', sku: 'TEE-L' };
const MUG: ShopifyProbeTarget = { variantId: '201', sku: 'MUG-1' };
const GIFT: ShopifyProbeTarget = { variantId: '301', sku: 'GIFT-25' };
const OWNERSHIP = 'the checkout probe needs proof that you control this shop; see the ownership token in the documentation';
const SESSION = 'cart=c1; _shopify_essential=:s1:';

const trace = (calls: readonly Call[]) => calls.map((c) => `${c.method} ${c.path}`);
const probe = (shop: FakeCart, targets: ShopifyProbeTarget[], shipTo = SHIP_TO) => probeShopifyCart(makeContext(shop), targets, { shipTo });

/** The probe stops at the cart: no request may go near checkout or payment. */
function neverPastTheCart(shop: FakeCart): void {
  for (const call of shop.calls) {
    assert.match(call.path, /^\/cart(?:\.js|\/(?:add|clear)\.js|\/(?:prepare|async)_shipping_rates\.json)$/, `${call.method} ${call.path}`);
  }
}

test('one target: purchasable, price and the cheapest rate, in order, all in one session', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings, [
    {
      surface: 'checkout',
      scope: 'variant',
      ids: { variantId: '101', productId: '10', sku: 'TEE-M', url: TEE_M.url },
      purchasable: obs(true, 'added', ADD),
      price: obs(usd(390000), '3900', `${ADD}#/items/0/final_price`),
      shipping: obs({ free: false, cost: usd(62000), country: 'US' }, '6.20', `${RATES}?${QUERY}#/shipping_rates/1/price`),
    },
  ]);

  assert.deepEqual(trace(shop.calls), [
    'GET /cart.js',
    'POST /cart/add.js',
    'POST /cart/prepare_shipping_rates.json',
    'GET /cart/async_shipping_rates.json',
    'POST /cart/clear.js',
    'GET /cart.js',
  ]);
  assert.deepEqual(shop.calls[1]?.json, { items: [{ id: 101, quantity: 1 }] });
  assert.equal(shop.calls[2]?.query, QUERY, 'prepare and the check ask about the same address');
  assert.equal(shop.calls[3]?.query, QUERY);
  assert.equal(shop.calls[0]?.headers.cookie, undefined, 'the first request has no session yet');
  for (const call of shop.calls) {
    assert.equal(call.headers.accept, 'application/json');
    if (call.method === 'GET') assert.equal(call.asOwner, true, `${call.path} is read as the owner, past robots.txt`);
  }
  for (const call of shop.calls.slice(1)) assert.equal(call.headers.cookie, SESSION, `${call.method} ${call.path} carries the session`);
  assert.equal(shop.cartSize('c1'), 0);
  neverPastTheCart(shop);
});

test('no landed total is recorded: tax is not known before checkout', async () => {
  const shop = createFakeCart();
  const [sighting] = (await probe(shop, [TEE_M])).sightings;
  assert.ok(sighting);
  assert.equal(sighting.landedTotal, undefined);
});

test('the price is the line after its automatic discount, not the list price', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [MUG]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings[0]?.price, obs(usd(120000), '1200', `${ADD}#/items/0/final_price`));
});

test('yen are stated in hundredths like every other currency, so 150000 is 1500 JPY', async () => {
  const shop = createFakeCart({
    currency: 'JPY',
    variants: [{ id: 101, productId: 10, title: 'Classic Tee', sku: 'TEE-M', price: 150000, available: true }],
    rates: [{ name: 'Standard', price: '800' }, { name: 'Express', price: '1200' }],
    shipsTo: ['JP'],
  });
  const result = await probe(shop, [TEE_M], { country: 'JP', postcode: '100-0001' });

  assert.deepEqual(result.issues, []);
  const jpy = (units: number) => ({ units, currency: 'JPY' });
  const [sighting] = result.sightings;
  assert.deepEqual(sighting?.price, obs(jpy(15_000_000), '150000', `${ADD}#/items/0/final_price`));
  const query = 'shipping_address%5Bzip%5D=100-0001&shipping_address%5Bcountry%5D=JP';
  assert.deepEqual(sighting?.shipping, obs({ free: false, cost: jpy(8_000_000), country: 'JP' }, '800', `${RATES}?${query}#/shipping_rates/0/price`));
});

test('dollars: 3900 hundredths are 39.00 USD, never 3.900 or 3900', async () => {
  const shop = createFakeCart();
  const [sighting] = (await probe(shop, [TEE_M])).sightings;
  assert.deepEqual(sighting?.price?.value, { units: 390000, currency: 'USD' });
});

test('a three-decimal currency leaves the price out with an issue, and keeps the rest', async () => {
  const shop = createFakeCart({ currency: 'KWD', rates: [{ name: 'Standard', price: '1.500' }] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues.map((i) => i.code), ['probe-failed']);
  assert.match(result.issues[0]!.message, /^101: the cart is in KWD, a currency with three decimals/);
  const [sighting] = result.sightings;
  assert.equal(sighting?.price, undefined);
  assert.deepEqual(sighting?.purchasable, obs(true, 'added', ADD));
  // A rate is written in whole units, so its decimals need no scale.
  assert.deepEqual(sighting?.shipping?.value, { free: false, cost: { units: 15000, currency: 'KWD' }, country: 'US' });
});

test('a cart that states no currency leaves the price out rather than guess one', async () => {
  const shop = createFakeCart({ currency: '' });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, [{ surface: 'checkout', code: 'probe-failed', message: '101: the cart states no currency, so its price was left out' }]);
  assert.equal(result.sightings[0]?.price, undefined);
  assert.deepEqual(result.sightings[0]?.shipping?.value.cost, { units: 62000, currency: null });
});

test('a rate that states its own currency keeps it', async () => {
  const shop = createFakeCart({ rates: [{ name: 'Standard', price: '8.00', currency: 'CAD' }] });
  const [sighting] = (await probe(shop, [TEE_M])).sightings;
  assert.deepEqual(sighting?.shipping?.value.cost, { units: 80000, currency: 'CAD' });
});

test('a free rate is free with a zero cost', async () => {
  const shop = createFakeCart({ rates: [{ name: 'Standard', price: '6.20' }, { name: 'Free shipping', price: '0.00' }] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings[0]?.shipping, obs({ free: true, cost: usd(0), country: 'US' }, '0.00', `${RATES}?${QUERY}#/shipping_rates/1/price`));
});

test('a sold-out variant is not purchasable, keeps the cart\'s words as raw, and has no price or shipping', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [TEE_L]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings, [
    {
      surface: 'checkout',
      scope: 'variant',
      ids: { variantId: '102', productId: '10', sku: 'TEE-L' },
      purchasable: obs(false, "The product 'Classic Tee' is already sold out.", ADD),
    },
  ]);
  assert.deepEqual(trace(shop.calls), ['GET /cart.js', 'POST /cart/add.js', 'POST /cart/clear.js', 'GET /cart.js']);
});

test('a variant the online store does not sell ("Cannot find variant") is not purchasable', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [{ variantId: '999' }]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings[0]?.purchasable, obs(false, 'Cannot find variant', ADD));
});

test('a 422 in another shape is about the request, not the product', async () => {
  const shop = createFakeCart({ canned: { '/cart/add.js': [{ status: 422, body: JSON.stringify({ errors: { items: ['is invalid'] } }) }] } });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.sightings, []);
  assert.deepEqual(result.issues, [{ surface: 'checkout', code: 'probe-failed', message: '101: add.js returned HTTP 422' }]);
});

test('a 400 for a malformed request is a probe failure, and the next target still runs', async () => {
  const shop = createFakeCart();
  const send = shop.send.bind(shop);
  let first = true;
  shop.send = async (method, url, options) => {
    if (url === ADD && first) {
      first = false;
      return send(method, url, { ...options, json: { items: [] } });
    }
    return send(method, url, options);
  };
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues, [{ surface: 'checkout', code: 'probe-failed', message: '101: add.js returned HTTP 400' }]);
  assert.deepEqual(result.sightings.map((s) => [s.ids.variantId, s.purchasable?.value]), [['201', true]]);
});

test('three targets share one session, and each is followed by its own clear', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [TEE_M, TEE_L, MUG]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings.map((s) => [s.ids.variantId, s.purchasable?.value, s.price?.value.units]), [
    ['101', true, 390000],
    ['102', false, undefined],
    ['201', true, 120000],
  ]);
  assert.deepEqual(trace(shop.calls), [
    'GET /cart.js',
    'POST /cart/add.js',
    'POST /cart/prepare_shipping_rates.json',
    'GET /cart/async_shipping_rates.json',
    'POST /cart/clear.js',
    'POST /cart/add.js',
    'POST /cart/clear.js',
    'POST /cart/add.js',
    'POST /cart/prepare_shipping_rates.json',
    'GET /cart/async_shipping_rates.json',
    'POST /cart/clear.js',
    'GET /cart.js',
  ]);
  assert.ok(shop.calls.slice(1).every((c) => c.headers.cookie === SESSION));
  assert.equal(shop.cartSize('c1'), 0);
  neverPastTheCart(shop);
});

test('a line that ships nothing gets no shipping estimate and no issue', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [GIFT]);

  assert.deepEqual(result.issues, []);
  assert.equal(result.sightings[0]?.shipping, undefined);
  assert.deepEqual(result.sightings[0]?.price?.value, usd(250000));
  assert.deepEqual(trace(shop.calls), ['GET /cart.js', 'POST /cart/add.js', 'POST /cart/clear.js', 'GET /cart.js']);
});

// ── Shipping ────────────────────────────────────────────────────────────

test('rates that are not ready yet are checked again until they are', async () => {
  const shop = createFakeCart({ pendingChecks: 2 });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings[0]?.shipping?.value, { free: false, cost: usd(62000), country: 'US' });
  assert.equal(shop.calls.filter((c) => c.path === '/cart/async_shipping_rates.json').length, 3);
});

test('rates still not ready after four checks fail the estimate, and keep the price', async () => {
  const shop = createFakeCart({ pendingChecks: 10 });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'probe-failed', message: '101: shipping estimate failed: the rates were not ready after 4 checks' },
  ]);
  assert.equal(shop.calls.filter((c) => c.path === '/cart/async_shipping_rates.json').length, 4);
  const [sighting] = result.sightings;
  assert.equal(sighting?.shipping, undefined);
  assert.deepEqual(sighting?.price?.value, usd(390000));
  assert.equal(shop.cartSize('c1'), 0);
});

test('no rate for the destination is a no-shipping-rate issue with no shipping observation', async () => {
  const shop = createFakeCart({ rates: [] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, [{ surface: 'checkout', code: 'no-shipping-rate', message: 'no shipping rate for US on TEE-M' }]);
  assert.equal(result.sightings[0]?.shipping, undefined);
  assert.deepEqual(result.sightings[0]?.purchasable, obs(true, 'added', ADD));
});

test('a destination the shop refuses is a no-shipping-rate issue that quotes the shop', async () => {
  const shop = createFakeCart({ shipsTo: ['CA'] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'no-shipping-rate', message: 'no shipping rate for US on TEE-M: country is not supported' },
  ]);
  assert.equal(result.sightings[0]?.shipping, undefined);
});

test('Shopify failing to calculate rates is a probe failure, not a statement about where it ships', async () => {
  const body = { error: ['There was a problem calculating your shipping rates. Continue to checkout to choose a shipping rate before you complete your order.'] };
  const shop = createFakeCart({ rateAnswer: { status: 422, body: JSON.stringify(body) } });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues.map((i) => i.code), ['probe-failed']);
  assert.match(result.issues[0]!.message, /^101: the shop could not calculate shipping rates: There was a problem calculating/);
  assert.equal(result.sightings[0]?.shipping, undefined);
});

test('a failing prepare is a probe failure for the target, and the cart is still emptied', async () => {
  const shop = createFakeCart({ fail: { '/cart/prepare_shipping_rates.json': 500 } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues.map((i) => i.message), [
    '101: shipping estimate failed: prepare_shipping_rates.json returned HTTP 500',
    '201: shipping estimate failed: prepare_shipping_rates.json returned HTTP 500',
  ]);
  assert.deepEqual(result.sightings.map((s) => s.ids.variantId), ['101', '201']);
  assert.equal(shop.cartSize('c1'), 0);
});

test('a rate endpoint that answers with a page fails the estimate only', async () => {
  const shop = createFakeCart({ rateAnswer: { status: 404, body: '<html>Not found</html>' } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues.map((i) => i.message), [
    '101: shipping estimate failed: async_shipping_rates.json answered with a page, not JSON (HTTP 404)',
    '201: shipping estimate failed: async_shipping_rates.json answered with a page, not JSON (HTTP 404)',
  ]);
  assert.equal(result.sightings.length, 2);
});

test('rates whose prices do not read fail the estimate rather than pick one', async () => {
  const shop = createFakeCart({ rates: [{ name: 'Standard', price: '$6.20' }, { name: 'Express', price: '' }] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues.map((i) => i.message), ['101: shipping estimate failed: no shipping rate has a price that can be read']);
  assert.equal(result.sightings[0]?.shipping, undefined);
});

test('the address sends the postcode, country and province, and no city', async () => {
  const shop = createFakeCart({ shipsTo: ['CA'] });
  await probe(shop, [TEE_M], { country: 'ca', postcode: ' K1N 5T2 ', state: 'ON', city: 'Ottawa' });

  const prepare = shop.calls.find((c) => c.path === '/cart/prepare_shipping_rates.json');
  assert.deepEqual([...new URLSearchParams(prepare?.query)], [
    ['shipping_address[zip]', 'K1N 5T2'],
    ['shipping_address[country]', 'CA'],
    ['shipping_address[province]', 'ON'],
  ]);
});

test('a country alone is a complete address', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [TEE_M], { country: 'US' });

  assert.deepEqual(result.issues, []);
  assert.equal(shop.calls.find((c) => c.path === '/cart/prepare_shipping_rates.json')?.query, 'shipping_address%5Bcountry%5D=US');
});

// ── What is not the cart ────────────────────────────────────────────────

test('bot protection on add.js stops the probe with one issue and nothing written after it', async () => {
  const shop = createFakeCart({ challenge: { '/cart/add.js': 429 } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result, {
    sightings: [],
    issues: [
      {
        surface: 'checkout',
        code: 'probe-failed',
        message: "101: add.js was answered by the shop's bot protection (HTTP 429), not by the cart; the probe stopped",
      },
    ],
  });
  // The challenge came before the cart, so there is nothing to empty, and asking again would only be challenged again.
  assert.deepEqual(trace(shop.calls), ['GET /cart.js', 'POST /cart/add.js']);
});

test('a 403 challenge is bot protection too, not a refusal of the product', async () => {
  const shop = createFakeCart({ challenge: { '/cart/add.js': 403 } });
  const result = await probe(shop, [TEE_L]);

  assert.deepEqual(result.sightings, []);
  assert.match(result.issues[0]!.message, /bot protection \(HTTP 403\)/);
});

test('bot protection after the add keeps what was read, empties the cart, and stops', async () => {
  const shop = createFakeCart({ challenge: { '/cart/async_shipping_rates.json': 403 } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues, [
    {
      surface: 'checkout',
      code: 'probe-failed',
      message: "101: async_shipping_rates.json was answered by the shop's bot protection (HTTP 403), not by the cart; the probe stopped",
    },
  ]);
  assert.deepEqual(result.sightings.map((s) => [s.ids.variantId, s.purchasable?.value, s.price?.value.units, s.shipping]), [
    ['101', true, 390000, undefined],
  ]);
  assert.deepEqual(trace(shop.calls), [
    'GET /cart.js',
    'POST /cart/add.js',
    'POST /cart/prepare_shipping_rates.json',
    'GET /cart/async_shipping_rates.json',
    'POST /cart/clear.js',
  ]);
  assert.equal(shop.cartSize('c1'), 0);
});

test('bot protection on opening the cart writes nothing', async () => {
  const shop = createFakeCart({ challenge: { '/cart.js': 429 } });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result, {
    sightings: [],
    issues: [
      {
        surface: 'checkout',
        code: 'probe-failed',
        message: "could not open a cart: cart.js was answered by the shop's bot protection (HTTP 429), not by the cart",
      },
    ],
  });
  assert.deepEqual(trace(shop.calls), ['GET /cart.js']);
});

test('a challenge header marks bot protection whatever the status', async () => {
  const challenge = { status: 503, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }, body: '<html>Just a moment...</html>' };
  const shop = createFakeCart({ canned: { '/cart/add.js': [challenge] } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.sightings, []);
  assert.match(result.issues[0]!.message, /^101: add.js was answered by the shop's bot protection \(HTTP 503\)/);
  // A 503 may have come after the add, so the cart is emptied before stopping.
  assert.deepEqual(trace(shop.calls), ['GET /cart.js', 'POST /cart/add.js', 'POST /cart/clear.js']);
});

test('a shop with no storefront cart answers cart.js with a page, and nothing is written', async () => {
  const shop = createFakeCart({ html: ['/cart.js'] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'probe-failed', message: "could not open a cart: cart.js answered with a page, not the cart's JSON (HTTP 200)" },
  ]);
  assert.ok(shop.calls.every((c) => c.method === 'GET'));
});

test('add.js answering with a page is not a refusal of the product; the probe empties the cart and stops', async () => {
  const shop = createFakeCart({ html: ['/cart/add.js'] });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.sightings, []);
  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'probe-failed', message: "101: add.js answered with a page, not the cart's JSON (HTTP 200); the probe stopped" },
  ]);
  assert.deepEqual(trace(shop.calls), ['GET /cart.js', 'POST /cart/add.js', 'POST /cart/clear.js']);
});

test('a password-protected shop redirects add.js, and the probe stops', async () => {
  const shop = createFakeCart({ redirect: { '/cart/add.js': `${ORIGIN}/password` } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'probe-failed', message: `101: add.js was redirected to ${ORIGIN}/password (HTTP 302); the probe stopped` },
  ]);
  assert.deepEqual(trace(shop.calls), ['GET /cart.js', 'POST /cart/add.js']);
});

test('a 401 on add.js is a refusal of the client, and the probe stops', async () => {
  const shop = createFakeCart({ canned: { '/cart/add.js': [{ status: 401, body: '' }] } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues.map((i) => i.message), ['101: add.js was refused (HTTP 401); the probe stopped']);
  assert.equal(shop.calls.filter((c) => c.path === '/cart/add.js').length, 1);
});

test('a 500 on add.js fails that target only, and the cart is emptied in case the add went through', async () => {
  const shop = createFakeCart({ canned: { '/cart/add.js': [{ status: 500, headers: { 'content-type': 'text/html' }, body: '<html>Something went wrong</html>' }] } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues, [{ surface: 'checkout', code: 'probe-failed', message: '101: add.js returned HTTP 500' }]);
  assert.deepEqual(result.sightings.map((s) => s.ids.variantId), ['201']);
  assert.deepEqual(trace(shop.calls).slice(0, 3), ['GET /cart.js', 'POST /cart/add.js', 'POST /cart/clear.js']);
});

test('a network error on add.js fails that target, and the cart is emptied in case the add went through', async () => {
  const shop = createFakeCart({ networkError: ['/cart/add.js'] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues.map((i) => i.code), ['probe-failed']);
  assert.match(result.issues[0]!.message, /^101: network: /);
  assert.deepEqual(trace(shop.calls), ['GET /cart.js', 'POST /cart/add.js', 'POST /cart/clear.js', 'GET /cart.js']);
});

test('an add answer for a different variant cannot become evidence for the target', async () => {
  const shop = createFakeCart();
  const send = shop.send.bind(shop);
  shop.send = async (method, url, options) => {
    const response = await send(method, url, options);
    if (url === ADD) {
      const body = JSON.parse(response.body);
      body.items[0].variant_id = 201;
      response.body = JSON.stringify(body);
    }
    return response;
  };
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.sightings, []);
  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'probe-failed', message: '101: add.js response does not contain the requested variant' },
  ]);
  assert.equal(shop.calls.some((c) => c.path.includes('shipping')), false);
  assert.equal(shop.cartSize('c1'), 0);
});

test('the older add.js answer, the bare line, is read too', async () => {
  const shop = createFakeCart();
  const send = shop.send.bind(shop);
  shop.send = async (method, url, options) => {
    const response = await send(method, url, options);
    if (url === ADD) response.body = JSON.stringify(JSON.parse(response.body).items[0]);
    return response;
  };
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings[0]?.price, obs(usd(390000), '3900', `${ADD}#/final_price`));
});

test('a variant already in the cart is not quoted for shipping as if it were one unit', async () => {
  const shop = createFakeCart();
  const send = shop.send.bind(shop);
  shop.send = async (method, url, options) => {
    const response = await send(method, url, options);
    if (url === ADD) {
      const body = JSON.parse(response.body);
      body.items[0].quantity = 2;
      response.body = JSON.stringify(body);
    }
    return response;
  };
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues.map((i) => i.message), ['101: the cart holds more than the one unit added, so shipping was not estimated']);
  assert.equal(shop.calls.some((c) => c.path.includes('shipping')), false);
  assert.equal(result.sightings.length, 1, 'the add itself was read');
});

test('a new cart that already holds items is left alone', async () => {
  const shop = createFakeCart({ startWith: [201] });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result, {
    sightings: [],
    issues: [{ surface: 'checkout', code: 'probe-failed', message: 'could not open a cart: the new cart already holds items' }],
  });
  assert.deepEqual(trace(shop.calls), ['GET /cart.js']);
});

test('an id that is not a number is refused before anything is sent for it', async () => {
  const shop = createFakeCart();
  const result = await probe(shop, [{ variantId: 'gid://shopify/ProductVariant/101' }, MUG]);

  assert.deepEqual(result.issues.map((i) => i.message), ['gid://shopify/ProductVariant/101: not a variant id: gid://shopify/ProductVariant/101']);
  assert.deepEqual(result.sightings.map((s) => s.ids.variantId), ['201']);
  assert.equal(shop.calls.filter((c) => c.path === '/cart/add.js').length, 1);
});

test('empty targets make no requests at all', async () => {
  const shop = createFakeCart();
  assert.deepEqual(await probe(shop, []), { sightings: [], issues: [] });
  assert.equal(shop.calls.length, 0);
});

// ── Cleanup ─────────────────────────────────────────────────────────────

test('a cart that will not empty is reported after the target, stops the sample, and is reported again at the end', async () => {
  const shop = createFakeCart({ cartWontEmpty: true });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues, [
    {
      surface: 'checkout',
      code: 'cart-not-emptied',
      message: 'could not empty the probe cart after 101 (the cart it returned is not empty); no further target was added to it',
    },
    { surface: 'checkout', code: 'cart-not-emptied', message: 'the probe cart still holds items' },
  ]);
  assert.deepEqual(result.sightings.map((s) => s.ids.variantId), ['101'], 'the reading taken before the failure is kept');
  assert.equal(shop.calls.filter((c) => c.path === '/cart/add.js').length, 1);
  assert.equal(shop.cartSize('c1'), 1);
});

test('clear.js failing outright is cart-not-emptied with its status', async () => {
  const shop = createFakeCart({ fail: { '/cart/clear.js': 500 } });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result.issues.map((i) => i.message), [
    'could not empty the probe cart after 101 (HTTP 500); no further target was added to it',
    'the probe cart still holds items',
  ]);
  assert.equal(shop.calls.filter((c) => c.path === '/cart/add.js').length, 1);
});

test('a cart that cannot be read at the end is reported as not confirmed empty', async () => {
  const shop = createFakeCart();
  const get = shop.get.bind(shop);
  let reads = 0;
  shop.get = async (url, options) => {
    if (url.endsWith('/cart.js') && ++reads === 2) throw new FetchRefused('timeout', url, '15000 ms');
    return get(url, options);
  };
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, [
    { surface: 'checkout', code: 'cart-not-emptied', message: 'could not read the probe cart to confirm it is empty' },
  ]);
  assert.equal(result.sightings.length, 1);
});

test('even a refused product is followed by a clear, as a cart that refuses may still have changed', async () => {
  const shop = createFakeCart();
  await probe(shop, [TEE_L, MUG]);
  assert.deepEqual(trace(shop.calls).slice(0, 4), ['GET /cart.js', 'POST /cart/add.js', 'POST /cart/clear.js', 'POST /cart/add.js']);
});

// ── Session cookies ─────────────────────────────────────────────────────

test('without its cookies a request would reach another cart; with them every step reaches the same one', async () => {
  const shop = createFakeCart();
  await probe(shop, [TEE_M]);
  // One session was started, by the first request, and no request started another.
  const started = shop.calls.filter((c) => c.headers.cookie === undefined);
  assert.equal(started.length, 1);
  assert.equal(shop.cartSize('c2'), 0);
});

test('cookies the shop sets later are added, replaced and expired as it says', async () => {
  const shop = createFakeCart({
    setCookie: {
      '/cart.js': ['localization=US; path=/; expires=Sat, 09 Oct 2027 12:00:00 GMT', 'cart_ts=1; path=/'],
      '/cart/add.js': [
        'localization=CA; path=/',
        'cart_ts=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'discount_code=SAVE10; Max-Age=0; expires=Sat, 09 Oct 2027 12:00:00 GMT',
        'not a cookie',
        'bad name=1',
      ],
    },
  });
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, []);
  assert.equal(shop.calls[1]?.headers.cookie, `${SESSION}; localization=US; cart_ts=1`);
  assert.equal(shop.calls[2]?.headers.cookie, `${SESSION}; localization=CA`);
});

test('a session the shop starts on the first add instead of on the first read still carries through', async () => {
  const shop = createFakeCart();
  const get = shop.get.bind(shop);
  let first = true;
  shop.get = async (url, options) => {
    const res: Fetched = await get(url, options);
    if (first) {
      first = false;
      // Forget the session this read started, as a shop that sets no cookie on an empty cart would.
      delete res.headers['set-cookie'];
    }
    return res;
  };
  const result = await probe(shop, [TEE_M]);

  assert.deepEqual(result.issues, []);
  assert.equal(shop.calls[1]?.headers.cookie, undefined);
  assert.equal(shop.calls[2]?.headers.cookie, 'cart=c2; _shopify_essential=:s2:');
  assert.equal(shop.cartSize('c2'), 0);
});

// ── Ownership ───────────────────────────────────────────────────────────

test('an unverified run gets exactly one ownership issue, and no request goes past the first', async () => {
  const shop = createFakeCart({ refuseWrites: true });
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result, {
    sightings: [],
    issues: [{ surface: 'checkout', code: 'ownership-not-verified', message: OWNERSHIP }],
  });
  assert.deepEqual(trace(shop.calls), ['GET /cart.js']);
});

test('a write refused for ownership mid-run discards everything gathered', async () => {
  const shop = createFakeCart();
  const send = shop.send.bind(shop);
  let adds = 0;
  shop.send = async (method, url, options) => {
    if (url === ADD && ++adds === 2) throw new FetchRefused('write-not-authorized', url, 'ownership of this shop has not been verified');
    return send(method, url, options);
  };
  const result = await probe(shop, [TEE_M, MUG]);

  assert.deepEqual(result, {
    sightings: [],
    issues: [{ surface: 'checkout', code: 'ownership-not-verified', message: OWNERSHIP }],
  });
});
