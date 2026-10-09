import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildShop } from '../src/shop.ts';
import { createStoreApi, minor } from '../src/store-api.ts';
import type { ApiResponse, StoreApi } from '../src/store-api.ts';

const NOW = new Date('2026-10-09T00:00:00Z');
const ORIGIN = 'http://shop.test';
const BASE = '/wp-json/wc/store/v1';

const clean = createStoreApi(buildShop('clean', NOW));
const misprint = createStoreApi(buildShop('misprint', NOW));

type Opts = { token?: string; query?: string; body?: unknown };

function call(api: StoreApi, method: string, path: string, opts: Opts = {}): ApiResponse {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers['cart-token'] = opts.token;
  const res = api.handle({
    method,
    path: BASE + path,
    query: new URLSearchParams(opts.query ?? ''),
    headers,
    body: opts.body,
    origin: ORIGIN,
  });
  if (!res) throw new Error(`no response for ${method} ${path}`);
  return res;
}

function tokenOf(res: ApiResponse): string {
  const token = res.headers['cart-token'];
  if (!token) throw new Error('cart response without cart-token');
  return token;
}

function openCart(api: StoreApi): string {
  return tokenOf(call(api, 'GET', '/cart'));
}

function addItem(api: StoreApi, token: string, id: number, quantity?: number): ApiResponse {
  return call(api, 'POST', '/cart/add-item', { token, body: { id, quantity } });
}

const US = { country: 'US', postcode: '94103', state: 'CA', city: 'San Francisco' };

function setAddress(api: StoreApi, token: string, shipping_address: Record<string, string>): ApiResponse {
  return call(api, 'POST', '/cart/update-customer', { token, body: { shipping_address } });
}

type Prices = { price: string; regular_price: string; sale_price: string; currency_code: string };
type Parent = {
  id: number;
  type: string;
  sku: string;
  on_sale: boolean;
  is_in_stock: boolean;
  is_purchasable: boolean;
  prices: Prices;
  attributes: unknown[];
  variations: { id: number; attributes: { name: string; value: string }[] }[];
};
type Variation = {
  id: number;
  parent: number;
  type: string;
  variation: string;
  permalink: string;
  sku: string;
  is_in_stock: boolean;
  prices: Prices;
};
type CartLine = {
  key: string;
  id: number;
  quantity: number;
  name: string;
  sku: string;
  permalink: string;
  prices: { price: string };
  totals: { line_total: string };
};
type CartBody = {
  items: CartLine[];
  items_count: number;
  needs_shipping: boolean;
  shipping_rates: { shipping_rates: { rate_id: string; price: string }[] }[];
  totals: { total_items: string; total_shipping: string; total_price: string };
};

const cartOf = (res: ApiResponse): CartBody => res.json as CartBody;

describe('minor()', () => {
  it('turns decimal strings into minor units without floating point', () => {
    assert.equal(minor('39.00'), '3900');
    assert.equal(minor('6.20'), '620');
    assert.equal(minor('129.00'), '12900');
    assert.equal(minor('0.00'), '0');
    assert.equal(minor('12'), '1200');
    assert.equal(minor('0.5'), '50');
  });
});

describe('products', () => {
  it('lists ten parent products with the default paging', () => {
    const res = call(clean, 'GET', '/products');
    assert.equal(res.status, 200);
    assert.equal((res.json as unknown[]).length, 10);
    assert.equal(res.headers['x-wp-total'], '10');
    assert.equal(res.headers['x-wp-totalpages'], '1');
  });

  it('pages by per_page and page', () => {
    const res = call(clean, 'GET', '/products', { query: 'per_page=3&page=2' });
    const ids = (res.json as Parent[]).map((p) => p.id);
    assert.deepEqual(ids, [400, 500, 600]);
    assert.equal(res.headers['x-wp-total'], '10');
    assert.equal(res.headers['x-wp-totalpages'], '4');
  });

  it('answers an empty list past the end', () => {
    const res = call(clean, 'GET', '/products', { query: 'per_page=3&page=5' });
    assert.deepEqual(res.json, []);
  });

  it('gives a variable parent with variations and no sku', () => {
    const res = call(clean, 'GET', '/products/100');
    const p = res.json as Parent;
    assert.equal(p.type, 'variable');
    assert.equal(p.sku, '');
    assert.equal(p.on_sale, true);
    assert.equal(p.is_in_stock, true);
    assert.equal(p.prices.price, '3900');
    assert.equal(p.prices.regular_price, '4500');
    assert.equal(p.prices.sale_price, '3900');
    assert.equal(p.prices.currency_code, 'USD');
    assert.deepEqual(
      p.variations.map((v) => v.attributes[0]?.value),
      ['s', 'm', 'l'],
    );
  });

  it('gives a simple product its sku and no variations', () => {
    const p = call(clean, 'GET', '/products/500').json as Parent;
    assert.equal(p.type, 'simple');
    assert.equal(p.sku, 'MUG-WHT');
    assert.deepEqual(p.variations, []);
    assert.deepEqual(p.attributes, []);
  });

  it('gives a variation object for variant 102', () => {
    const res = call(clean, 'GET', '/products/102');
    assert.equal(res.status, 200);
    const v = res.json as Variation;
    assert.equal(v.type, 'variation');
    assert.equal(v.parent, 100);
    assert.equal(v.sku, 'TEE-BLU-M');
    assert.equal(v.variation, 'Size: M');
    assert.equal(v.permalink, `${ORIGIN}/product/classic-tee/?attribute_pa_size=m`);
    assert.equal(v.prices.price, '3900');
    assert.equal(v.prices.regular_price, '4500');
  });

  it('marks an out-of-stock variation', () => {
    const v = call(clean, 'GET', '/products/403').json as Variation;
    assert.equal(v.sku, 'SOCK-L');
    assert.equal(v.is_in_stock, false);
  });

  it('answers 404 for an unknown product id', () => {
    const res = call(clean, 'GET', '/products/9999');
    assert.equal(res.status, 404);
    assert.equal((res.json as { code: string }).code, 'woocommerce_rest_product_invalid_id');
  });

  it('returns null for a path outside the base', () => {
    const res = clean.handle({
      method: 'GET',
      path: '/wp-json/wc/store/v2/products',
      query: new URLSearchParams(),
      headers: {},
      body: undefined,
      origin: ORIGIN,
    });
    assert.equal(res, null);
  });
});

describe('cart', () => {
  it('creates a cart for a GET without a token, and returns the same cart for that token', () => {
    const first = call(misprint, 'GET', '/cart');
    const token = tokenOf(first);
    assert.match(token, /^[0-9a-f]{32}$/);
    addItem(misprint, token, 102);
    const again = call(misprint, 'GET', '/cart', { token });
    assert.equal(tokenOf(again), token);
    assert.equal(cartOf(again).items.length, 1);
  });

  it('gives a new cart for an unknown token', () => {
    const res = call(misprint, 'GET', '/cart', { token: 'not-a-real-token' });
    const token = tokenOf(res);
    assert.notEqual(token, 'not-a-real-token');
    assert.deepEqual(cartOf(res).items, []);
  });

  it('rejects a write without any cart-token header with 401', () => {
    const res = call(misprint, 'POST', '/cart/add-item', { body: { id: 102, quantity: 1 } });
    assert.equal(res.status, 401);
    assert.equal((res.json as { code: string }).code, 'woocommerce_rest_missing_nonce');
  });

  it('adds an item and prices it at the checkout price, with no shipping before an address', () => {
    const token = openCart(misprint);
    const res = addItem(misprint, token, 102);
    assert.equal(res.status, 201);
    const cart = cartOf(res);
    assert.equal(cart.items.length, 1);
    assert.equal(cart.totals.total_items, '3900');
    assert.equal(cart.totals.total_shipping, '0');
    assert.equal(cart.totals.total_price, '3900');
    assert.deepEqual(cart.shipping_rates, []);
  });

  it('charges the flat rate to a US address below the free threshold', () => {
    const token = openCart(misprint);
    addItem(misprint, token, 102);
    const res = setAddress(misprint, token, US);
    assert.equal(res.status, 200);
    const cart = cartOf(res);
    assert.equal(cart.shipping_rates.length, 1);
    assert.equal(cart.shipping_rates[0]!.shipping_rates[0]!.rate_id, 'flat_rate:1');
    assert.equal(cart.shipping_rates[0]!.shipping_rates[0]!.price, '620');
    assert.equal(cart.totals.total_shipping, '620');
    assert.equal(cart.totals.total_price, '4520');
  });

  it('offers no rates to a non-US address', () => {
    const token = openCart(misprint);
    addItem(misprint, token, 102);
    const cart = cartOf(setAddress(misprint, token, { ...US, country: 'CA' }));
    assert.deepEqual(cart.shipping_rates, []);
    assert.equal(cart.totals.total_shipping, '0');
  });

  it('gives free shipping at or above the threshold', () => {
    const token = openCart(misprint);
    setAddress(misprint, token, US);
    const cart = cartOf(addItem(misprint, token, 701));
    assert.equal(cart.shipping_rates[0]!.shipping_rates[0]!.rate_id, 'free_shipping:1');
    assert.equal(cart.totals.total_price, '12900');
  });

  it('adds up quantities on the same line and moves to free shipping on the third unit', () => {
    const token = openCart(misprint);
    setAddress(misprint, token, US);
    addItem(misprint, token, 102);
    const two = cartOf(addItem(misprint, token, 102));
    assert.equal(two.items.length, 1);
    assert.equal(two.items[0]!.quantity, 2);
    assert.equal(two.items[0]!.totals.line_total, '7800');
    assert.equal(two.totals.total_shipping, '620');
    const three = cartOf(addItem(misprint, token, 102));
    assert.equal(three.items[0]!.quantity, 3);
    assert.equal(three.totals.total_items, '11700');
    assert.equal(three.shipping_rates[0]!.shipping_rates[0]!.rate_id, 'free_shipping:1');
  });

  it('refuses an out-of-stock variant', () => {
    const token = openCart(misprint);
    const res = addItem(misprint, token, 403);
    assert.equal(res.status, 400);
    assert.equal((res.json as { code: string }).code, 'woocommerce_rest_product_out_of_stock');
    assert.equal(tokenOf(res), token);
  });

  it('refuses a variable parent id and an unknown id as invalid products', () => {
    const token = openCart(misprint);
    for (const id of [100, 9999]) {
      const res = addItem(misprint, token, id);
      assert.equal(res.status, 400);
      assert.equal((res.json as { code: string }).code, 'woocommerce_rest_cart_invalid_product');
    }
  });

  it('refuses a quantity of zero', () => {
    const token = openCart(misprint);
    const res = addItem(misprint, token, 102, 0);
    assert.equal(res.status, 400);
    assert.equal(tokenOf(res), token);
  });

  it('refuses the lamp in the misprint shop while the product API still says it is buyable', () => {
    const token = openCart(misprint);
    const res = addItem(misprint, token, 800);
    assert.equal(res.status, 400);
    assert.equal((res.json as { code: string }).code, 'woocommerce_rest_product_not_purchasable');
    const product = call(misprint, 'GET', '/products/800').json as Parent;
    assert.equal(product.is_purchasable, true);
    assert.equal(product.is_in_stock, true);
  });

  it('sells the lamp in the clean shop', () => {
    const token = openCart(clean);
    assert.equal(addItem(clean, token, 800).status, 201);
  });

  it('prices the tote in the cart from checkout truth, not from the misprinted feed', () => {
    const token = openCart(misprint);
    const cart = cartOf(addItem(misprint, token, 200));
    assert.equal(cart.items[0]!.prices.price, '2400');
    assert.equal(cart.items[0]!.totals.line_total, '2400');
  });

  it('removes a line by its key, and answers 409 for an unknown key', () => {
    const token = openCart(misprint);
    const cart = cartOf(addItem(misprint, token, 102));
    const key = cart.items[0]!.key;
    const missing = call(misprint, 'POST', '/cart/remove-item', { token, body: { key: 'f'.repeat(32) } });
    assert.equal(missing.status, 409);
    assert.equal((missing.json as { code: string }).code, 'woocommerce_rest_cart_invalid_key');
    const removed = call(misprint, 'POST', '/cart/remove-item', { token, body: { key } });
    assert.equal(removed.status, 200);
    assert.deepEqual(cartOf(removed).items, []);
  });

  it('empties the cart on DELETE /cart/items, and carts() shows it empty', () => {
    const token = openCart(misprint);
    addItem(misprint, token, 102);
    const res = call(misprint, 'DELETE', '/cart/items', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, []);
    const snapshot = misprint.carts().find((c) => c.token === token);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.items, []);
  });

  it('carries a cart-token header on every cart response, errors included', () => {
    const token = openCart(misprint);
    const responses = [
      call(misprint, 'GET', '/cart', { token }),
      addItem(misprint, token, 102),
      addItem(misprint, token, 403),
      addItem(misprint, token, 9999),
      call(misprint, 'POST', '/cart/remove-item', { token, body: { key: 'nope' } }),
      call(misprint, 'DELETE', '/cart/items', { token }),
    ];
    for (const res of responses) assert.equal(res.headers['cart-token'], token);
  });

  it('answers 404 rest_no_route for an unknown cart path', () => {
    const token = openCart(misprint);
    const res = call(misprint, 'GET', '/cart/nothing-here', { token });
    assert.equal(res.status, 404);
    assert.equal((res.json as { code: string }).code, 'rest_no_route');
  });
});
