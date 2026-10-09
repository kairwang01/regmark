// schema.org JSON-LD: each Product or ProductGroup variant becomes one sighting
// per Offer. Ambiguous or malformed values are left out rather than guessed,
// because a wrong value turns into a false alarm downstream.

import { documentOf, type PageSource } from './document.ts';
import { parseAllMoney, parseMoney } from '@regmark/core';
import type {
  Availability,
  CollectIssue,
  CollectResult,
  Money,
  Observation,
  ReturnPolicy,
  ShippingQuote,
  Sighting,
  Surface,
  VariantIds,
} from '@regmark/core';

const SURFACE: Surface = 'jsonld';

type Obj = Record<string, unknown>;
/** A JSON object together with the RFC 6901 pointer that reaches it. */
type Src = { node: Obj; ptr: string };
/** A price or amount field: the text as written, where it lives, and its own currency if it has one. */
type Field = { raw: string; ptr: string; currency?: string };
type Ctx = { pageUrl: string; fetchedAt: string; scriptIndex: number; out: Sighting[] };

// Keyed by the last path segment, lowercased, so "https://schema.org/InStock" and "InStock" agree.
const AVAILABILITY = new Map<string, Availability>([
  ['instock', 'in_stock'],
  ['limitedavailability', 'in_stock'],
  ['onlineonly', 'in_stock'],
  ['outofstock', 'out_of_stock'],
  ['soldout', 'out_of_stock'],
  ['instoreonly', 'out_of_stock'],
  ['preorder', 'preorder'],
  ['presale', 'preorder'],
  ['backorder', 'backorder'],
  ['discontinued', 'discontinued'],
]);

const GTIN_KEYS = ['gtin', 'gtin14', 'gtin13', 'gtin12', 'gtin8'];
const OPTION_KEYS = ['color', 'size', 'material', 'pattern'];
const TYPE_PREFIX = /^(?:https?:\/\/schema\.org\/|schema:)/i;
const LIST_PRICE_TYPE = /(?:ListPrice|StrikethroughPrice)$/;
const NOT_PERMITTED = /MerchantReturnNotPermitted$/;

export function extractJsonLd(html: PageSource, pageUrl: string, fetchedAt: string): CollectResult {
  const out: Sighting[] = [];
  const issues: CollectIssue[] = [];
  try {
    const $ = documentOf(html);
    const scripts = $('script').toArray().filter((el) => ($(el).attr('type') ?? '').trim().toLowerCase() === 'application/ld+json');
    scripts.forEach((el, scriptIndex) => {
      const locator = `${pageUrl}#jsonld[${scriptIndex}]`;
      let parsed: unknown;
      try {
        parsed = JSON.parse($(el).text());
      } catch (err) {
        issues.push({ surface: SURFACE, code: 'parse-error', message: `invalid JSON-LD: ${messageOf(err)}`, locator });
        return;
      }
      try {
        visit(parsed, '', { pageUrl, fetchedAt, scriptIndex, out });
      } catch (err) {
        issues.push({ surface: SURFACE, code: 'extract-failed', message: `could not read JSON-LD: ${messageOf(err)}`, locator });
      }
    });
  } catch (err) {
    issues.push({ surface: SURFACE, code: 'extract-failed', message: `could not read page: ${messageOf(err)}`, locator: pageUrl });
  }
  return { sightings: out, issues };
}

/** Read a schema.org amount from text, or null when it is not exactly one amount. */
export function readMoney(text: string, currency: string | null): Money | null {
  // More than one amount means a range or a strike-through pair; neither is one price.
  if (parseAllMoney(text, { currency }).length !== 1) return null;
  return parseMoney(text, { currency });
}

/** Map a schema.org availability IRI or bare word to the shared vocabulary. */
export function schemaAvailability(value: unknown): Availability | undefined {
  if (typeof value !== 'string') return undefined;
  const last = value.trim().split(/[/#]/).pop() ?? '';
  return AVAILABILITY.get(last.toLowerCase());
}

function visit(node: unknown, ptr: string, ctx: Ctx): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => visit(child, `${ptr}/${i}`, ctx));
    return;
  }
  if (!isObj(node)) return;
  if (hasType(node, 'ProductGroup')) {
    emitGroup({ node, ptr }, ctx);
    return;
  }
  if (hasType(node, 'Product')) {
    emitProduct({ node, ptr }, undefined, ctx);
    return;
  }
  // Products can sit under @graph, mainEntity or anything else, so search every property.
  for (const key of Object.keys(node)) visit(node[key], `${ptr}/${escapePointer(key)}`, ctx);
}

function emitGroup(group: Src, ctx: Ctx): void {
  // Only the variants are products here; the group itself has no offers of its own.
  for (const variant of asList(group.node.hasVariant, `${group.ptr}/hasVariant`)) {
    emitProduct(variant, group, ctx);
  }
}

function emitProduct(product: Src, group: Src | undefined, ctx: Ctx): void {
  const offers = asList(product.node.offers, `${product.ptr}/offers`);
  const concrete = offers.flatMap((o) => (hasType(o.node, 'AggregateOffer') ? asList(o.node.offers, `${o.ptr}/offers`) : [o]));
  // A SKU or GTIN written on the Product describes the product. With one
  // offer that is also the offer; with several it is not, and handing the
  // same identifier to each would make different variants look like one.
  const inherit = concrete.length <= 1;
  for (const offer of offers) {
    if (!hasType(offer.node, 'AggregateOffer')) {
      emitOffer(product, offer, undefined, group, ctx, inherit);
      continue;
    }
    const nested = asList(offer.node.offers, `${offer.ptr}/offers`);
    if (nested.length === 0) {
      emitAggregate(product, offer, group, ctx);
      continue;
    }
    // Nested offers inherit the aggregate's currency when they do not state one.
    const aggregateCurrency = strOnly(offer.node.priceCurrency);
    for (const inner of nested) emitOffer(product, inner, aggregateCurrency, group, ctx, inherit);
  }
}

function emitOffer(product: Src, offer: Src, fallbackCurrency: string | undefined, group: Src | undefined, ctx: Ctx, inherit: boolean): void {
  const o = offer.node;
  const ids = idsOf(o, product.node, group, ctx.pageUrl, inherit);
  const sighting: Sighting = { surface: SURFACE, scope: isVariant(ids, o, group, ctx.pageUrl) ? 'variant' : 'product', ids };
  const title = titleOf(product.node, group?.node);
  if (title) sighting.title = title;

  const offerCurrency = strOnly(o.priceCurrency);
  const fields = priceFields(o, offer.ptr);
  const currencyFor = (f: Field): string | null => offerCurrency ?? f.currency ?? fallbackCurrency ?? null;
  if (fields.price) {
    const price = moneyObs(ctx, fields.price, currencyFor(fields.price));
    if (price) sighting.price = price;
  }
  if (fields.list) {
    const list = moneyObs(ctx, fields.list, currencyFor(fields.list));
    if (list) sighting.listPrice = list;
  }

  const validUntil = o.priceValidUntil;
  if (typeof validUntil === 'string' && validUntil.trim() !== '') {
    sighting.priceValidUntil = obs(ctx, `${offer.ptr}/priceValidUntil`, validUntil, validUntil);
  }

  const availability = availabilityObs(ctx, `${offer.ptr}/availability`, o.availability);
  if (availability) sighting.availability = availability;

  const shipping = shippingOf(o, offer.ptr, ctx);
  if (shipping) sighting.shipping = shipping;

  const returnPolicy = policyOf([offer, product, group], ctx);
  if (returnPolicy) sighting.returnPolicy = returnPolicy;

  ctx.out.push(sighting);
}

/** An AggregateOffer with no nested offers: one product-level statement, priced only when unambiguous. */
function emitAggregate(product: Src, agg: Src, group: Src | undefined, ctx: Ctx): void {
  const a = agg.node;
  const ids = idsOf(a, product.node, group, ctx.pageUrl, true);
  const sighting: Sighting = { surface: SURFACE, scope: 'product', ids };
  const title = titleOf(product.node, group?.node);
  if (title) sighting.title = title;

  const currency = strOnly(a.priceCurrency) ?? null;
  const low = numText(a.lowPrice);
  const high = numText(a.highPrice);
  const count = countOf(a.offerCount);
  let field: Field | undefined;
  if (low !== undefined && high !== undefined) {
    const lowMoney = readMoney(low, currency);
    const highMoney = readMoney(high, currency);
    if (lowMoney && highMoney && lowMoney.units === highMoney.units) field = { raw: low, ptr: `${agg.ptr}/lowPrice` };
  } else if (low !== undefined && count === 1) {
    field = { raw: low, ptr: `${agg.ptr}/lowPrice` };
  }
  if (field) {
    const price = moneyObs(ctx, field, currency);
    if (price) sighting.price = price;
  }

  const availability = availabilityObs(ctx, `${agg.ptr}/availability`, a.availability);
  if (availability) sighting.availability = availability;

  ctx.out.push(sighting);
}

function idsOf(o: Obj, p: Obj, group: Src | undefined, pageUrl: string, inherit: boolean): VariantIds {
  const ids: VariantIds = {};
  const sku = text(o.sku) ?? (inherit ? text(p.sku) : undefined);
  if (sku !== undefined) ids.sku = sku;
  const mpn = text(o.mpn) ?? (inherit ? text(p.mpn) : undefined);
  if (mpn !== undefined) ids.mpn = mpn;
  const gtin = gtinOf(o) ?? (inherit ? gtinOf(p) : undefined);
  if (gtin !== undefined) ids.gtin = gtin;
  const brand = brandOf(p) ?? (group ? brandOf(group.node) : undefined);
  if (brand !== undefined) ids.brand = brand;

  const urlRaw = text(o.url) ?? text(p.url) ?? (group ? text(group.node.url) : undefined);
  const url = urlRaw === undefined ? pageUrl : absolute(urlRaw, pageUrl);
  if (url !== undefined) ids.url = url;

  // Storefronts put the variant in the offer URL: Shopify as ?variant=<id>,
  // WooCommerce as ?attribute_pa_size=m. Often it is the only thing that
  // tells two offers of one product apart.
  const hints = urlHints(strOnly(o.url), pageUrl);
  if (hints.variantId !== undefined) ids.aliases = [hints.variantId];
  const options = { ...hints.options, ...optionsOf(p) };
  if (Object.keys(options).length > 0) ids.options = options;
  const groupId = group ? strOnly(group.node.productGroupID) : undefined;
  if (groupId !== undefined) ids.groupId = groupId;
  return ids;
}

function urlHints(rawUrl: string | undefined, base: string): { variantId?: string; options: Record<string, string> } {
  const options: Record<string, string> = {};
  if (rawUrl === undefined) return { options };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, base);
  } catch {
    return { options };
  }
  for (const [key, value] of parsed.searchParams) {
    if (key.startsWith('attribute_') && value !== '') options[key] = value;
  }
  const variant = parsed.searchParams.get('variant');
  return variant !== null && /^\d+$/.test(variant) ? { variantId: variant, options } : { options };
}

function isVariant(ids: VariantIds, o: Obj, group: Src | undefined, pageUrl: string): boolean {
  if (ids.sku !== undefined || ids.gtin !== undefined || ids.mpn !== undefined) return true;
  if (group !== undefined) return true;
  return hasQuery(strOnly(o.url), pageUrl);
}

function titleOf(p: Obj, g: Obj | undefined): string | undefined {
  return strOnly(p.name) ?? (g ? strOnly(g.name) : undefined);
}

function brandOf(p: Obj): string | undefined {
  const brand = p.brand;
  if (typeof brand === 'string') return strOnly(brand);
  if (isObj(brand)) return strOnly(brand.name);
  return undefined;
}

function gtinOf(o: Obj): string | undefined {
  for (const key of GTIN_KEYS) {
    const value = text(o[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function optionsOf(p: Obj): Record<string, string> {
  const options: Record<string, string> = {};
  for (const key of OPTION_KEYS) {
    const value = strOnly(p[key]);
    if (value !== undefined) options[key] = value;
  }
  return options;
}

type PriceFields = { price?: Field; list?: Field };

function priceFields(o: Obj, ptr: string): PriceFields {
  const direct = numText(o.price);
  if (direct !== undefined) return { price: { raw: direct, ptr: `${ptr}/price` } };

  const out: PriceFields = {};
  for (const spec of asList(o.priceSpecification, `${ptr}/priceSpecification`)) {
    const raw = numText(spec.node.price);
    if (raw === undefined) continue;
    const field: Field = { raw, ptr: `${spec.ptr}/price` };
    const currency = strOnly(spec.node.priceCurrency);
    if (currency !== undefined) field.currency = currency;
    const priceType = strOnly(spec.node.priceType) ?? '';
    // The first specification of each kind wins; later ones are not the buyer's price.
    if (LIST_PRICE_TYPE.test(priceType)) out.list ??= field;
    else out.price ??= field;
  }
  return out;
}

function moneyObs(ctx: Ctx, field: Field, currency: string | null): Observation<Money> | undefined {
  const money = readMoney(field.raw, currency);
  return money ? obs(ctx, field.ptr, money, field.raw) : undefined;
}

function availabilityObs(ctx: Ctx, ptr: string, value: unknown): Observation<Availability> | undefined {
  const availability = schemaAvailability(value);
  return availability !== undefined && typeof value === 'string' ? obs(ctx, ptr, availability, value) : undefined;
}

function shippingOf(o: Obj, ptr: string, ctx: Ctx): Observation<ShippingQuote> | undefined {
  for (const details of asList(o.shippingDetails, `${ptr}/shippingDetails`)) {
    const rate = details.node.shippingRate;
    if (!isObj(rate)) continue;
    // Only the first rate counts; if it cannot be read, a later one is not the same quote.
    const currency = strOnly(rate.currency) ?? null;
    const amount = rateAmount(rate, `${details.ptr}/shippingRate`, currency);
    if (!amount) return undefined;
    const cost = readMoney(amount.raw, currency);
    if (!cost) return undefined;
    const quote: ShippingQuote = { free: cost.units === 0, cost };
    const country = countryOf(details.node.shippingDestination);
    if (country !== undefined) quote.country = country;
    return obs(ctx, amount.ptr, quote, amount.raw);
  }
  return undefined;
}

function rateAmount(rate: Obj, ptr: string, currency: string | null): Field | undefined {
  const value = numText(rate.value);
  if (value !== undefined) return { raw: value, ptr: `${ptr}/value` };
  const max = numText(rate.maxValue);
  if (max === undefined) return undefined;
  // A min/max pair that disagrees is a range, not a cost.
  const min = numText(rate.minValue);
  if (min !== undefined) {
    const lo = readMoney(min, currency);
    const hi = readMoney(max, currency);
    if (!lo || !hi || lo.units !== hi.units) return undefined;
  }
  return { raw: max, ptr: `${ptr}/maxValue` };
}

function countryOf(destination: unknown): string | undefined {
  const dest = Array.isArray(destination) ? destination.find(isObj) : destination;
  if (!isObj(dest)) return undefined;
  const country = strOnly(dest.addressCountry) ?? (isObj(dest.addressCountry) ? strOnly(dest.addressCountry.name) : undefined);
  if (country === undefined) return undefined;
  return /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : country;
}

/** The first return policy in the list wins; callers order them offer, product, group. */
function policyOf(sources: (Src | undefined)[], ctx: Ctx): Observation<ReturnPolicy> | undefined {
  for (const source of sources) {
    if (!source) continue;
    const policy = source.node.hasMerchantReturnPolicy;
    if (!isObj(policy)) continue;
    const value: ReturnPolicy = { present: true };
    const days = policy.merchantReturnDays;
    if (typeof days === 'number' && Number.isFinite(days)) value.days = days;
    const link = strOnly(policy.merchantReturnLink);
    if (link !== undefined) value.url = link;
    const category = strOnly(policy.returnPolicyCategory);
    if (category !== undefined && NOT_PERMITTED.test(category)) value.days = 0;
    // The policy is an object, so its source text is the object as serialised.
    return obs(ctx, `${source.ptr}/hasMerchantReturnPolicy`, value, JSON.stringify(policy));
  }
  return undefined;
}

function obs<T>(ctx: Ctx, ptr: string, value: T, raw: string): Observation<T> {
  return {
    value,
    raw,
    surface: SURFACE,
    locator: `${ctx.pageUrl}#jsonld[${ctx.scriptIndex}]${ptr}`,
    fetchedAt: ctx.fetchedAt,
  };
}

function asList(value: unknown, ptr: string): Src[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => (isObj(item) ? [{ node: item, ptr: `${ptr}/${i}` }] : []));
  }
  return isObj(value) ? [{ node: value, ptr }] : [];
}

function hasType(node: Obj, name: string): boolean {
  const declared = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  return declared.some((t) => typeof t === 'string' && t.trim().replace(TYPE_PREFIX, '') === name);
}

function hasQuery(rawUrl: string | undefined, base: string): boolean {
  if (rawUrl === undefined) return false;
  try {
    return new URL(rawUrl, base).search.length > 1;
  } catch {
    return false;
  }
}

function absolute(raw: string, base: string): string | undefined {
  try {
    return new URL(raw, base).href;
  } catch {
    return undefined;
  }
}

function escapePointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string or finite number, trimmed. For identifiers and names. */
function text(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  return strOnly(value);
}

/** A non-empty string, trimmed. */
function strOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A price-like value exactly as written: a non-empty string, or a number stringified. */
function numText(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  return undefined;
}

function countOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
