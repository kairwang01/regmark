// One Product of the protocol's own feed model, with its Variants nested
// inside, read as one sighting per variant.
//
// This is the shape of the ACP Feed API and of products.jsonl. Prices are
// integers in the currency's minor units, {"amount": 1999, "currency": "USD"};
// `price` is the active price and `list_price` the one before any discount.
// The model has no shipping cost and no return window: a seller's
// refund_policy link is the only return policy it can state.

import { type Availability, type CollectIssue, fromMinor, isBuyable, minorUnitOf, type Money, type Observation, type Sighting, type VariantIds } from '@regmark/core';
import { httpUrl, type MapContext, resolveUrl } from '../map.ts';
import { isObject, placeLocator, placeText, type ProductRecord } from './read.ts';

const SURFACE = 'acp' as const;

/**
 * The status values the protocol names. It calls the list extensible, so a
 * status not here is read through `available` when that is given, and
 * reported only when it is not.
 */
const STATUS: ReadonlyMap<string, Availability> = new Map([
  ['in_stock', 'in_stock'],
  // Few left is still in stock.
  ['limited_stock', 'in_stock'],
  ['backorder', 'backorder'],
  ['preorder', 'preorder'],
  ['out_of_stock', 'out_of_stock'],
  ['discontinued', 'discontinued'],
]);

/** Barcode types that are GTINs: the spec names GTIN, UPC and EAN, and UPC-A and EAN-13 are GTIN-12 and GTIN-13. */
const GTIN_TYPE = /^(gtin|upc|ean)/i;

/** An identifier as text. The schema says string; a whole number written as JSON is the same id. */
function idText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  return undefined;
}

const textOf = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() || undefined : undefined);

type VariantRead = {
  ctx: MapContext;
  issues: CollectIssue[];
  /** `<feed URL>#product[id="..."]/variant[id="..."]` */
  at: string;
};

function unreadable(v: VariantRead, field: string, message: string): void {
  v.issues.push({ surface: SURFACE, code: 'feed-field-unreadable', message, locator: `${v.at}/${field}` });
}

function observe<T>(v: VariantRead, value: T, raw: string, field: string): Observation<T> {
  return { value, raw, surface: SURFACE, locator: `${v.at}/${field}`, fetchedAt: v.ctx.fetchedAt };
}

/** {"amount": 1999, "currency": "USD"}: a whole number of minor units and the code that says how many make one. */
function readPrice(v: VariantRead, value: unknown, field: string): Observation<Money> | undefined {
  if (value === undefined || value === null) return undefined;
  const currency = isObject(value) && typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : '';
  const amount = isObject(value) ? value.amount : undefined;
  const money =
    /^[A-Z]{3}$/.test(currency) && typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0
      ? fromMinor(amount, minorUnitOf(currency), currency)
      : null;
  if (!money) {
    // Without its currency an amount in minor units cannot even be scaled.
    unreadable(v, field, `${field} ${JSON.stringify(value)} is not {"amount": <minor units>, "currency": "<ISO 4217 code>"}`);
    return undefined;
  }
  return observe(v, money, JSON.stringify(value), field);
}

/**
 * `available` says whether the variant can be bought now; `status` gives the
 * fulfilment state. A status alone is read through STATUS, `available` alone
 * as in or out of stock. When both are given and disagree about whether it
 * can be bought, the feed contradicts itself and neither is taken.
 */
function readAvailability(v: VariantRead, value: unknown): Observation<Availability> | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = JSON.stringify(value);
  const given = isObject(value) && value.available !== undefined && value.available !== null;
  if (!isObject(value) || (given && typeof value.available !== 'boolean')) {
    unreadable(v, 'availability', `availability ${raw} is not {"available": true or false, "status": "<state>"}`);
    return undefined;
  }
  const available = given ? (value.available as boolean) : undefined;
  const status = textOf(value.status);
  const fromStatus = status ? STATUS.get(status.toLowerCase()) : undefined;
  if (fromStatus) {
    if (available !== undefined && isBuyable(fromStatus) !== available) {
      unreadable(v, 'availability', `availability ${raw} contradicts itself: status "${status}" with available ${available}`);
      return undefined;
    }
    return observe(v, fromStatus, raw, 'availability');
  }
  if (available !== undefined) return observe<Availability>(v, available ? 'in_stock' : 'out_of_stock', raw, 'availability');
  if (status) unreadable(v, 'availability', `availability status "${status}" is not one the protocol names, and available is not given`);
  return undefined;
}

/** The first barcode of a GTIN type. Its value is passed on as written; identity.gtin-invalid checks it. */
function readGtin(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const b of value) {
    if (!isObject(b) || typeof b.type !== 'string' || !GTIN_TYPE.test(b.type.trim())) continue;
    const digits = textOf(b.value);
    if (digits) return digits;
  }
  return undefined;
}

function readOptions(v: VariantRead, value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    unreadable(v, 'variant_options', `variant_options ${JSON.stringify(value)} is not a list`);
    return undefined;
  }
  const out: Record<string, string> = {};
  value.forEach((option, i) => {
    const name = isObject(option) ? textOf(option.name) : undefined;
    const chosen = isObject(option) ? textOf(option.value) : undefined;
    if (name && chosen) out[name] = chosen;
    else unreadable(v, `variant_options[${i + 1}]`, `variant option ${JSON.stringify(option)} is not {"name": ..., "value": ...}`);
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A seller's refund_policy link: a return policy stated in a form a machine can follow. */
function readRefundPolicy(v: VariantRead, seller: unknown): Sighting['returnPolicy'] {
  if (!isObject(seller) || !Array.isArray(seller.links)) return undefined;
  for (const [i, link] of seller.links.entries()) {
    if (!isObject(link) || textOf(link.type) !== 'refund_policy') continue;
    const url = textOf(link.url);
    const href = url ? httpUrl(url) : undefined;
    if (href) return observe(v, { present: true, url: href }, JSON.stringify(link), `seller/links[${i + 1}]`);
    unreadable(v, `seller/links[${i + 1}]`, `refund_policy link ${JSON.stringify(link)} has no http or https URL`);
  }
  return undefined;
}

/**
 * Maps one Product to a sighting per Variant. A product without an id, and a
 * variant without an id or a page URL (its own or its product's), cannot be
 * matched to anything and give no sighting; other problems are reported and
 * the field is left out.
 */
export function mapProduct(record: ProductRecord, ctx: MapContext): { sightings: Sighting[]; issues: CollectIssue[] } {
  const p = record.product;
  const issues: CollectIssue[] = [];
  const productId = idText(p.id);
  if (!productId) {
    issues.push({ surface: SURFACE, code: 'feed-item-incomplete', message: `${placeText(record.place)} has no id`, locator: placeLocator(ctx.feedUrl, record.place) });
    return { sightings: [], issues };
  }
  const productAt = `${ctx.feedUrl}#product[id="${productId}"]`;
  if (!Array.isArray(p.variants)) {
    issues.push({ surface: SURFACE, code: 'feed-item-incomplete', message: `product "${productId}" has no variants`, locator: productAt });
    return { sightings: [], issues };
  }
  const productUrl = textOf(p.url);

  const sightings: Sighting[] = [];
  p.variants.forEach((variant: unknown, i) => {
    const variantId = isObject(variant) ? idText(variant.id) : undefined;
    if (!isObject(variant) || !variantId) {
      issues.push({ surface: SURFACE, code: 'feed-item-incomplete', message: `product "${productId}" variant ${i + 1} has no id`, locator: `${productAt}/variant[${i + 1}]` });
      return;
    }
    const v: VariantRead = { ctx, issues, at: `${productAt}/variant[id="${variantId}"]` };
    const link = textOf(variant.url) ?? productUrl;
    if (!link) {
      issues.push({ surface: SURFACE, code: 'feed-item-incomplete', message: `variant "${variantId}" has no url, and neither has its product`, locator: v.at });
      return;
    }
    const title = textOf(variant.title);
    if (!title) issues.push({ surface: SURFACE, code: 'feed-item-incomplete', message: `variant "${variantId}" has no title, which the model requires`, locator: v.at });

    // The product id groups its variants; the variant id is what checkout is
    // asked for, and may equal a SKU or a backend id elsewhere.
    const ids: VariantIds = { aliases: [variantId], groupId: productId };
    const url = resolveUrl(link, ctx.feedUrl);
    if (url) ids.url = url;
    const gtin = readGtin(variant.barcodes);
    if (gtin) ids.gtin = gtin;
    const options = readOptions(v, variant.variant_options);
    if (options) ids.options = options;

    const sighting: Sighting = { surface: SURFACE, scope: 'variant', ids };
    const named = title ?? textOf(p.title);
    if (named) sighting.title = named;
    const price = readPrice(v, variant.price, 'price');
    if (price) sighting.price = price;
    const listPrice = readPrice(v, variant.list_price, 'list_price');
    if (listPrice) sighting.listPrice = listPrice;
    const availability = readAvailability(v, variant.availability);
    if (availability) sighting.availability = availability;
    const returnPolicy = readRefundPolicy(v, variant.seller);
    if (returnPolicy) sighting.returnPolicy = returnPolicy;
    sightings.push(sighting);
  });
  return { sightings, issues };
}
