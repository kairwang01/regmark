// The WooCommerce Store API, as much of it as the fixture imitates.
//
// A pure request handler: no sockets, no clock. server.ts does the HTTP.
// Products are answered from what the storefront API SAYS (platform); the
// cart is priced from what the checkout CHARGES (checkout). The two can
// disagree on purpose, so nothing here may take a price from the wrong one.

import { createHash, randomBytes } from 'node:crypto';
import type { CheckoutTruth, ProductSays, Shop, VariantSays } from './shop.ts';

export type ApiRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
  origin: string;
};
export type ApiResponse = { status: number; headers: Record<string, string>; json: unknown };
export type CartSnapshot = { token: string; items: { id: number; sku: string; quantity: number }[] };
export type StoreApi = {
  /** Returns null when the path is not under /wp-json/wc/store/v1. */
  handle(req: ApiRequest): ApiResponse | null;
  /** Every cart that currently exists, for tests that check nothing was left behind. */
  carts(): CartSnapshot[];
};

const BASE = '/wp-json/wc/store/v1';
const ADDRESS_FIELDS = ['country', 'postcode', 'state', 'city'] as const;

/** "39.00" becomes "3900". Works on the decimal string itself, so no rounding surprises. */
export function minor(decimal: string): string {
  const [whole = '0', fraction = ''] = decimal.split('.');
  if (fraction.length > 2) throw new Error(`minor: more than two decimals in ${decimal}`);
  return String(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}

function currencyBlock(code: string) {
  return {
    currency_code: code,
    currency_symbol: '$',
    currency_minor_unit: 2,
    currency_decimal_separator: '.',
    currency_thousand_separator: ',',
    currency_prefix: '$',
    currency_suffix: '',
  };
}

type Outcome = { status: number; json: unknown; headers?: Record<string, string> };
const ok = (status: number, json: unknown): Outcome => ({ status, json });
const fail = (status: number, code: string, message: string): Outcome => ({
  status,
  json: { code, message, data: { status } },
});
const noRoute = () => fail(404, 'rest_no_route', 'No route was found matching the URL and request method.');

type Address = { country: string; postcode: string; state: string; city: string };
type Cart = { token: string; items: { id: number; quantity: number }[]; address: Address };
type Sellable = { product: ProductSays; variant: VariantSays; checkout: CheckoutTruth };
type ShippingPackage = {
  package_id: number;
  name: string;
  destination: Address;
  shipping_rates: { rate_id: string; name: string; price: string; currency_code: string; currency_minor_unit: number; selected: boolean }[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intParam(raw: string | null, fallback: number): number {
  return raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : fallback;
}

/** A simple product sells as itself: one variant whose id is the product id. */
function isSimple(p: ProductSays): boolean {
  return p.platform.length === 1 && p.platform[0]!.wooId === p.wooId;
}

function permalink(origin: string, slug: string, options: Record<string, string>): string {
  const query = Object.entries(options)
    .map(([name, value]) => `attribute_pa_${encodeURIComponent(name.toLowerCase())}=${encodeURIComponent(value.toLowerCase())}`)
    .join('&');
  return `${origin}/product/${slug}/${query ? `?${query}` : ''}`;
}

function variantPrices(v: VariantSays, currency: string) {
  return {
    price: minor(v.price),
    regular_price: minor(v.listPrice ?? v.price),
    sale_price: minor(v.price),
    price_range: null,
    ...currencyBlock(v.currency ?? currency),
  };
}

function optionNames(p: ProductSays): string[] {
  const names: string[] = [];
  for (const v of p.platform) {
    for (const name of Object.keys(v.options)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

function termsOf(p: ProductSays, name: string) {
  const values = [...new Set(p.platform.map((v) => v.options[name]).filter((x): x is string => x !== undefined))];
  return values.map((value, i) => ({ id: i + 1, name: value, slug: value.toLowerCase() }));
}

function parentJson(p: ProductSays, origin: string, currency: string) {
  const simple = isSimple(p);
  const first = p.platform[0]!;
  return {
    id: p.wooId,
    name: p.title,
    slug: p.slug,
    parent: 0,
    type: simple ? 'simple' : 'variable',
    variation: '',
    permalink: `${origin}/product/${p.slug}/`,
    sku: simple ? first.sku : '',
    on_sale: first.listPrice !== null,
    prices: variantPrices(first, currency),
    is_purchasable: true,
    is_in_stock: p.platform.some((v) => v.stock === 'in_stock'),
    attributes: simple
      ? []
      : optionNames(p).map((name, i) => ({
          id: i + 1,
          name,
          taxonomy: `pa_${name.toLowerCase()}`,
          has_variations: true,
          terms: termsOf(p, name),
        })),
    variations: simple
      ? []
      : p.platform.map((v) => ({
          id: v.wooId,
          attributes: Object.entries(v.options).map(([name, value]) => ({ name, value: value.toLowerCase() })),
        })),
  };
}

function variationJson(p: ProductSays, v: VariantSays, origin: string, currency: string) {
  return {
    id: v.wooId,
    name: p.title,
    slug: p.slug,
    parent: p.wooId,
    type: 'variation',
    variation: Object.entries(v.options).map(([name, value]) => `${name}: ${value}`).join(', '),
    permalink: permalink(origin, p.slug, v.options),
    sku: v.sku,
    on_sale: v.listPrice !== null,
    prices: variantPrices(v, currency),
    is_purchasable: true,
    is_in_stock: v.stock === 'in_stock',
    attributes: [],
    variations: [],
  };
}

function lineKey(token: string, id: number): string {
  return createHash('sha256').update(`${token}:${id}`).digest('hex').slice(0, 32);
}

export function createStoreApi(shop: Shop): StoreApi {
  const parents = new Map<number, ProductSays>();
  const variations = new Map<number, { product: ProductSays; variant: VariantSays }>();
  // Only what the checkout accepts can be added to a cart; a variable parent is not in here.
  const sellable = new Map<number, Sellable>();

  for (const p of shop.products) {
    parents.set(p.wooId, p);
    if (!isSimple(p)) for (const v of p.platform) variations.set(v.wooId, { product: p, variant: v });
    for (const checkout of p.checkout) {
      const variant = p.platform.find((v) => v.wooId === checkout.wooId);
      if (!variant) throw new Error(`store-api: checkout id ${checkout.wooId} has no platform entry`);
      sellable.set(checkout.wooId, { product: p, variant, checkout });
    }
  }

  const carts = new Map<string, Cart>();

  // A cart token the server does not know gets a fresh cart, never the old token back.
  function resolveCart(token: string | undefined): Cart {
    const existing = token !== undefined ? carts.get(token) : undefined;
    if (existing) return existing;
    const fresh: Cart = {
      token: randomBytes(16).toString('hex'),
      items: [],
      address: { country: '', postcode: '', state: '', city: '' },
    };
    carts.set(fresh.token, fresh);
    return fresh;
  }

  function listProducts(query: URLSearchParams, origin: string): Outcome {
    const perPage = Math.min(100, Math.max(1, intParam(query.get('per_page'), 10)));
    const page = Math.max(1, intParam(query.get('page'), 1));
    const total = shop.products.length;
    const slice = shop.products.slice((page - 1) * perPage, page * perPage);
    return {
      status: 200,
      json: slice.map((p) => parentJson(p, origin, shop.currency)),
      headers: {
        'x-wp-total': String(total),
        'x-wp-totalpages': String(Math.ceil(total / perPage)),
      },
    };
  }

  function productById(raw: string, origin: string): Outcome {
    const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const parent = parents.get(id);
    if (parent) return ok(200, parentJson(parent, origin, shop.currency));
    const variation = variations.get(id);
    if (variation) return ok(200, variationJson(variation.product, variation.variant, origin, shop.currency));
    return fail(404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
  }

  function shippingRates(cart: Cart, subtotal: number): ShippingPackage[] {
    if (cart.items.length === 0 || cart.address.country !== shop.shipping.country) return [];
    const freeFrom = Number(minor(shop.shipping.freeFrom));
    const free = subtotal >= freeFrom;
    const rate = {
      rate_id: free ? 'free_shipping:1' : 'flat_rate:1',
      name: free ? 'Free shipping' : 'Flat rate',
      price: free ? '0' : minor(shop.shipping.flat),
      currency_code: shop.currency,
      currency_minor_unit: 2,
      selected: true,
    };
    return [{ package_id: 0, name: 'Shipping', destination: { ...cart.address }, shipping_rates: [rate] }];
  }

  function cartJson(cart: Cart, origin: string): unknown {
    const items = cart.items.map((item) => {
      const s = sellable.get(item.id)!;
      const unit = minor(s.checkout.price);
      const lineTotal = String(Number(unit) * item.quantity);
      return {
        key: lineKey(cart.token, item.id),
        id: item.id,
        quantity: item.quantity,
        name: s.product.title,
        sku: s.checkout.sku,
        permalink: permalink(origin, s.product.slug, s.variant.options),
        prices: { price: unit, regular_price: unit, sale_price: unit, price_range: null, ...currencyBlock(shop.currency) },
        totals: { line_subtotal: lineTotal, line_total: lineTotal, ...currencyBlock(shop.currency) },
      };
    });
    const itemsTotal = String(items.reduce((sum, line) => sum + Number(line.totals.line_total), 0));
    const rates = shippingRates(cart, Number(itemsTotal));
    const shipping = rates[0]?.shipping_rates[0]?.price ?? '0';
    return {
      items,
      items_count: cart.items.reduce((n, item) => n + item.quantity, 0),
      needs_shipping: items.length > 0,
      shipping_address: { ...cart.address },
      shipping_rates: rates,
      totals: {
        total_items: itemsTotal,
        total_shipping: shipping,
        total_tax: '0',
        total_price: String(Number(itemsTotal) + Number(shipping)),
        ...currencyBlock(shop.currency),
      },
    };
  }

  function addItem(cart: Cart, body: unknown, origin: string): Outcome {
    const input = isRecord(body) ? body : {};
    const id = input.id;
    const quantity = input.quantity ?? 1;
    if (typeof id !== 'number') return fail(400, 'woocommerce_rest_cart_invalid_product', 'This product cannot be added to the cart.');
    const s = sellable.get(id);
    if (!s) return fail(400, 'woocommerce_rest_cart_invalid_product', 'This product cannot be added to the cart.');
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      return fail(400, 'woocommerce_rest_cart_invalid_quantity', 'Quantity must be a positive integer.');
    }
    if (s.checkout.refuses === 'out_of_stock') {
      return fail(400, 'woocommerce_rest_product_out_of_stock', 'You cannot add that product to the cart because it is out of stock.');
    }
    if (s.checkout.refuses === 'not_purchasable') {
      return fail(400, 'woocommerce_rest_product_not_purchasable', 'This product cannot be purchased.');
    }
    const line = cart.items.find((item) => item.id === id);
    if (line) line.quantity += quantity;
    else cart.items.push({ id, quantity });
    return ok(201, cartJson(cart, origin));
  }

  function updateCustomer(cart: Cart, body: unknown, origin: string): Outcome {
    const input = isRecord(body) ? body : {};
    const address = isRecord(input.shipping_address) ? input.shipping_address : {};
    for (const field of ADDRESS_FIELDS) {
      const value = address[field];
      if (typeof value === 'string') cart.address[field] = value;
    }
    return ok(200, cartJson(cart, origin));
  }

  function removeItem(cart: Cart, body: unknown, origin: string): Outcome {
    const key = isRecord(body) ? body.key : undefined;
    const index = cart.items.findIndex((item) => typeof key === 'string' && lineKey(cart.token, item.id) === key);
    if (index === -1) return fail(409, 'woocommerce_rest_cart_invalid_key', 'Cart item no longer exists or is invalid.');
    cart.items.splice(index, 1);
    return ok(200, cartJson(cart, origin));
  }

  type CartRoute = { write: boolean; run: (cart: Cart, req: ApiRequest) => Outcome };
  const cartRoutes = new Map<string, CartRoute>([
    ['GET /cart', { write: false, run: (cart, req) => ok(200, cartJson(cart, req.origin)) }],
    ['POST /cart/add-item', { write: true, run: (cart, req) => addItem(cart, req.body, req.origin) }],
    ['POST /cart/update-customer', { write: true, run: (cart, req) => updateCustomer(cart, req.body, req.origin) }],
    ['POST /cart/remove-item', { write: true, run: (cart, req) => removeItem(cart, req.body, req.origin) }],
    [
      'DELETE /cart/items',
      {
        write: true,
        run: (cart) => {
          cart.items = [];
          return ok(200, []);
        },
      },
    ],
  ]);

  return {
    handle(req) {
      if (req.path !== BASE && !req.path.startsWith(`${BASE}/`)) return null;
      const route = `${req.method} ${req.path.slice(BASE.length) || '/'}`;

      if (route === 'GET /products') {
        const out = listProducts(req.query, req.origin);
        return { status: out.status, headers: out.headers ?? {}, json: out.json };
      }
      const single = /^GET \/products\/([^/]+)$/.exec(route);
      if (single) {
        const out = productById(single[1]!, req.origin);
        return { status: out.status, headers: {}, json: out.json };
      }

      const cartRoute = cartRoutes.get(route);
      if (!cartRoute) {
        const out = noRoute();
        return { status: out.status, headers: {}, json: out.json };
      }
      // Without any token there is no cart to attach to, so no cart is created for this refusal.
      if (cartRoute.write && req.headers['cart-token'] === undefined) {
        return {
          status: 401,
          headers: {},
          json: {
            code: 'woocommerce_rest_missing_nonce',
            message: 'Missing the Nonce header. This endpoint requires a valid nonce.',
            data: { status: 401 },
          },
        };
      }
      const cart = resolveCart(req.headers['cart-token']);
      const out = cartRoute.run(cart, req);
      return { status: out.status, headers: { 'cart-token': cart.token }, json: out.json };
    },

    carts(): CartSnapshot[] {
      return [...carts.values()].map((cart) => ({
        token: cart.token,
        items: cart.items.map((item) => ({
          id: item.id,
          sku: sellable.get(item.id)!.checkout.sku,
          quantity: item.quantity,
        })),
      }));
    },
  };
}
