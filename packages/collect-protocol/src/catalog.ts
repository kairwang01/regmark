// Reading a UCP catalogue for the sampled products: which ids to ask for, and
// how each variant in the answer becomes a sighting.
//
// The UCP collector and the MCP collector both end here. A UCP business and
// Shopify's storefront MCP server answer with the same catalogue objects
// (UCP 2026-08-25, also 2026-04-08 for what is read here); only the way the
// question travels differs, and transports.ts hides that behind `Ask`.
//
// Two things in the protocol could make a variant look missing when it is
// not, and the reading below is careful about both:
//   - a lookup by product id or handle answers with one "featured" variant,
//     not the product's variants, so such a match becomes a product-level
//     statement;
//   - a search may return only part of a product's variants, so it is used
//     only when no storefront API gave exact variant ids.

import { fromMinor, isBuyable, minorUnitOf, urlKey } from '@regmark/core';
import type { Availability, CollectIssue, CollectResult, Money, Observation, Sighting, Surface, VariantIds } from '@regmark/core';
import type { ProductRef } from './refs.ts';
import { clip, isRecord, nonEmptyString } from './util.ts';

/** The two read-only catalogue operations, named as UCP names its MCP tools. */
export type Operation = 'lookup_catalog' | 'search_catalog';

/**
 * What one catalogue request came back with: the UCP payload, the URL that
 * was asked, and the JSON pointer to the payload inside the response.
 */
export type Answer =
  | { ok: true; payload: Record<string, unknown>; url: string; pointer: string; fetchedAt: string }
  | { ok: false; issue: CollectIssue };

/** Asks the catalogue one question. transports.ts has one for REST and one for MCP. */
export type Ask = (operation: Operation, request: Record<string, unknown>) => Promise<Answer>;

export type CatalogueOptions = {
  surface: Surface;
  refs: readonly ProductRef[];
  platform?: 'woocommerce' | 'shopify';
  /** The server offers lookup_catalog. */
  lookup: boolean;
  /** The server offers search_catalog. */
  search: boolean;
  /**
   * Ask for unavailable variants too, with filters.available=false. Shopify's
   * catalogue extension leaves sold-out variants out of an answer unless
   * asked, which would make every one of them look missing. Sent only to a
   * server that declares the filter.
   */
  includeUnavailable: boolean;
};

/** UCP asks a business to accept at least 10 ids in one lookup, and Shopify accepts at most 10. */
export const LOOKUP_BATCH = 10;

/**
 * The most lookup requests one product may cost. A product with more variant
 * ids than fit is not looked up at all: reading part of it would make the
 * rest look like variants the catalogue does not have.
 */
export const MAX_LOOKUPS_PER_PRODUCT = 5;

/** How many results a title search asks for. */
export const SEARCH_LIMIT = 10;

const SHOPIFY_VARIANT = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/;

/**
 * The ids to look a product up by, in the form the catalogue names them.
 * Exact variant ids when a storefront API gave them; otherwise the SKUs,
 * which UCP lets a business accept; otherwise the handle.
 */
export function lookupIds(ref: ProductRef, platform?: CatalogueOptions['platform']): string[] {
  if (ref.variantIds?.length) {
    return ref.variantIds.map((id) => (platform === 'shopify' && /^\d+$/.test(id) ? `gid://shopify/ProductVariant/${id}` : id));
  }
  if (ref.skus?.length) return [...ref.skus];
  return ref.handle ? [ref.handle] : [];
}

/**
 * The storefront API's number for a catalogue variant id, when the id is
 * one: a bare number, or Shopify's gid://shopify/ProductVariant/<number>.
 * It goes into `aliases`, where the graph matches it with the backend id.
 */
export function backendId(id: string): string | undefined {
  const trimmed = id.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return SHOPIFY_VARIANT.exec(trimmed)?.[1];
}

export async function readCatalogue(ask: Ask, options: CatalogueOptions): Promise<CollectResult> {
  const { surface, refs } = options;
  // Each sighting with the index of the product it belongs to.
  const read: { index: number; sighting: Sighting }[] = [];
  const issues: CollectIssue[] = [];

  // Which product asked for each id. Lookups are batched across products, and
  // each variant in an answer names the ids that found it.
  const owner = new Map<string, number>();
  const skipped = new Set<number>();
  refs.forEach((ref, index) => {
    const ids = lookupIds(ref, options.platform);
    if (ids.length > LOOKUP_BATCH * MAX_LOOKUPS_PER_PRODUCT) {
      skipped.add(index);
      issues.push(issueOf(surface, 'too-many-variants', `not looked up: ${ids.length} variants is more than ${LOOKUP_BATCH * MAX_LOOKUPS_PER_PRODUCT}`, ref.url));
      return;
    }
    for (const id of ids) if (!owner.has(id)) owner.set(id, index);
  });

  const found = new Set<number>();
  const emitted = new Set<string>();
  const all = [...owner.keys()];
  // Ids before this position were answered. A failed batch leaves the rest unasked.
  let answered = all.length;
  let failed = false;

  if (options.lookup) {
    for (let start = 0; start < all.length; start += LOOKUP_BATCH) {
      const asked = all.slice(start, start + LOOKUP_BATCH);
      const answer = checked(await ask('lookup_catalog', withFilter({ ids: asked }, options)), surface, 'lookup_catalog');
      if (!answer.ok) {
        issues.push(answer.issue);
        // The rest would most likely fail the same way, once per batch.
        answered = start;
        failed = true;
        break;
      }
      const askedSet = new Set(asked);
      eachVariant(answer.payload, (product, variant, p, v) => {
        // Group the ids that found this variant by the product that asked.
        const byRef = new Map<number, { id: string; exact: boolean }[]>();
        for (const input of inputsOf(variant, askedSet)) {
          const index = owner.get(input.id)!;
          if (!byRef.has(index)) byRef.set(index, []);
          byRef.get(index)!.push(input);
        }
        for (const [index, inputs] of byRef) {
          const key = `${index}|${typeof variant.id === 'string' ? variant.id : `${start}/${p}/${v}`}`;
          if (emitted.has(key)) continue;
          emitted.add(key);
          // Only an exact match speaks for this variant. A featured one is the
          // server's pick to stand for the product, so it describes the product.
          const scope = inputs.some((input) => input.exact) ? 'variant' : 'product';
          const label = `lookup_catalog[id=${JSON.stringify(inputs[0]!.id)}]`;
          const at = `${answer.url}#${label}${answer.pointer}/products/${p}/variants/${v}`;
          const one = toSighting(surface, refs[index]!, product, variant, at, answer.fetchedAt, scope);
          read.push({ index, sighting: one.sighting });
          issues.push(...one.issues);
          found.add(index);
        }
      });
    }
  }

  // A product with an id in a batch that was never answered was read in part
  // at best, and its unread variants would look missing. It keeps nothing.
  const unanswered = new Set(all.slice(answered).map((id) => owner.get(id)!));

  if (options.search && !failed) {
    for (const [index, ref] of refs.entries()) {
      // A search may return part of a product's variants. With exact ids from
      // a storefront API that would read as missing variants, so it is only
      // for products the audit knows from the outside.
      if (found.has(index) || skipped.has(index) || ref.variantIds?.length || !nonEmptyString(ref.title)) continue;
      const answer = checked(await ask('search_catalog', withFilter({ query: ref.title, pagination: { limit: SEARCH_LIMIT } }, options)), surface, 'search_catalog');
      if (!answer.ok) {
        issues.push(answer.issue);
        failed = true;
        break;
      }
      const products = answer.payload.products as unknown[];
      const p = products.findIndex((product) => isRecord(product) && sameProduct(ref, product));
      if (p < 0) continue;
      const product = products[p] as Record<string, unknown>;
      const label = `search_catalog[query=${JSON.stringify(ref.title)}]`;
      const variants = Array.isArray(product.variants) ? product.variants : [];
      variants.forEach((variant, v) => {
        if (!isRecord(variant)) return;
        const at = `${answer.url}#${label}${answer.pointer}/products/${p}/variants/${v}`;
        const one = toSighting(surface, ref, product, variant, at, answer.fetchedAt, 'variant');
        read.push({ index, sighting: one.sighting });
        issues.push(...one.issues);
        found.add(index);
      });
    }
  }

  if (!failed) {
    for (const [index, ref] of refs.entries()) {
      if (found.has(index) || skipped.has(index)) continue;
      issues.push(issueOf(surface, 'not-found', 'the catalogue has no product for this page', ref.url));
    }
  }
  return { sightings: read.filter((r) => !unanswered.has(r.index)).map((r) => r.sighting), issues };
}

const withFilter = (request: Record<string, unknown>, options: CatalogueOptions): Record<string, unknown> =>
  options.includeUnavailable ? { ...request, filters: { available: false } } : request;

/**
 * An answer whose payload says it failed is a failure. UCP reports a business
 * outcome inside a successful response, as `ucp.status: "error"` with messages.
 */
function checked(answer: Answer, surface: Surface, operation: Operation): Answer & { ok: true } | { ok: false; issue: CollectIssue } {
  if (!answer.ok) return answer;
  const ucp = answer.payload.ucp;
  if (isRecord(ucp) && ucp.status === 'error') {
    const messages = Array.isArray(answer.payload.messages) ? answer.payload.messages.filter(isRecord) : [];
    const first = messages.find((m) => m.type === 'error') ?? messages[0];
    const code = first && typeof first.code === 'string' ? first.code : undefined;
    const content = first && typeof first.content === 'string' ? first.content : undefined;
    const issueCode = code === 'version_unsupported' ? 'version-unsupported' : code === 'capabilities_incompatible' ? 'not-supported' : 'fetch-failed';
    const why = [code, content === undefined ? undefined : clip(content)].filter((s): s is string => !!s).join(': ');
    return { ok: false, issue: issueOf(surface, issueCode, `${operation}: the catalogue answered with an error${why ? ` (${clip(why)})` : ''}`, answer.url) };
  }
  if (!Array.isArray(answer.payload.products)) {
    return { ok: false, issue: issueOf(surface, 'parse-error', `${operation}: the answer has no products list`, answer.url) };
  }
  return answer;
}

function eachVariant(payload: Record<string, unknown>, visit: (product: Record<string, unknown>, variant: Record<string, unknown>, p: number, v: number) => void): void {
  (payload.products as unknown[]).forEach((product, p) => {
    if (!isRecord(product) || !Array.isArray(product.variants)) return;
    product.variants.forEach((variant, v) => {
      if (isRecord(variant)) visit(product, variant, p, v);
    });
  });
}

/**
 * The asked-for ids that found this variant, from its `inputs`. A server that
 * leaves `inputs` out still names the variant by its id, so a variant whose id
 * was asked for is an exact match.
 */
function inputsOf(variant: Record<string, unknown>, asked: ReadonlySet<string>): { id: string; exact: boolean }[] {
  const out: { id: string; exact: boolean }[] = [];
  const inputs = Array.isArray(variant.inputs) ? variant.inputs : [];
  for (const input of inputs) {
    if (isRecord(input) && typeof input.id === 'string' && asked.has(input.id)) out.push({ id: input.id, exact: input.match === 'exact' });
  }
  if (out.length === 0 && typeof variant.id === 'string' && asked.has(variant.id)) out.push({ id: variant.id, exact: true });
  return out;
}

/** A search result is the sampled product when it names the same page, or the same handle. */
function sameProduct(ref: ProductRef, product: Record<string, unknown>): boolean {
  if (typeof product.url === 'string') {
    const key = urlKey(product.url);
    if (key !== null && key === urlKey(ref.url)) return true;
  }
  return ref.handle !== undefined && product.handle === ref.handle;
}

function toSighting(
  surface: Surface,
  ref: ProductRef,
  product: Record<string, unknown>,
  variant: Record<string, unknown>,
  at: string,
  fetchedAt: string,
  scope: Sighting['scope'],
): { sighting: Sighting; issues: CollectIssue[] } {
  const issues: CollectIssue[] = [];
  // The ref's URL, always: the catalogue's own `url` may name another host
  // for the same page, and the graph joins surfaces by URL.
  const ids: VariantIds = { url: ref.url };
  if (nonEmptyString(variant.sku)) ids.sku = variant.sku;
  const gtin = barcodeGtin(variant.barcodes);
  if (gtin) ids.gtin = gtin;
  const options = optionsOf(variant.options);
  if (options) ids.options = options;
  const alias = typeof variant.id === 'string' ? backendId(variant.id) : undefined;
  if (alias) ids.aliases = [alias];

  const sighting: Sighting = { surface, scope, ids };
  if (nonEmptyString(product.title)) sighting.title = product.title;
  const observe = <T>(value: T, raw: string, field: string): Observation<T> => ({ value, raw, surface, locator: `${at}/${field}`, fetchedAt });

  // A variant sold by weight or by time is priced per unit of that measure,
  // which says nothing about the price of one item. Such a price is left out.
  if (perItem(variant.quantity_unit)) {
    const price = readPrice(variant.price);
    if (price === 'unreadable') {
      issues.push(issueOf(surface, 'field-unreadable', 'price is not a whole number of minor units with a currency code', `${at}/price`));
    } else if (price) {
      sighting.price = observe(price.money, price.raw, 'price');
      // A list price at or below the price is not a discount, and Shopify
      // sends 0 when there is none. Neither is reported as a list price.
      const list = readPrice(variant.list_price);
      if (list && list !== 'unreadable' && list.money.currency === price.money.currency && list.money.units > price.money.units) {
        sighting.listPrice = observe(list.money, list.raw, 'list_price');
      }
    }
  }

  const availability = readAvailability(variant.availability);
  if (availability) sighting.availability = observe(availability, JSON.stringify(variant.availability), 'availability');
  return { sighting, issues };
}

/**
 * A UCP price: a whole number of the currency's minor units (cents for USD,
 * yen for JPY) and an ISO 4217 code. Anything else is unreadable, never
 * guessed at: an amount without a currency has no known minor unit.
 */
function readPrice(value: unknown): { money: Money; raw: string } | 'unreadable' | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return 'unreadable';
  const { amount, currency } = value;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return 'unreadable';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return 'unreadable';
  const money = fromMinor(amount, minorUnitOf(currency), currency);
  return money ? { money, raw: JSON.stringify(value) } : 'unreadable';
}

/** No sale basis means each; UN/CEFACT C62 is "one", the same thing said explicitly. */
function perItem(quantityUnit: unknown): boolean {
  return quantityUnit === undefined || (isRecord(quantityUnit) && quantityUnit.unit === 'C62');
}

const STATUSES: Readonly<Record<string, Availability>> = {
  in_stock: 'in_stock',
  backorder: 'backorder',
  preorder: 'preorder',
  out_of_stock: 'out_of_stock',
  discontinued: 'discontinued',
};

/**
 * UCP availability is `available` (can it be obtained) qualified by an
 * optional `status`. The status is used when it is a well-known one that
 * agrees with `available`; when the two disagree, `available` is the answer.
 */
function readAvailability(value: unknown): Availability | undefined {
  if (!isRecord(value)) return undefined;
  const status = typeof value.status === 'string' && Object.hasOwn(STATUSES, value.status) ? STATUSES[value.status] : undefined;
  const available = typeof value.available === 'boolean' ? value.available : undefined;
  if (status && (available === undefined || isBuyable(status) === available)) return status;
  if (available !== undefined) return available ? 'in_stock' : 'out_of_stock';
  return undefined;
}

/** UCP's well-known barcode types that are GTINs: GTIN, EAN, UPC, JAN, and ISBN-13 (an EAN). */
const GTIN_TYPES: ReadonlySet<string> = new Set(['GTIN', 'EAN', 'UPC', 'JAN', 'ISBN']);

function barcodeGtin(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const barcode of value) {
    if (isRecord(barcode) && typeof barcode.type === 'string' && GTIN_TYPES.has(barcode.type.toUpperCase()) && nonEmptyString(barcode.value)) {
      return barcode.value.trim();
    }
  }
  return undefined;
}

/**
 * A variant's selected options, `[{ name, label }]`. Shopify gives a product
 * without real variants a single "Title: Default Title" option; that names no
 * option the shop sells by, so it is left out, as the storefront reader does.
 */
function optionsOf(value: unknown): Record<string, string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs: [string, string][] = [];
  for (const option of value) {
    if (isRecord(option) && nonEmptyString(option.name) && nonEmptyString(option.label)) pairs.push([option.name, option.label]);
  }
  if (pairs.length === 0) return undefined;
  if (pairs.length === 1 && pairs[0]![0] === 'Title' && pairs[0]![1] === 'Default Title') return undefined;
  // fromEntries defines keys as own properties, so an option named "__proto__" stays data.
  return Object.fromEntries(pairs);
}

function issueOf(surface: Surface, code: string, message: string, locator: string): CollectIssue {
  return { surface, code, message, locator };
}
