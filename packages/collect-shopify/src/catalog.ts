// Reads the products of a Shopify shop from its public catalogue endpoint
// (products.json) and turns each selected variant into a platform sighting.

import { FetchRefused, parseMoney } from '@regmark/core';
import type {
  Availability,
  CollectContext,
  CollectIssue,
  CollectResult,
  Fetched,
  Observation,
  Sighting,
  VariantIds,
} from '@regmark/core';
import { errorText, isOk, isRecord, nonEmptyString, parseJson } from './http.ts';

export type ShopifyParent = { id: number; handle: string; url: string; variantCount: number };

export type ShopifyOptions = {
  /** Stop after this many products have been listed. Default 250 (one page). */
  maxProducts?: number;
  /** Products for which this returns false produce no sightings. They are still listed in `parents`. */
  select?: (parent: ShopifyParent) => boolean;
  /** The shop's currency, when the caller knows it. */
  currency?: string | null;
};

const PAGE_SIZE = 250;
// Shopify stops short on the last page, so a full page is the only reason to ask for another.
const MAX_PAGES = 20;
const DEFAULT_MAX_PRODUCTS = 250;
const PLACEHOLDER_OPTION = 'Default Title';

type Variant = { index: number; body: Record<string, unknown> };

type Listed = {
  parent: ShopifyParent;
  product: Record<string, unknown>;
  /** Position of the product in its response page, for locators. */
  productIndex: number;
  pageUrl: string;
  fetchedAt: string;
  variants: Variant[];
};

export async function collectShopifyCatalog(
  ctx: CollectContext,
  options: ShopifyOptions = {},
): Promise<CollectResult & { parents: ShopifyParent[] }> {
  try {
    return await readCatalog(ctx, options);
  } catch (err) {
    return { sightings: [], issues: [issue('collect-failed', errorText(err))], parents: [] };
  }
}

async function readCatalog(ctx: CollectContext, options: ShopifyOptions): Promise<CollectResult & { parents: ShopifyParent[] }> {
  const origin = ctx.store.origin;
  const maxProducts = options.maxProducts ?? DEFAULT_MAX_PRODUCTS;
  const currency = options.currency ?? null;
  const issues: CollectIssue[] = [];
  const listed: Listed[] = [];

  for (let page = 1; page <= MAX_PAGES && listed.length < maxProducts; page++) {
    const pageUrl = `${origin}/products.json?limit=${PAGE_SIZE}&page=${page}`;
    const read = await readPage(ctx, pageUrl);
    if (!read.ok) {
      // With no first page there is nothing to keep, so the failure is the whole result.
      if (page === 1) return { sightings: [], issues: [read.issue], parents: [] };
      issues.push(read.issue);
      break;
    }
    for (let index = 0; index < read.items.length && listed.length < maxProducts; index++) {
      const entry = readProduct(origin, read.items[index], pageUrl, index, read.fetchedAt);
      if (entry) listed.push(entry);
    }
    if (read.items.length < PAGE_SIZE) break;
  }

  const sightings: Sighting[] = [];
  for (const entry of listed) {
    if (options.select && !selects(options.select, entry.parent, ctx)) continue;
    for (const variant of entry.variants) sightings.push(buildSighting(entry, variant, currency));
  }

  return { sightings, issues, parents: listed.map((entry) => entry.parent) };
}

type PageRead = { ok: true; items: unknown[]; fetchedAt: string } | { ok: false; issue: CollectIssue };

async function readPage(ctx: CollectContext, url: string): Promise<PageRead> {
  let res: Fetched;
  try {
    res = await ctx.fetcher.get(url);
  } catch (err) {
    return { ok: false, issue: fetchIssue(err, url) };
  }
  if (!isOk(res.status)) return { ok: false, issue: issue('fetch-failed', `HTTP ${res.status}`, url) };
  const parsed = parseJson(res.body);
  if (!parsed) return { ok: false, issue: issue('parse-error', 'response is not JSON', url) };
  const body = parsed.value;
  if (!isRecord(body) || !Array.isArray(body.products)) {
    return { ok: false, issue: issue('parse-error', 'response has no products array', url) };
  }
  return { ok: true, items: body.products as unknown[], fetchedAt: res.fetchedAt };
}

/** Returns undefined for anything that cannot be identified; such entries are skipped without an issue. */
function readProduct(origin: string, item: unknown, pageUrl: string, productIndex: number, fetchedAt: string): Listed | undefined {
  if (!isRecord(item)) return undefined;
  const id = item.id;
  const handle = item.handle;
  if (!isId(id) || !nonEmptyString(handle)) return undefined;

  const variants: Variant[] = [];
  const rawVariants: unknown[] = Array.isArray(item.variants) ? (item.variants as unknown[]) : [];
  for (let index = 0; index < rawVariants.length; index++) {
    const variant = rawVariants[index];
    if (isRecord(variant) && isId(variant.id)) variants.push({ index, body: variant });
  }

  return {
    // The handle is merchant text, so it is encoded rather than trusted to be a path segment.
    parent: { id, handle, url: `${origin}/products/${encodeURIComponent(handle)}`, variantCount: variants.length },
    product: item,
    productIndex,
    pageUrl,
    fetchedAt,
    variants,
  };
}

function buildSighting(entry: Listed, variant: Variant, currency: string | null): Sighting {
  const { parent, product, productIndex, pageUrl, fetchedAt } = entry;
  const body = variant.body;
  // Locators point into the response page, so the indexes are the positions in the arrays as served.
  const base = `${pageUrl}#/products/${productIndex}/variants/${variant.index}`;

  const ids: VariantIds = { productId: String(parent.id), variantId: String(body.id), url: parent.url };
  if (nonEmptyString(body.sku)) ids.sku = body.sku;
  if (nonEmptyString(product.vendor)) ids.brand = product.vendor;
  const options = variantOptions(product.options, body);
  if (options) ids.options = options;

  const sighting: Sighting = { surface: 'platform', scope: 'variant', ids };
  if (nonEmptyString(product.title)) sighting.title = product.title;

  const rawPrice = body.price;
  const price = typeof rawPrice === 'string' ? parseMoney(rawPrice, { currency }) : null;
  if (price && typeof rawPrice === 'string') {
    sighting.price = observe(price, rawPrice, `${base}/price`, fetchedAt);
    // A compare-at price at or below the sale price is not a discount, so it is not reported as a list price.
    const rawCompare = body.compare_at_price;
    const compare = typeof rawCompare === 'string' ? parseMoney(rawCompare, { currency }) : null;
    if (compare && typeof rawCompare === 'string' && compare.units > price.units) {
      sighting.listPrice = observe(compare, rawCompare, `${base}/compare_at_price`, fetchedAt);
    }
  }

  const available = body.available;
  if (available === true || available === false) {
    const value: Availability = available ? 'in_stock' : 'out_of_stock';
    sighting.availability = observe(value, String(available), `${base}/available`, fetchedAt);
  }
  return sighting;
}

/**
 * Pairs the product's option names with the variant's option values. Shopify
 * gives a product without real variants a single "Title: Default Title" option;
 * that placeholder names no option the shop sells by, so it is left out.
 */
function variantOptions(productOptions: unknown, variant: Record<string, unknown>): Record<string, string> | undefined {
  const names: unknown[] = Array.isArray(productOptions) ? (productOptions as unknown[]) : [];
  const pairs: [string, string][] = [];
  for (let i = 0; i < 3; i++) {
    const option = names[i];
    const name = isRecord(option) ? option.name : undefined;
    const value = variant[`option${i + 1}`];
    if (nonEmptyString(name) && nonEmptyString(value)) pairs.push([name, value]);
  }
  if (pairs.length === 0) return undefined;
  if (pairs.length === 1 && pairs[0]![0] === 'Title' && pairs[0]![1] === PLACEHOLDER_OPTION) return undefined;
  // fromEntries defines keys as own properties, so an option named "__proto__" stays data.
  return Object.fromEntries(pairs);
}

/** A select that throws is a bug in the caller's filter, not a reason to lose the whole run. */
function selects(select: (parent: ShopifyParent) => boolean, parent: ShopifyParent, ctx: CollectContext): boolean {
  try {
    return Boolean(select(parent));
  } catch (err) {
    ctx.log('warn', `select rejected product ${parent.id}: ${errorText(err)}`);
    return false;
  }
}

function observe<T>(value: T, raw: string, locator: string, fetchedAt: string): Observation<T> {
  return { value, raw, surface: 'platform', locator, fetchedAt };
}

function issue(code: string, message: string, locator?: string): CollectIssue {
  // Built without an undefined locator key so issues compare cleanly with deepEqual.
  return locator === undefined ? { surface: 'platform', code, message } : { surface: 'platform', code, message, locator };
}

function fetchIssue(err: unknown, url: string): CollectIssue {
  if (err instanceof FetchRefused && err.code === 'robots') return issue('robots-disallowed', err.message, url);
  return issue('fetch-failed', errorText(err), url);
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
