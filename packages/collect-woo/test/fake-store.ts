// An in-memory WooCommerce Store API for the collector tests. It keeps
// per-token carts, applies the same stock and shipping rules a shop would, and
// records every call so that tests can assert on what was asked and in what order.

import { FetchRefused } from '@regmark/core';
import type { CollectContext, Fetched, Fetcher, RequestOptions, Surface } from '@regmark/core';

export const ORIGIN = 'https://shop.example';
export const API_BASE = `${ORIGIN}/wp-json/wc/store/v1`;
const API_PATH = '/wp-json/wc/store/v1';
export const FIXED_NOW = '2026-10-09T12:00:00.000Z';

export type Entry = Record<string, unknown>;
export type Catalog = { products: Entry[]; details: Entry[] };

type Prices = { price: string; regular_price: string; sale_price: string; currency_code: string; currency_minor_unit: number };

export type Call = {
  method: string;
  url: string;
  /** Path under the Store API base, such as "/cart/add-item". */
  path: string;
  headers: Record<string, string>;
  json?: unknown;
};

export type Settings = {
  catalog: Catalog;
  /** Omit the cart-token header from GET /cart. */
  missingCartToken: boolean;
  /** Sent as the nonce header on every cart response when set. */
  nonce: string | undefined;
  /** Every POST and DELETE throws write-not-authorized, as an unverified run does. */
  refuseWrites: boolean;
  /** When false, carts report no shipping rate for any address. */
  shippingRates: boolean;
  /** DELETE /cart/items answers 500 and keeps the items. */
  cartWontEmpty: boolean;
  /** Subtotal in minor units from which the flat rate is waived. */
  freeShippingFrom: number;
  /** Replaces the computed x-wp-totalpages header on the product list. */
  listTotalPages: string | undefined;
  /** Relative path to an HTTP status returned for every method. */
  fail: Record<string, number>;
  /** Relative paths answered with a 200 body that is not JSON. */
  nonJson: string[];
  /** Relative paths refused by robots.txt. */
  robots: string[];
  /** Relative paths whose request dies with a network error. */
  networkError: string[];
};

export type ShopOptions = Partial<Settings>;

export type FakeShop = Fetcher & {
  readonly calls: Call[];
  readonly settings: Settings;
  cartSize(token: string): number;
};

type Cart = { items: { key: string; entry: Entry }[] };

function prices(amount: number, regular: number = amount, onSale = false): Prices {
  return {
    price: String(amount),
    regular_price: String(regular),
    sale_price: onSale ? String(amount) : '',
    currency_code: 'USD',
    currency_minor_unit: 2,
  };
}

function variant(id: number, parent: number, sku: string, price: Prices, inStock = true, purchasable = true): Entry {
  return {
    id,
    parent,
    type: 'variation',
    sku,
    permalink: `${ORIGIN}/product/variant-${id}/`,
    on_sale: price.sale_price !== '',
    prices: price,
    is_purchasable: purchasable,
    is_in_stock: inStock,
    is_on_backorder: false,
  };
}

/** A realistic small shop: a variable tee with one sold-out size, a sale mug, a backordered hoodie, a refused tote and a free-shipping jacket. */
export function defaultCatalog(): Catalog {
  const products: Entry[] = [
    {
      id: 100, name: 'Classic Tee', slug: 'classic-tee', parent: 0, type: 'variable',
      permalink: `${ORIGIN}/product/classic-tee/`, sku: '', on_sale: true,
      prices: prices(3900, 4500, true), is_purchasable: true, is_in_stock: true, is_on_backorder: false,
      variations: [
        { id: 101, attributes: [{ name: 'Size', value: 's' }] },
        { id: 102, attributes: [{ name: 'Size', value: 'm' }] },
        { id: 103, attributes: [{ name: 'Size', value: 'l' }] },
      ],
    },
    {
      id: 200, name: 'Enamel Mug', slug: 'enamel-mug', parent: 0, type: 'simple',
      permalink: `${ORIGIN}/product/enamel-mug/`, sku: 'MUG-1', on_sale: true,
      prices: prices(1200, 1500, true), is_purchasable: true, is_in_stock: true, is_on_backorder: false, variations: [],
    },
    {
      id: 300, name: 'Hoodie', slug: 'hoodie', parent: 0, type: 'simple',
      permalink: `${ORIGIN}/product/hoodie/`, sku: 'HOOD-1', on_sale: false,
      prices: prices(5000), is_purchasable: true, is_in_stock: false, is_on_backorder: true, variations: [],
    },
    {
      id: 400, name: 'Canvas Tote', slug: 'canvas-tote', parent: 0, type: 'variable',
      permalink: `${ORIGIN}/product/canvas-tote/`, sku: '', on_sale: false,
      prices: prices(2500), is_purchasable: true, is_in_stock: true, is_on_backorder: false,
      variations: [{ id: 401, attributes: [{ name: 'Color', value: 'natural' }] }],
    },
    {
      id: 500, name: 'Premium Jacket', slug: 'premium-jacket', parent: 0, type: 'simple',
      permalink: `${ORIGIN}/product/premium-jacket/`, sku: 'JACK-1', on_sale: false,
      prices: prices(8900), is_purchasable: true, is_in_stock: true, is_on_backorder: false, variations: [],
    },
  ];
  const variants: Entry[] = [
    variant(101, 100, 'TEE-BLU-S', prices(3900, 4500, true)),
    variant(102, 100, 'TEE-BLU-M', prices(3900)),
    variant(103, 100, 'TEE-BLU-L', prices(3900), false),
    variant(401, 400, 'TOTE-NAT', prices(2500), true, false),
  ];
  return { products, details: [...products, ...variants] };
}

/** Simple products with ids 1000 and up, for paging and limit tests. */
export function generatedProducts(count: number): Entry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    name: `Item ${i}`,
    slug: `item-${i}`,
    parent: 0,
    type: 'simple',
    permalink: `${ORIGIN}/product/item-${i}/`,
    sku: `GEN-${i}`,
    on_sale: false,
    prices: prices(1000 + i),
    is_purchasable: true,
    is_in_stock: true,
    is_on_backorder: false,
    variations: [],
  }));
}

function defaultSettings(): Settings {
  return {
    catalog: defaultCatalog(),
    missingCartToken: false,
    nonce: undefined,
    refuseWrites: false,
    shippingRates: true,
    cartWontEmpty: false,
    freeShippingFrom: 5000,
    listTotalPages: undefined,
    fail: {},
    nonJson: [],
    robots: [],
    networkError: [],
  };
}

export function createFakeShop(options: ShopOptions = {}): FakeShop {
  const settings: Settings = { ...defaultSettings(), ...options };
  const calls: Call[] = [];
  const carts = new Map<string, Cart>();
  let tokens = 0;

  const pathOf = (url: string): string => {
    const path = new URL(url).pathname;
    return path.startsWith(API_PATH) ? path.slice(API_PATH.length) : path;
  };

  const record = (method: string, url: string, headers: Record<string, string> | undefined, json: unknown): void => {
    const call: Call = { method, url, path: pathOf(url), headers: { ...(headers ?? {}) } };
    // A copy, so a later mutation of the caller's object does not rewrite history.
    if (json !== undefined) call.json = JSON.parse(JSON.stringify(json)) as unknown;
    calls.push(call);
  };

  const respond = (url: string, status: number, body: unknown, headers: Record<string, string> = {}): Fetched => ({
    url,
    status,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    fetchedAt: FIXED_NOW,
  });

  const error = (url: string, status: number, code: string, message: string): Fetched =>
    respond(url, status, { code, message, data: { status } });

  const findEntry = (id: number): Entry | undefined => {
    const all = [...settings.catalog.details, ...settings.catalog.products];
    return all.find((entry) => entry.id === id);
  };

  const cartFor = (headers: Record<string, string>): { token: string; cart: Cart } | undefined => {
    const token = headers['cart-token'];
    if (token === undefined) return undefined;
    const cart = carts.get(token);
    return cart ? { token, cart } : undefined;
  };

  const cartJson = (cart: Cart): Entry => {
    const items = cart.items.map((item) => {
      const p = item.entry.prices as Prices;
      return {
        key: item.key,
        id: item.entry.id,
        quantity: 1,
        sku: item.entry.sku,
        prices: { price: p.price, currency_code: 'USD', currency_minor_unit: 2 },
        totals: { line_total: p.price, currency_code: 'USD', currency_minor_unit: 2 },
      };
    });
    const subtotal = items.reduce((sum, item) => sum + Number(item.prices.price), 0);
    const shipping = settings.shippingRates ? (subtotal >= settings.freeShippingFrom ? 0 : 620) : 0;
    const rates = settings.shippingRates
      ? [
          {
            package_id: 0,
            shipping_rates: [
              { rate_id: 'flat_rate:1', name: 'Flat rate', price: String(shipping), currency_code: 'USD', currency_minor_unit: 2, selected: true },
            ],
          },
        ]
      : [];
    return {
      items,
      items_count: items.length,
      shipping_rates: rates,
      totals: {
        total_items: String(subtotal),
        total_shipping: String(shipping),
        total_tax: '0',
        total_price: String(subtotal + shipping),
        currency_code: 'USD',
        currency_minor_unit: 2,
      },
    };
  };

  const cartResponse = (url: string, status: number, token: string, cart: Cart, body?: unknown): Fetched => {
    const headers: Record<string, string> = { 'cart-token': token };
    if (settings.nonce !== undefined) headers.nonce = settings.nonce;
    return respond(url, status, body ?? cartJson(cart), headers);
  };

  const listProducts = (url: string): Fetched => {
    const u = new URL(url);
    const perPage = Number(u.searchParams.get('per_page') ?? '10');
    const page = Number(u.searchParams.get('page') ?? '1');
    const all = settings.catalog.products;
    const headers: Record<string, string> = {
      'x-wp-total': String(all.length),
      'x-wp-totalpages': settings.listTotalPages ?? String(Math.ceil(all.length / perPage)),
    };
    return respond(url, 200, all.slice((page - 1) * perPage, page * perPage), headers);
  };

  const getCart = (url: string, headers: Record<string, string>): Fetched => {
    if (settings.missingCartToken) return respond(url, 200, cartJson({ items: [] }));
    const existing = headers['cart-token'];
    let token: string;
    if (existing !== undefined && carts.has(existing)) {
      token = existing;
    } else {
      tokens += 1;
      token = `cart-${tokens}`;
      carts.set(token, { items: [] });
    }
    return cartResponse(url, 200, token, carts.get(token) ?? { items: [] });
  };

  const addItem = (url: string, headers: Record<string, string>, json: unknown): Fetched => {
    const found = cartFor(headers);
    if (!found) return error(url, 401, 'woocommerce_rest_missing_cart_token', 'The cart token is missing.');
    const id = typeof json === 'object' && json !== null ? (json as { id?: unknown }).id : undefined;
    const entry = typeof id === 'number' ? findEntry(id) : undefined;
    if (!entry) return error(url, 404, 'woocommerce_rest_cart_invalid_product', 'Invalid product ID.');
    if (entry.is_purchasable === false) {
      return error(url, 400, 'woocommerce_rest_product_not_purchasable', 'Sorry, this product cannot be purchased.');
    }
    if (entry.is_in_stock === false && entry.is_on_backorder !== true) {
      return error(url, 400, 'woocommerce_rest_product_out_of_stock', 'Sorry, this product is out of stock.');
    }
    found.cart.items.push({ key: `${found.token}-${found.cart.items.length + 1}`, entry });
    return cartResponse(url, 201, found.token, found.cart);
  };

  const route = (method: string, url: string, path: string, headers: Record<string, string>, json: unknown): Fetched => {
    const failStatus: number | undefined = settings.fail[path];
    if (failStatus !== undefined) return error(url, failStatus, 'rest_simulated', 'simulated failure');
    if (settings.nonJson.includes(path)) return respond(url, 200, '<html>not json</html>');

    if (method === 'GET' && path === '/products') return listProducts(url);
    const detail = /^\/products\/(\d+)$/.exec(path);
    if (method === 'GET' && detail) {
      const entry = findEntry(Number(detail[1]));
      return entry ? respond(url, 200, entry) : error(url, 404, 'woocommerce_rest_product_invalid_id', 'Invalid ID.');
    }

    if (method === 'GET' && path === '/cart') return getCart(url, headers);
    if (method === 'POST' && path === '/cart/add-item') return addItem(url, headers, json);
    if (method === 'POST' && path === '/cart/update-customer') {
      const found = cartFor(headers);
      if (!found) return error(url, 401, 'woocommerce_rest_missing_cart_token', 'The cart token is missing.');
      return cartResponse(url, 200, found.token, found.cart);
    }
    if (method === 'DELETE' && path === '/cart/items') {
      const found = cartFor(headers);
      if (!found) return error(url, 401, 'woocommerce_rest_missing_cart_token', 'The cart token is missing.');
      if (settings.cartWontEmpty) return error(url, 500, 'woocommerce_rest_cart_error', 'Could not empty the cart.');
      found.cart.items.splice(0);
      return cartResponse(url, 200, found.token, found.cart, []);
    }
    return error(url, 404, 'rest_no_route', 'No route was found');
  };

  return {
    calls,
    settings,
    cartSize(token: string): number {
      return carts.get(token)?.items.length ?? 0;
    },

    async get(url: string, options: RequestOptions = {}): Promise<Fetched> {
      record('GET', url, options.headers, undefined);
      const path = pathOf(url);
      if (settings.robots.includes(path)) throw new FetchRefused('robots', url);
      if (settings.networkError.includes(path)) throw new Error('socket hang up');
      return route('GET', url, path, options.headers ?? {}, undefined);
    },

    async send(method: 'POST' | 'PUT' | 'DELETE', url: string, options: RequestOptions & { json?: unknown } = {}): Promise<Fetched> {
      record(method, url, options.headers, options.json);
      if (settings.refuseWrites) {
        throw new FetchRefused('write-not-authorized', url, 'ownership of this shop has not been verified');
      }
      const path = pathOf(url);
      if (settings.networkError.includes(path)) throw new Error('socket hang up');
      return route(method, url, path, options.headers ?? {}, options.json);
    },
  };
}

export function makeContext(fetcher: Fetcher): CollectContext {
  return { store: new URL(ORIGIN), fetcher, now: () => new Date(FIXED_NOW), log: () => {} };
}

/** The observation a collector should produce for a value read at FIXED_NOW. */
export function obs<T>(value: T, raw: string, locator: string, surface: Surface = 'platform') {
  return { value, raw, surface, locator, fetchedAt: FIXED_NOW };
}

export const usd = (units: number) => ({ units, currency: 'USD' });
