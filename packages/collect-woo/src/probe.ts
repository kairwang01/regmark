// The checkout probe: one cart for the whole run, one unit per target, the
// shop's own totals read back, and the cart emptied after every target. It
// changes state on the shop, so every problem is reported, never swallowed.

import type { CollectContext, CollectIssue, Fetched, ShippingQuote, Sighting, VariantIds } from '@regmark/core';
import {
  apiBase,
  errorText,
  isOk,
  isOwnershipRefusal,
  isRecord,
  makeIssue,
  nonEmptyString,
  observe,
  parseJson,
  readMinor,
} from './http.ts';

export type ProbeTarget = { variantId: string; productId?: string; sku?: string; url?: string };
export type ProbeOptions = { shipTo: { country: string; postcode?: string; state?: string; city?: string } };

type Run = {
  ctx: CollectContext;
  base: string;
  shipTo: ProbeOptions['shipTo'];
  /** cart-token, and nonce when the shop gave one. Sent on every request after the first. */
  headers: Record<string, string>;
  sightings: Sighting[];
  issues: CollectIssue[];
};

// Statuses under which WooCommerce refuses a product with a machine-readable code.
const REFUSAL_STATUSES = new Set([400, 403, 404, 409]);

export async function probeWooCheckout(
  ctx: CollectContext,
  targets: readonly ProbeTarget[],
  options: ProbeOptions,
): Promise<{ sightings: Sighting[]; issues: CollectIssue[] }> {
  if (targets.length === 0) return { sightings: [], issues: [] };
  const run: Run = { ctx, base: apiBase(ctx), shipTo: options.shipTo, headers: {}, sightings: [], issues: [] };
  try {
    await runProbe(run, targets);
  } catch (err) {
    // The ownership refusal is the one thing that discards what was gathered: the run is not allowed to go on.
    if (isOwnershipRefusal(err)) return { sightings: [], issues: [ownershipIssue()] };
    run.issues.push(makeIssue('checkout', 'probe-failed', errorText(err)));
  }
  return { sightings: run.sightings, issues: run.issues };
}

async function runProbe(run: Run, targets: readonly ProbeTarget[]): Promise<void> {
  const opened = await openCart(run);
  if (!opened) return;

  const token = opened.headers['cart-token'];
  if (!nonEmptyString(token)) {
    // Without a token the writes could not reach a cart of ours, so none are attempted.
    run.issues.push(makeIssue('checkout', 'probe-failed', 'the shop did not return a cart token'));
    return;
  }
  run.headers = { 'cart-token': token };
  const nonce = opened.headers['nonce'];
  if (nonEmptyString(nonce)) run.headers.nonce = nonce;

  for (const target of targets) {
    try {
      await probeTarget(run, target);
    } catch (err) {
      if (isOwnershipRefusal(err)) throw err;
      run.issues.push(makeIssue('checkout', 'probe-failed', `${target.variantId}: ${errorText(err)}`));
    }
    // A failed cleanup must stop the sample: another target would inherit
    // these items and its totals and shipping threshold would be wrong.
    if (!(await emptyCart(run, target.variantId))) break;
  }

  await confirmEmpty(run);
}

async function openCart(run: Run): Promise<Fetched | undefined> {
  try {
    const res = await run.ctx.fetcher.get(`${run.base}/cart`);
    if (isOk(res.status)) return res;
    run.issues.push(makeIssue('checkout', 'probe-failed', `could not open a cart: HTTP ${res.status}`));
  } catch (err) {
    run.issues.push(makeIssue('checkout', 'probe-failed', `could not open a cart: ${errorText(err)}`));
  }
  return undefined;
}

async function probeTarget(run: Run, target: ProbeTarget): Promise<void> {
  if (!/^\d+$/.test(target.variantId)) throw new Error(`not a variant id: ${target.variantId}`);

  const addUrl = `${run.base}/cart/add-item`;
  const added = await run.ctx.fetcher.send('POST', addUrl, {
    headers: run.headers,
    json: { id: Number(target.variantId), quantity: 1 },
  });
  const addBody = parseJson(added.body)?.value;

  if (added.status === 200 || added.status === 201) {
    await addedToCart(run, target, added, addBody);
    return;
  }

  const code = refusalCode(added.status, addBody);
  if (code !== undefined) {
    run.sightings.push({
      surface: 'checkout',
      scope: 'variant',
      ids: idsOf(target),
      purchasable: observe(false, code, 'checkout', addUrl, added.fetchedAt),
    });
    return;
  }
  run.issues.push(makeIssue('checkout', 'probe-failed', `${target.variantId}: add-item returned HTTP ${added.status}`, addUrl));
}

async function addedToCart(run: Run, target: ProbeTarget, added: Fetched, addBody: unknown): Promise<void> {
  const addUrl = `${run.base}/cart/add-item`;
  const fromAdd = pickItem(addBody, target.variantId);
  if (!fromAdd) throw new Error('add-item response does not contain the requested variant');
  const sighting: Sighting = {
    surface: 'checkout',
    scope: 'variant',
    ids: idsOf(target),
    purchasable: observe(true, 'added', 'checkout', addUrl, added.fetchedAt),
  };

  // The price from add-item is the fallback: it is still a real reading if update-customer fails.
  const addPrice = readMinor(fromAdd.item.prices, 'price');
  if (addPrice) {
    sighting.price = observe(addPrice.value, addPrice.raw, 'checkout', `${addUrl}#/items/${fromAdd.index}/prices/price`, added.fetchedAt);
  }

  try {
    await updateCustomer(run, target, sighting);
  } catch (err) {
    if (isOwnershipRefusal(err)) throw err;
    run.issues.push(makeIssue('checkout', 'probe-failed', `${target.variantId}: update-customer failed: ${errorText(err)}`));
  }
  run.sightings.push(sighting);
}

async function updateCustomer(run: Run, target: ProbeTarget, sighting: Sighting): Promise<void> {
  const url = `${run.base}/cart/update-customer`;
  const res = await run.ctx.fetcher.send('POST', url, {
    headers: run.headers,
    json: { shipping_address: run.shipTo, billing_address: run.shipTo },
  });
  if (!isOk(res.status)) throw new Error(`HTTP ${res.status}`);
  const cart = parseJson(res.body)?.value;
  if (!isRecord(cart)) throw new Error('unreadable cart');

  const picked = pickItem(cart, target.variantId);
  if (!picked) throw new Error('cart response does not contain the requested variant');
  const price = readMinor(picked.item.prices, 'price');
  if (price) {
    sighting.price = observe(price.value, price.raw, 'checkout', `${url}#/items/${picked.index}/prices/price`, res.fetchedAt);
  }

  const country = run.shipTo.country.toUpperCase();
  const packages: unknown[] = Array.isArray(cart.shipping_rates) ? cart.shipping_rates : [];
  const hasRate = packages.some((pkg) => isRecord(pkg) && Array.isArray(pkg.shipping_rates) && pkg.shipping_rates.length > 0);
  if (hasRate) {
    const cost = readMinor(cart.totals, 'total_shipping');
    if (cost) {
      const quote: ShippingQuote = { free: cost.value.units === 0, cost: cost.value, country };
      sighting.shipping = observe(quote, cost.raw, 'checkout', `${url}#/totals/total_shipping`, res.fetchedAt);
    } else {
      run.issues.push(makeIssue('checkout', 'probe-failed', `${target.variantId}: shipping total could not be read`));
    }
  } else {
    const label = nonEmptyString(target.sku) ? target.sku : target.variantId;
    run.issues.push(makeIssue('checkout', 'no-shipping-rate', `no shipping rate for ${country} on ${label}`));
  }

  const landed = readMinor(cart.totals, 'total_price');
  if (landed) {
    sighting.landedTotal = observe(landed.value, landed.raw, 'checkout', `${url}#/totals/total_price`, res.fetchedAt);
  }
}

async function emptyCart(run: Run, variantId: string): Promise<boolean> {
  let reason: string;
  try {
    const res = await run.ctx.fetcher.send('DELETE', `${run.base}/cart/items`, { headers: run.headers });
    if (isOk(res.status)) return true;
    reason = `HTTP ${res.status}`;
  } catch (err) {
    if (isOwnershipRefusal(err)) throw err;
    reason = errorText(err);
  }
  run.issues.push(
    makeIssue('checkout', 'cart-not-emptied', `could not empty the probe cart after ${variantId} (${reason}); remove its items from the shop admin`),
  );
  return false;
}

/** Leaving a cart behind on someone's shop is the failure this tool must never hide. */
async function confirmEmpty(run: Run): Promise<void> {
  let cart: unknown;
  try {
    const res = await run.ctx.fetcher.get(`${run.base}/cart`, { headers: run.headers });
    cart = isOk(res.status) ? parseJson(res.body)?.value : undefined;
  } catch {
    cart = undefined;
  }
  if (!isRecord(cart)) {
    run.issues.push(makeIssue('checkout', 'cart-not-emptied', 'could not read the probe cart to confirm it is empty; check the shop admin'));
    return;
  }
  const items: unknown[] | undefined = Array.isArray(cart.items) ? cart.items : undefined;
  const empty = cart.items_count === 0 || (items !== undefined && items.length === 0);
  if (!empty) {
    run.issues.push(makeIssue('checkout', 'cart-not-emptied', 'the probe cart still holds items; remove them from the shop admin'));
  }
}

function pickItem(cart: unknown, variantId: string): { item: Record<string, unknown>; index: number } | undefined {
  if (!isRecord(cart) || !Array.isArray(cart.items)) return undefined;
  const items: unknown[] = cart.items;
  const index = items.findIndex((item) => isRecord(item) && String(item.id) === variantId);
  const item = items[index];
  return isRecord(item) ? { item, index } : undefined;
}

// A refusal that is about the request, not about the product. Counting one of
// these as "cannot be bought" would report every variant in the shop.
const NOT_ABOUT_THE_PRODUCT = /nonce|cookie|auth|permission|forbidden|rate_limit|too_many|invalid_json|missing_param/i;

function refusalCode(status: number, body: unknown): string | undefined {
  if (!REFUSAL_STATUSES.has(status)) return undefined;
  if (!isRecord(body) || typeof body.code !== 'string') return undefined;
  return NOT_ABOUT_THE_PRODUCT.test(body.code) ? undefined : body.code;
}

function idsOf(target: ProbeTarget): VariantIds {
  const ids: VariantIds = { variantId: target.variantId };
  if (nonEmptyString(target.productId)) ids.productId = target.productId;
  if (nonEmptyString(target.sku)) ids.sku = target.sku;
  if (nonEmptyString(target.url)) ids.url = target.url;
  return ids;
}

function ownershipIssue(): CollectIssue {
  return {
    surface: 'checkout',
    code: 'ownership-not-verified',
    message: 'the checkout probe needs proof that you control this shop; see the ownership token in the documentation',
  };
}
