// The Shopify checkout probe: one session cart for the whole run, one unit of
// each target put in it through the storefront's own cart endpoints (the Ajax
// cart API every Shopify theme uses), the line price and the cheapest
// shipping rate to the probe destination read back, and the cart emptied
// after every target. It changes state on the shop, so it runs only after
// ownership is verified, and every problem is reported, never swallowed.
//
// It never goes further than the cart. Tax is worked out at checkout, which
// the probe does not reach, and no storefront endpoint states it before then.
// So no landed total is recorded: a total without tax would be compared as if
// it were what the buyer pays.

import { fromMinor, minorUnitOf, money } from '@regmark/core';
import type { CollectContext, CollectIssue, Fetched, Money, Observation, ShippingQuote, Sighting, VariantIds } from '@regmark/core';
import { cookieHeader, keepCookies } from './cookies.ts';
import type { CookieJar } from './cookies.ts';
import { errorText, isOk, isOwnershipRefusal, isRecord, nonEmptyString, parseJson } from './http.ts';

export type ShopifyProbeTarget = { variantId: string; productId?: string; sku?: string; url?: string };
/**
 * `city` is accepted for symmetry with the WooCommerce probe and not sent:
 * Shopify's rate endpoints take a postcode, a country and a province. `wait`
 * is how the rate check pauses between checks, for tests to replace.
 */
export type ShopifyProbeOptions = {
  shipTo: { country: string; postcode?: string; state?: string; city?: string };
  wait?: (ms: number) => Promise<void>;
};

type Run = {
  ctx: CollectContext;
  origin: string;
  shipTo: ShopifyProbeOptions['shipTo'];
  wait: (ms: number) => Promise<void>;
  cookies: CookieJar;
  /** The cart's currency, read when it was opened. Every amount in the cart is in it. */
  currency: string | null;
  /** True from the moment an item may have reached the cart until the cart is seen empty again. */
  dirty: boolean;
  sightings: Sighting[];
  issues: CollectIssue[];
};

/**
 * Something other than the cart answered: bot protection, a password page, a
 * refusal of the client. Every later request would get the same answer, and
 * repeating it is what bot protection watches for, so the probe stops
 * instead of trying the next target.
 */
class NotTheCart extends Error {}

// Statuses Shopify's edge answers with in place of the cart when it takes a
// client for a bot: 429 and 403 with a challenge page, 430 for a request it
// rejects as possibly malicious.
const CHALLENGE_STATUSES = new Set([403, 429, 430]);

// Shopify works out rates in the background and answers null until they are
// ready. Each check waits longer than the last, whatever the fetcher's own
// spacing (which may be none): the shop gets several seconds, and the checks
// are not the burst of identical requests bot protection watches for.
const RATE_WAITS_MS = [500, 1000, 2000, 4000] as const;
const RATE_CHECKS = RATE_WAITS_MS.length;

const sleep = (ms: number) => new Promise<void>((wake) => setTimeout(wake, ms));

export async function probeShopifyCart(
  ctx: CollectContext,
  targets: readonly ShopifyProbeTarget[],
  options: ShopifyProbeOptions,
): Promise<{ sightings: Sighting[]; issues: CollectIssue[] }> {
  if (targets.length === 0) return { sightings: [], issues: [] };
  const run: Run = {
    ctx,
    origin: ctx.store.origin,
    shipTo: options.shipTo,
    wait: options.wait ?? sleep,
    cookies: new Map(),
    currency: null,
    dirty: false,
    sightings: [],
    issues: [],
  };
  try {
    await runProbe(run, targets);
  } catch (err) {
    // The ownership refusal is the one thing that discards what was gathered: the run is not allowed to go on.
    if (isOwnershipRefusal(err)) return { sightings: [], issues: [ownershipIssue()] };
    run.issues.push(issue('probe-failed', errorText(err)));
  }
  return { sightings: run.sightings, issues: run.issues };
}

async function runProbe(run: Run, targets: readonly ShopifyProbeTarget[]): Promise<void> {
  if (!(await openCart(run))) return;

  for (const target of targets) {
    let stopped = false;
    try {
      await probeTarget(run, target);
    } catch (err) {
      if (isOwnershipRefusal(err)) throw err;
      stopped = err instanceof NotTheCart;
      run.issues.push(issue('probe-failed', `${target.variantId}: ${errorText(err)}${stopped ? '; the probe stopped' : ''}`));
    }
    const emptied = !run.dirty || (await emptyCart(run, target.variantId));
    // Whatever is asked next, the final check included, would be answered
    // the same way as the request that stopped the probe.
    if (stopped) return;
    // A failed cleanup must stop the sample: another target would join this
    // item, and the shipping quoted for it would be for both.
    if (!emptied) break;
  }

  await confirmEmpty(run);
}

/**
 * Reads the session's cart before anything is written. It shows that the
 * shop has a storefront cart at all (a headless shop has none), gives the
 * session its cookies and the cart its currency, and shows the cart is empty.
 */
async function openCart(run: Run): Promise<boolean> {
  let problem: string;
  try {
    const cart = cartBody(await read(run, `${run.origin}/cart.js`), 'cart.js');
    if (cart.items.length === 0) {
      run.currency = currencyCode(cart.currency);
      return true;
    }
    // The session is new, so the theme or an app put these there. The
    // probe's readings would include them, so it writes nothing.
    problem = 'the new cart already holds items';
  } catch (err) {
    if (isOwnershipRefusal(err)) throw err;
    problem = errorText(err);
  }
  run.issues.push(issue('probe-failed', `could not open a cart: ${problem}`));
  return false;
}

async function probeTarget(run: Run, target: ShopifyProbeTarget): Promise<void> {
  if (!/^\d+$/.test(target.variantId)) throw new Error(`not a variant id: ${target.variantId}`);

  const addUrl = `${run.origin}/cart/add.js`;
  run.dirty = true;
  const added = await write(run, addUrl, { items: [{ id: Number(target.variantId), quantity: 1 }] });

  const refused = notFromTheCart(added, 'add.js');
  if (refused !== undefined) {
    // A redirect or a 4xx turned the request away before the cart. Anything
    // else, such as a page served with 200, may have come after the add.
    if (added.status >= 300 && added.status < 500) run.dirty = false;
    throw new NotTheCart(refused);
  }

  const body = parseJson(added.body)?.value;
  if (isOk(added.status)) {
    await addedToCart(run, target, added, body);
    return;
  }

  const refusal = cartRefusal(added.status, body);
  if (refusal !== undefined) {
    // A product sold only by subscription refuses a plain add, which the
    // probe makes: that says nothing about whether it can be bought.
    if (await needsSellingPlan(run, target)) {
      run.issues.push(issue('probe-failed', `${target.variantId}: the cart refused it (${refusal}), and it is sold only by subscription, which the probe does not add; whether it can be bought was not judged`));
      return;
    }
    run.sightings.push({
      surface: 'checkout',
      scope: 'variant',
      ids: idsOf(target),
      purchasable: observe(false, refusal, addUrl, added.fetchedAt),
    });
    return;
  }
  throw new Error(`add.js returned HTTP ${added.status}`);
}

/**
 * Whether the target's product says it can be bought only with a selling
 * plan, from the product's own /products/<handle>.js. products.json does not
 * say. Asked only after the cart refused an add; when the answer cannot be
 * had, the refusal stands as the cart gave it.
 */
async function needsSellingPlan(run: Run, target: ShopifyProbeTarget): Promise<boolean> {
  let path: string;
  try {
    path = new URL(target.url ?? '').pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
  if (!/^\/products\/[^/]+$/.test(path)) return false;
  try {
    const res = await read(run, `${run.origin}${path}.js`);
    const product = isOk(res.status) ? parseJson(res.body)?.value : undefined;
    return isRecord(product) && product.requires_selling_plan === true;
  } catch (err) {
    if (isOwnershipRefusal(err)) throw err;
    return false;
  }
}

async function addedToCart(run: Run, target: ShopifyProbeTarget, added: Fetched, body: unknown): Promise<void> {
  const addUrl = `${run.origin}/cart/add.js`;
  const picked = pickLine(body, target.variantId);
  if (!picked) throw new Error('add.js response does not contain the requested variant');

  const sighting: Sighting = {
    surface: 'checkout',
    scope: 'variant',
    ids: idsOf(target),
    purchasable: observe(true, 'added', addUrl, added.fetchedAt),
  };
  run.sightings.push(sighting);

  // The line as the cart priced it. The cart was empty before this add, and
  // its currency is the one it opened with.
  const price = linePrice(picked.line, run.currency);
  if ('problem' in price) {
    run.issues.push(issue('probe-failed', `${target.variantId}: ${price.problem}`));
  } else {
    sighting.price = observe(price.value, price.raw, `${addUrl}#${picked.pointer}/${price.field}`, added.fetchedAt);
  }

  // A gift card or a download ships nothing, so there is no shipping to quote.
  if (picked.line.requires_shipping === false) return;
  // Rates are quoted for the whole cart. More than one unit on the line means
  // the variant was already there, and the quote would not be for one unit.
  if (picked.line.quantity !== 1) throw new Error('the cart holds more than the one unit added, so shipping was not estimated');

  try {
    await estimateShipping(run, target, sighting);
  } catch (err) {
    if (isOwnershipRefusal(err) || err instanceof NotTheCart) throw err;
    run.issues.push(issue('probe-failed', `${target.variantId}: shipping estimate failed: ${errorText(err)}`));
  }
}

type RateAnswer =
  | { kind: 'pending' }
  | { kind: 'ready'; rates: unknown[]; res: Fetched }
  | { kind: 'refused'; body: Record<string, unknown>; status: number };

/**
 * Asks for the rates to the probe destination and waits for them, by the
 * route Shopify recommends: prepare, then check until they are ready. The
 * cheapest rate is the one recorded, the least a buyer can pay to receive it.
 */
async function estimateShipping(run: Run, target: ShopifyProbeTarget, sighting: Sighting): Promise<void> {
  const query = shippingQuery(run.shipTo);
  const prepared = await write(run, `${run.origin}/cart/prepare_shipping_rates.json?${query}`);
  let answer = rateAnswer(prepared, 'prepare_shipping_rates.json');
  for (let check = 0; answer.kind === 'pending' && check < RATE_CHECKS; check++) {
    await run.wait(RATE_WAITS_MS[check]!);
    answer = rateAnswer(await read(run, `${run.origin}/cart/async_shipping_rates.json?${query}`), 'async_shipping_rates.json');
  }

  const country = run.shipTo.country.trim().toUpperCase();
  if (answer.kind === 'pending') throw new Error(`the rates were not ready after ${RATE_CHECKS} checks`);
  if (answer.kind === 'refused') {
    run.issues.push(rateRefusal(answer.body, answer.status, country, target));
    return;
  }
  if (answer.rates.length === 0) {
    run.issues.push(issue('no-shipping-rate', `no shipping rate for ${country} on ${labelOf(target)}`));
    return;
  }

  const cheapest = cheapestRate(answer.rates, run.currency);
  if (!cheapest) throw new Error('no shipping rate has a price that can be read');
  const quote: ShippingQuote = { free: cheapest.cost.units === 0, cost: cheapest.cost, country };
  sighting.shipping = observe(quote, cheapest.raw, `${answer.res.url}#/shipping_rates/${cheapest.index}/price`, answer.res.fetchedAt);
}

/**
 * Reads one answer of the rate endpoints. Prepare answers 202 with no body
 * (its documentation says null), and a check answers null until the rates
 * are ready; both mean "not yet". A page in place of JSON here fails this
 * target only: the cart itself still answered.
 */
function rateAnswer(res: Fetched, step: 'prepare_shipping_rates.json' | 'async_shipping_rates.json'): RateAnswer {
  const refused = turnedAway(res, step);
  if (refused !== undefined) throw new NotTheCart(refused);
  const parsed = res.body.trim() === '' ? { value: null } : parseJson(res.body);
  if (!parsed) throw new Error(`${step} answered with a page, not JSON (HTTP ${res.status})`);
  const body = parsed.value;
  if (isOk(res.status)) {
    if (isRecord(body) && Array.isArray(body.shipping_rates)) return { kind: 'ready', rates: body.shipping_rates, res };
    if (body === null || step === 'prepare_shipping_rates.json') return { kind: 'pending' };
    throw new Error(`${step} answered with something other than rates`);
  }
  if (res.status < 500 && isRecord(body)) return { kind: 'refused', body, status: res.status };
  throw new Error(`${step} returned HTTP ${res.status}`);
}

/**
 * The shop answered the rate request with errors. Errors keyed by an address
 * field, such as {"zip": ["is not valid for United States"]}, refuse the
 * destination. Errors under "error", and the {status, message, description}
 * envelope Shopify's Ajax endpoints answer any failure with, are the request
 * failing, which says nothing about where the shop ships.
 */
const GENERAL_ERROR_KEYS: ReadonlySet<string> = new Set(['error', 'errors', 'status', 'message', 'description']);

function rateRefusal(body: Record<string, unknown>, status: number, country: string, target: ShopifyProbeTarget): CollectIssue {
  const general: string[] = [];
  const fields: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    const texts = (Array.isArray(value) ? value : [value]).filter(nonEmptyString);
    if (GENERAL_ERROR_KEYS.has(key)) general.push(...texts);
    else fields.push(...texts.map((text) => `${key} ${text}`));
  }
  if (fields.length > 0) return issue('no-shipping-rate', `no shipping rate for ${country} on ${labelOf(target)}: ${fields.join('; ')}`);
  const detail = general.length > 0 ? general.join('; ') : `HTTP ${status}`;
  return issue('probe-failed', `${target.variantId}: the shop could not calculate shipping rates: ${detail}`);
}

type Rate = { index: number; cost: Money; raw: string };

/**
 * The cheapest rate whose price reads. Rate prices are decimal strings in
 * whole units ("6.00"), unlike the cart's integers. Shopify's own example
 * gives each rate a currency of null; the rates are quoted for this cart, so
 * a rate without one is taken to be in the cart's currency.
 */
function cheapestRate(rates: readonly unknown[], cartCurrency: string | null): Rate | undefined {
  let best: Rate | undefined;
  rates.forEach((rate, index) => {
    if (!isRecord(rate)) return;
    const raw = typeof rate.price === 'string' ? rate.price.trim() : typeof rate.price === 'number' ? String(rate.price) : '';
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return;
    const cost = money(raw, currencyCode(rate.currency) ?? cartCurrency);
    if (!best || cost.units < best.cost.units) best = { index, cost, raw };
  });
  return best;
}

/** The address as Shopify's rate endpoints take it, in the order its documentation writes it. */
function shippingQuery(shipTo: ShopifyProbeOptions['shipTo']): string {
  const params = new URLSearchParams();
  if (nonEmptyString(shipTo.postcode)) params.set('shipping_address[zip]', shipTo.postcode.trim());
  params.set('shipping_address[country]', shipTo.country.trim().toUpperCase());
  if (nonEmptyString(shipTo.state)) params.set('shipping_address[province]', shipTo.state.trim());
  return params.toString();
}

async function emptyCart(run: Run, variantId: string): Promise<boolean> {
  let reason: string;
  try {
    const res = await write(run, `${run.origin}/cart/clear.js`);
    // The answer is the cart itself, so it is the proof the cart is empty.
    if (isOk(res.status) && isEmptyCart(parseJson(res.body)?.value)) {
      run.dirty = false;
      return true;
    }
    reason = notFromTheCart(res, 'clear.js') ?? (isOk(res.status) ? 'the cart it returned is not empty' : `HTTP ${res.status}`);
  } catch (err) {
    if (isOwnershipRefusal(err)) throw err;
    reason = errorText(err);
  }
  run.issues.push(issue('cart-not-emptied', `could not empty the probe cart after ${variantId} (${reason}); no further target was added to it`));
  return false;
}

/**
 * Leaving a cart behind on someone's shop is the failure this tool must never
 * hide. An abandoned Shopify cart holds no stock, but the operator should
 * still know it is there.
 */
async function confirmEmpty(run: Run): Promise<void> {
  let cart: unknown;
  try {
    const res = await read(run, `${run.origin}/cart.js`);
    cart = isOk(res.status) ? parseJson(res.body)?.value : undefined;
  } catch (err) {
    if (isOwnershipRefusal(err)) throw err;
    cart = undefined;
  }
  if (!isRecord(cart) || !Array.isArray(cart.items)) {
    run.issues.push(issue('cart-not-emptied', 'could not read the probe cart to confirm it is empty'));
    return;
  }
  if (!isEmptyCart(cart)) run.issues.push(issue('cart-not-emptied', 'the probe cart still holds items'));
}

// ── Requests ────────────────────────────────────────────────────────────

/**
 * A read made as the owner. Shopify's robots.txt disallows /cart for
 * crawlers; the operator reading the cart they just filled is not crawling.
 */
async function read(run: Run, url: string): Promise<Fetched> {
  const res = await run.ctx.fetcher.get(url, { asOwner: true, headers: headersFor(run) });
  keepCookies(run.cookies, res.headers['set-cookie'], run.ctx.now());
  return res;
}

async function write(run: Run, url: string, json?: unknown): Promise<Fetched> {
  const headers = headersFor(run);
  const res = await run.ctx.fetcher.send('POST', url, json === undefined ? { headers } : { headers, json });
  keepCookies(run.cookies, res.headers['set-cookie'], run.ctx.now());
  return res;
}

function headersFor(run: Run): Record<string, string> {
  const cookie = cookieHeader(run.cookies);
  return cookie === undefined ? { accept: 'application/json' } : { accept: 'application/json', cookie };
}

/**
 * Says why a response was turned away before it reached the shop, or
 * undefined when it was not. Shopify's bot protection answers in the cart's
 * place with a challenge, a password-protected shop redirects, and a client
 * the shop does not accept gets a 401. None of these is the shop's answer
 * about a product, and none would change on the next request.
 */
function turnedAway(res: Fetched, step: string): string | undefined {
  if (CHALLENGE_STATUSES.has(res.status) || res.headers['cf-mitigated'] !== undefined) {
    return `${step} was answered by the shop's bot protection (HTTP ${res.status}), not by the cart`;
  }
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers['location'];
    return `${step} was redirected${nonEmptyString(to) ? ` to ${to}` : ''} (HTTP ${res.status})`;
  }
  if (res.status === 401) return `${step} was refused (HTTP 401)`;
  return undefined;
}

/**
 * As turnedAway, and also a page where the cart's JSON should be: what a shop
 * with no theme storefront, and so no cart endpoints, answers. A 5xx is left
 * to the caller: it is the cart failing, for this target.
 */
function notFromTheCart(res: Fetched, step: string): string | undefined {
  const away = turnedAway(res, step);
  if (away !== undefined) return away;
  if (res.status < 500 && res.body.trim() !== '' && parseJson(res.body) === undefined) {
    return `${step} answered with a page, not the cart's JSON (HTTP ${res.status})`;
  }
  return undefined;
}

/** A response that must be a cart, as cart.js returns it. Throws when it is not. */
function cartBody(res: Fetched, step: string): Record<string, unknown> & { items: unknown[] } {
  const refused = notFromTheCart(res, step);
  if (refused !== undefined) throw new NotTheCart(refused);
  if (!isOk(res.status)) throw new Error(`${step} returned HTTP ${res.status}`);
  const cart = parseJson(res.body)?.value;
  if (!isRecord(cart) || !Array.isArray(cart.items)) throw new Error(`${step} is not a Shopify cart`);
  return cart as Record<string, unknown> & { items: unknown[] };
}

// ── Reading the cart's answers ──────────────────────────────────────────

/**
 * The cart's own refusal of a product, as its text, or undefined when the
 * response is not one. Shopify refuses an add with HTTP 422 and
 * {"status": 422, "message": "Cart Error", "description": "..."}: sold out,
 * no stock left to add, not sold in this market, or not published to the
 * online store ("Cannot find variant"). Some cart endpoints say 404 for the
 * last. The description names the product, so its words are never matched
 * against; the shape decides. A 400 is the request being wrong, not the
 * product, and so is any other shape.
 */
function cartRefusal(status: number, body: unknown): string | undefined {
  if (status !== 422 && status !== 404) return undefined;
  if (!isRecord(body) || body.message !== 'Cart Error' || !nonEmptyString(body.description)) return undefined;
  return body.description;
}

type Line = { line: Record<string, unknown>; pointer: string };

/**
 * The line for the variant in an add.js answer. The documented answer lists
 * the added lines under `items`; an older form is the bare line.
 */
function pickLine(body: unknown, variantId: string): Line | undefined {
  if (!isRecord(body)) return undefined;
  if (Array.isArray(body.items)) {
    const items: unknown[] = body.items;
    const index = items.findIndex((item) => isRecord(item) && String(item.variant_id) === variantId);
    const line = items[index];
    return isRecord(line) ? { line, pointer: `/items/${index}` } : undefined;
  }
  return String(body.variant_id) === variantId ? { line: body, pointer: '' } : undefined;
}

type Price = { value: Money; raw: string; field: string } | { problem: string };

/**
 * The unit price the cart charges, after any automatic discount on the line:
 * `final_price`, or `price` from carts that predate it.
 *
 * Shopify states cart amounts as whole hundredths of the currency's unit,
 * whatever the currency: its documentation gives 1000 yen as 100000. So the
 * divisor is always 100, never the currency's own minor unit (yen has none).
 * For a currency with three decimals the documentation does not say, so such
 * a price is left out rather than read at a guessed scale.
 */
function linePrice(line: Record<string, unknown>, currency: string | null): Price {
  const field = 'final_price' in line ? 'final_price' : 'price';
  const amount = line[field];
  const value = typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 ? fromMinor(amount, 2, currency) : null;
  if (!value) return { problem: `the line's ${field} could not be read` };
  if (currency === null) return { problem: 'the cart states no currency, so its price was left out' };
  if (minorUnitOf(currency) > 2) {
    return { problem: `the cart is in ${currency}, a currency with three decimals, and Shopify does not document how it states those amounts, so the price was left out` };
  }
  return { value, raw: String(amount), field };
}

function isEmptyCart(cart: unknown): boolean {
  if (!isRecord(cart) || !Array.isArray(cart.items) || cart.items.length > 0) return false;
  return cart.item_count === undefined || cart.item_count === 0;
}

function currencyCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

function idsOf(target: ShopifyProbeTarget): VariantIds {
  const ids: VariantIds = { variantId: target.variantId };
  if (nonEmptyString(target.productId)) ids.productId = target.productId;
  if (nonEmptyString(target.sku)) ids.sku = target.sku;
  if (nonEmptyString(target.url)) ids.url = target.url;
  return ids;
}

/** How a no-shipping-rate issue names the target: by the SKU a merchant knows it by, when there is one. */
function labelOf(target: ShopifyProbeTarget): string {
  return nonEmptyString(target.sku) ? target.sku : target.variantId;
}

function observe<T>(value: T, raw: string, locator: string, fetchedAt: string): Observation<T> {
  return { value, raw, surface: 'checkout', locator, fetchedAt };
}

function issue(code: string, message: string): CollectIssue {
  return { surface: 'checkout', code, message };
}

function ownershipIssue(): CollectIssue {
  return issue('ownership-not-verified', 'the checkout probe needs proof that you control this shop; see the ownership token in the documentation');
}
