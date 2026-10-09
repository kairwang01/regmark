// An in-memory Shopify storefront cart (the Ajax cart API) for the probe
// tests. Like a real shop it keeps one cart per session, found by the `cart`
// cookie, so a client that does not send its cookies back reaches a new,
// empty cart. Answers have the shapes shopify.dev documents, and every call is
// recorded so that tests can assert on what was asked, with which cookies and
// in what order.

import { FetchRefused } from '@regmark/core';
import type { CollectContext, Fetched, Fetcher, RequestOptions } from '@regmark/core';

export const ORIGIN = 'https://shop.example';
export const FIXED_NOW = '2026-10-09T12:00:00.000Z';

export type FakeVariant = {
  id: number;
  productId: number;
  title: string;
  sku: string;
  /** The variant's price in hundredths of the currency unit, as Shopify states every cart amount. */
  price: number;
  /** The price after an automatic discount on the line, when one applies. */
  finalPrice?: number;
  available: boolean;
  requiresShipping?: boolean;
};

export type FakeRate = { name: string; price: string; currency?: string | null };

export type Call = {
  method: string;
  url: string;
  /** Path without the query, such as "/cart/add.js". */
  path: string;
  /** The query string without the "?". */
  query: string;
  headers: Record<string, string>;
  asOwner: boolean;
  json?: unknown;
};

export type Settings = {
  variants: FakeVariant[];
  currency: string;
  rates: FakeRate[];
  /** Countries that get rates. Any other gets a 422 keyed by the country field. */
  shipsTo: string[];
  /** How many rate checks answer null after prepare, before the rates are ready. */
  pendingChecks: number;
  /** Replaces every rate check's answer. */
  rateAnswer: { status: number; body: string } | undefined;
  /** Path to a bot protection challenge with that status: an HTML page and a cf-mitigated header. */
  challenge: Record<string, number>;
  /** Path to an HTTP status answered with a JSON error body. */
  fail: Record<string, number>;
  /** Paths answered 200 with an HTML page. */
  html: string[];
  /** Path to the location of a 302, as a password-protected shop answers. */
  redirect: Record<string, string>;
  /** Paths whose request dies with a network error. */
  networkError: string[];
  /** clear.js answers 200 with the cart and keeps its items. */
  cartWontEmpty: boolean;
  /** Every write and every owner read throws write-not-authorized, as in a run that did not verify ownership. */
  refuseWrites: boolean;
  /** Extra Set-Cookie lines sent on every answer to the path. */
  setCookie: Record<string, string[]>;
  /** Variant ids a new cart already holds. */
  startWith: number[];
  /** Path to answers given in place of the shop's, one per request, in order; after the last the shop answers again. */
  canned: Record<string, CannedAnswer[]>;
};

export type CannedAnswer = { status: number; headers?: Record<string, string>; body: string };

export type FakeCart = Fetcher & {
  readonly calls: Call[];
  readonly settings: Settings;
  /** Units in the cart of the given session token. */
  cartSize(token: string): number;
};

type Line = { variant: FakeVariant; quantity: number };
type Cart = { token: string; lines: Line[]; prepared: Set<string>; checks: number };

export const TEE_M: FakeVariant = { id: 101, productId: 10, title: 'Classic Tee', sku: 'TEE-M', price: 3900, available: true };
export const TEE_L: FakeVariant = { id: 102, productId: 10, title: 'Classic Tee', sku: 'TEE-L', price: 3900, available: false };
export const MUG: FakeVariant = { id: 201, productId: 20, title: 'Enamel Mug', sku: 'MUG-1', price: 1500, finalPrice: 1200, available: true };
export const GIFT_CARD: FakeVariant = { id: 301, productId: 30, title: 'Gift Card', sku: 'GIFT-25', price: 2500, available: true, requiresShipping: false };

function defaultSettings(): Settings {
  return {
    variants: [TEE_M, TEE_L, MUG, GIFT_CARD],
    currency: 'USD',
    // The cheaper rate is listed second, so a probe that takes the first one is caught.
    rates: [
      { name: 'Express', price: '15.00' },
      { name: 'Standard', price: '6.20' },
    ],
    shipsTo: ['US', 'CA'],
    pendingChecks: 0,
    rateAnswer: undefined,
    challenge: {},
    fail: {},
    html: [],
    redirect: {},
    networkError: [],
    cartWontEmpty: false,
    refuseWrites: false,
    setCookie: {},
    startWith: [],
    canned: {},
  };
}

const JSON_TYPE = 'application/json; charset=utf-8';
const CHALLENGE_PAGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Your connection needs to be verified before you can proceed</body></html>';

export function createFakeCart(options: Partial<Settings> = {}): FakeCart {
  const settings: Settings = { ...defaultSettings(), ...options };
  const calls: Call[] = [];
  const carts = new Map<string, Cart>();
  let sessions = 0;

  const respond = (url: string, status: number, body: string, headers: Record<string, string> = {}): Fetched => ({
    url,
    status,
    headers: { 'content-type': JSON_TYPE, ...headers },
    body,
    fetchedAt: FIXED_NOW,
  });

  const lineJson = (line: Line) => {
    const { variant, quantity } = line;
    const final = variant.finalPrice ?? variant.price;
    return {
      id: variant.id,
      properties: null,
      quantity,
      variant_id: variant.id,
      key: `${variant.id}:5f2c1d0e9b8a7c6d`,
      title: variant.title,
      price: variant.price,
      original_price: variant.price,
      discounted_price: final,
      line_price: final * quantity,
      original_line_price: variant.price * quantity,
      total_discount: (variant.price - final) * quantity,
      discounts: [],
      sku: variant.sku,
      grams: 200,
      vendor: 'Northfold',
      taxable: true,
      product_id: variant.productId,
      gift_card: variant.requiresShipping === false,
      final_price: final,
      final_line_price: final * quantity,
      url: `/products/item-${variant.productId}?variant=${variant.id}`,
      handle: `item-${variant.productId}`,
      requires_shipping: variant.requiresShipping ?? true,
      product_title: variant.title,
      variant_title: null,
    };
  };

  const cartJson = (cart: Cart) => {
    const items = cart.lines.map(lineJson);
    const total = items.reduce((sum, item) => sum + item.final_line_price, 0);
    const original = items.reduce((sum, item) => sum + item.original_line_price, 0);
    return {
      token: `${cart.token}?key=0d9909213054e22d`,
      note: null,
      attributes: {},
      original_total_price: original,
      total_price: total,
      total_discount: original - total,
      total_weight: items.reduce((sum, item) => sum + item.grams * item.quantity, 0),
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
      items,
      requires_shipping: items.some((item) => item.requires_shipping),
      currency: settings.currency,
      items_subtotal_price: total,
      cart_level_discount_applications: [],
    };
  };

  /** The session's cart, or a new one with the Set-Cookie lines that start a session. */
  const session = (headers: Record<string, string>): { cart: Cart; cookies: string[] } => {
    const token = /(?:^|;\s*)cart=([^;]+)/.exec(headers.cookie ?? '')?.[1];
    const existing = token === undefined ? undefined : carts.get(token);
    if (existing) return { cart: existing, cookies: [] };
    sessions += 1;
    const cart: Cart = { token: `c${sessions}`, lines: [], prepared: new Set(), checks: 0 };
    for (const id of settings.startWith) {
      const variant = settings.variants.find((v) => v.id === id);
      if (variant) cart.lines.push({ variant, quantity: 1 });
    }
    carts.set(cart.token, cart);
    // The expiry date has a comma in it, which is why the fetcher joins several of these with newlines.
    return {
      cart,
      cookies: [
        `cart=${cart.token}; path=/; expires=Fri, 23 Oct 2026 12:00:00 GMT; SameSite=Lax`,
        `_shopify_essential=:s${sessions}:; path=/; HttpOnly; Secure; SameSite=Lax`,
      ],
    };
  };

  const cartError = (url: string, status: number, description: string, cookies: string[]) =>
    withCookies(respond(url, status, JSON.stringify({ status, message: 'Cart Error', description })), cookies);

  const withCookies = (res: Fetched, cookies: string[]): Fetched => {
    if (cookies.length > 0) res.headers['set-cookie'] = cookies.join('\n');
    return res;
  };

  const addItems = (url: string, cart: Cart, json: unknown, cookies: string[]): Fetched => {
    const items = typeof json === 'object' && json !== null ? (json as { items?: unknown }).items : undefined;
    const first = Array.isArray(items) && items.length === 1 ? (items[0] as { id?: unknown; quantity?: unknown }) : undefined;
    if (!first || typeof first.id !== 'number' || first.quantity !== 1) {
      const body = { status: 'bad_request', message: 'Parameter Missing or Invalid', description: 'Required parameter missing or invalid: items' };
      return withCookies(respond(url, 400, JSON.stringify(body)), cookies);
    }
    const variant = settings.variants.find((v) => v.id === first.id);
    if (!variant) return cartError(url, 422, 'Cannot find variant', cookies);
    if (!variant.available) return cartError(url, 422, `The product '${variant.title}' is already sold out.`, cookies);
    const line = cart.lines.find((l) => l.variant.id === variant.id);
    if (line) line.quantity += 1;
    else cart.lines.push({ variant, quantity: 1 });
    const added = line ?? cart.lines[cart.lines.length - 1]!;
    // Rates belong to the cart as it was; a change means preparing again.
    cart.prepared.clear();
    return withCookies(respond(url, 200, JSON.stringify({ items: [lineJson(added)] })), cookies);
  };

  const rateCheck = (url: string, query: string, cart: Cart, cookies: string[]): Fetched => {
    if (settings.rateAnswer) return withCookies(respond(url, settings.rateAnswer.status, settings.rateAnswer.body), cookies);
    if (!cart.prepared.has(query)) return withCookies(respond(url, 200, 'null'), cookies);
    cart.checks += 1;
    if (cart.checks <= settings.pendingChecks) return withCookies(respond(url, 200, 'null'), cookies);
    const country = new URLSearchParams(query).get('shipping_address[country]') ?? '';
    if (!settings.shipsTo.includes(country)) {
      return withCookies(respond(url, 422, JSON.stringify({ country: ['is not supported'] })), cookies);
    }
    const shipping_rates = settings.rates.map((rate) => ({
      name: rate.name,
      presentment_name: rate.name,
      code: rate.name,
      price: rate.price,
      markup: null,
      source: 'shopify',
      delivery_date: null,
      delivery_range: null,
      delivery_days: [],
      compare_price: null,
      phone_required: false,
      currency: rate.currency ?? null,
    }));
    return withCookies(respond(url, 200, JSON.stringify({ shipping_rates })), cookies);
  };

  const route = (method: string, url: string, path: string, query: string, headers: Record<string, string>, json: unknown): Fetched => {
    const canned = settings.canned[path]?.shift();
    if (canned) return { url, status: canned.status, headers: { ...(canned.headers ?? {}) }, body: canned.body, fetchedAt: FIXED_NOW };
    const challenge = settings.challenge[path];
    if (challenge !== undefined) {
      return respond(url, challenge, CHALLENGE_PAGE, { 'content-type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge', server: 'cloudflare' });
    }
    const location = settings.redirect[path];
    if (location !== undefined) return respond(url, 302, '', { location, 'content-type': 'text/html; charset=utf-8' });
    if (settings.html.includes(path)) return respond(url, 200, '<!DOCTYPE html><html><body>Online store</body></html>', { 'content-type': 'text/html; charset=utf-8' });

    const { cart, cookies } = session(headers);
    const extra = settings.setCookie[path] ?? [];
    const all = [...cookies, ...extra];
    const failStatus = settings.fail[path];
    if (failStatus !== undefined) {
      return withCookies(respond(url, failStatus, JSON.stringify({ status: failStatus, message: 'Error', description: 'simulated failure' })), all);
    }

    if (method === 'GET' && path === '/cart.js') return withCookies(respond(url, 200, JSON.stringify(cartJson(cart))), all);
    if (method === 'POST' && path === '/cart/add.js') return addItems(url, cart, json, all);
    if (method === 'POST' && path === '/cart/clear.js') {
      if (!settings.cartWontEmpty) {
        cart.lines.splice(0);
        cart.prepared.clear();
      }
      return withCookies(respond(url, 200, JSON.stringify(cartJson(cart))), all);
    }
    if (method === 'POST' && path === '/cart/prepare_shipping_rates.json') {
      cart.prepared.add(query);
      cart.checks = 0;
      return withCookies(respond(url, 202, ''), all);
    }
    if (method === 'GET' && path === '/cart/async_shipping_rates.json') return rateCheck(url, query, cart, all);
    return respond(url, 404, '<!DOCTYPE html><html><body>404 Not Found</body></html>', { 'content-type': 'text/html; charset=utf-8' });
  };

  const handle = (method: string, url: string, options: RequestOptions & { json?: unknown }): Fetched => {
    const u = new URL(url);
    const call: Call = { method, url, path: u.pathname, query: u.search.slice(1), headers: { ...(options.headers ?? {}) }, asOwner: options.asOwner === true };
    // A copy, so a later mutation of the caller's object does not rewrite history.
    if (options.json !== undefined) call.json = JSON.parse(JSON.stringify(options.json)) as unknown;
    calls.push(call);
    if (settings.refuseWrites && (method !== 'GET' || options.asOwner)) {
      throw new FetchRefused('write-not-authorized', url, 'ownership of this shop has not been verified');
    }
    if (settings.networkError.includes(u.pathname)) throw new FetchRefused('network', url, 'socket hang up');
    return route(method, url, u.pathname, u.search.slice(1), options.headers ?? {}, options.json);
  };

  return {
    calls,
    settings,
    cartSize(token: string): number {
      return (carts.get(token)?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
    },
    async get(url: string, options: RequestOptions = {}): Promise<Fetched> {
      return handle('GET', url, options);
    },
    async send(method: 'POST' | 'PUT' | 'DELETE', url: string, options: RequestOptions & { json?: unknown } = {}): Promise<Fetched> {
      return handle(method, url, options);
    },
    async query(): Promise<Fetched> {
      throw new Error('the Shopify probe never posts a query');
    },
  };
}

export function makeContext(fetcher: Fetcher): CollectContext {
  return { store: new URL(ORIGIN), fetcher, now: () => new Date(FIXED_NOW), log: () => {} };
}

/** The observation the probe should produce for a value read at FIXED_NOW. */
export function obs<T>(value: T, raw: string, locator: string) {
  return { value, raw, surface: 'checkout' as const, locator, fetchedAt: FIXED_NOW };
}

export const usd = (units: number) => ({ units, currency: 'USD' });
