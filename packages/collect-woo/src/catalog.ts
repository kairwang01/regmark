// Reads the parent products of a WooCommerce shop from the public Store API,
// and turns each selected variant (or simple product) into a platform sighting.

import { sameMoney } from '@regmark/core';
import type { Availability, CollectContext, CollectIssue, CollectResult, Observation, Sighting, VariantIds } from '@regmark/core';
import { apiBase, errorText, getJson, isRecord, makeIssue, nonEmptyString, observe, readMinor } from './http.ts';

export type WooParent = { id: number; slug: string; permalink: string; type: string; variationIds: number[] };

export type CatalogOptions = {
  /** Stop after this many parent products have been listed. Default 1000. */
  maxProducts?: number;
  /** Select from the complete listing without fetching it again. Rejected parents produce no requests or sightings. */
  select?: (parent: WooParent, parents: readonly WooParent[]) => boolean;
};

const PER_PAGE = 100;
// A server that keeps answering full pages, or lies about its page count, must not keep us paging forever.
const MAX_PAGES = 50;
const DEFAULT_MAX_PRODUCTS = 1000;

type Listed = {
  parent: WooParent;
  name: string | undefined;
  /** The parent object as the list response gave it. Simple products are read from here. */
  body: Record<string, unknown>;
  /** JSON pointer into the list response, such as "<list url>#/3". */
  pointer: string;
  fetchedAt: string;
  /** Attributes of each variation as the parent lists them, keyed by variation id. */
  attributes: Map<number, Record<string, string>>;
};

export async function collectWooCatalog(
  ctx: CollectContext,
  options: CatalogOptions = {},
): Promise<CollectResult & { parents: WooParent[] }> {
  try {
    return await readCatalog(ctx, options);
  } catch (err) {
    return { sightings: [], issues: [makeIssue('platform', 'collect-failed', errorText(err))], parents: [] };
  }
}

async function readCatalog(ctx: CollectContext, options: CatalogOptions): Promise<CollectResult & { parents: WooParent[] }> {
  const base = apiBase(ctx);
  const maxProducts = options.maxProducts ?? DEFAULT_MAX_PRODUCTS;
  const issues: CollectIssue[] = [];
  const listed: Listed[] = [];

  for (let page = 1; page <= MAX_PAGES && listed.length < maxProducts; page++) {
    const listUrl = `${base}/products?per_page=${PER_PAGE}&page=${page}`;
    const read = await readList(ctx, listUrl);
    if (!read.ok) {
      // With no first page there is nothing to report but the failure itself.
      if (page === 1) return { sightings: [], issues: [read.issue], parents: [] };
      issues.push(read.issue);
      break;
    }
    for (let index = 0; index < read.items.length && listed.length < maxProducts; index++) {
      const entry = readParent(read.items[index], listUrl, index, read.fetchedAt);
      issues.push(...entry.issues);
      if (entry.listed) listed.push(entry.listed);
    }
    if (read.items.length < PER_PAGE) break;
    if (read.totalPages !== undefined && page >= read.totalPages) break;
  }

  const sightings: Sighting[] = [];
  const parents = listed.map((entry) => entry.parent);
  for (const entry of listed) {
    if (options.select && !selects(options.select, entry.parent, parents, ctx)) continue;

    if (entry.parent.type === 'simple' || entry.parent.variationIds.length === 0) {
      sightings.push(buildSighting(entry.parent, entry.name, entry.body, entry.pointer, entry.fetchedAt, String(entry.parent.id), undefined));
      continue;
    }
    for (const variationId of entry.parent.variationIds) {
      const url = `${base}/products/${variationId}`;
      const read = await getJson(ctx, url, 'platform');
      if (!read.ok) {
        issues.push(read.issue);
        continue;
      }
      if (!isRecord(read.body)) {
        issues.push(makeIssue('platform', 'parse-error', 'variation is not an object', url));
        continue;
      }
      // The pointer is the response's own root, so locators read "<url>#/prices/price".
      sightings.push(
        buildSighting(
          entry.parent,
          entry.name,
          read.body,
          `${url}#`,
          read.res.fetchedAt,
          String(variationId),
          entry.attributes.get(variationId),
        ),
      );
    }
  }

  return { sightings, issues, parents };
}

type ListRead =
  | { ok: true; items: unknown[]; fetchedAt: string; totalPages: number | undefined }
  | { ok: false; issue: CollectIssue };

async function readList(ctx: CollectContext, url: string): Promise<ListRead> {
  const read = await getJson(ctx, url, 'platform');
  if (!read.ok) return { ok: false, issue: read.issue };
  if (!Array.isArray(read.body)) {
    return { ok: false, issue: makeIssue('platform', 'parse-error', 'product list is not an array', url) };
  }
  return {
    ok: true,
    items: read.body as unknown[],
    fetchedAt: read.res.fetchedAt,
    totalPages: wholeNumber(read.res.headers['x-wp-totalpages']),
  };
}

/** A select that throws is a bug in the caller's filter, not a reason to lose the whole run. */
function selects(select: NonNullable<CatalogOptions['select']>, parent: WooParent, parents: readonly WooParent[], ctx: CollectContext): boolean {
  try {
    return Boolean(select(parent, parents));
  } catch (err) {
    ctx.log('warn', `select rejected parent ${parent.id}: ${errorText(err)}`);
    return false;
  }
}

function readParent(item: unknown, listUrl: string, index: number, fetchedAt: string): { listed?: Listed; issues: CollectIssue[] } {
  const pointer = `${listUrl}#/${index}`;
  if (!isRecord(item)) {
    return { issues: [makeIssue('platform', 'parse-error', 'product entry is not an object', pointer)] };
  }
  const id = item.id;
  if (!isId(id)) {
    return { issues: [makeIssue('platform', 'parse-error', 'product has no numeric id', pointer)] };
  }

  const issues: CollectIssue[] = [];
  const variationIds: number[] = [];
  const attributes = new Map<number, Record<string, string>>();
  const variations: unknown[] = Array.isArray(item.variations) ? item.variations : [];
  variations.forEach((variation, position) => {
    if (!isRecord(variation) || !isId(variation.id)) {
      issues.push(makeIssue('platform', 'parse-error', 'variation entry has no numeric id', `${pointer}/variations/${position}`));
      return;
    }
    variationIds.push(variation.id);
    const options = optionsOf(variation.attributes);
    if (options) attributes.set(variation.id, options);
  });

  const parent: WooParent = {
    id,
    slug: stringOr(item.slug),
    permalink: stringOr(item.permalink),
    type: stringOr(item.type),
    variationIds,
  };
  const name = typeof item.name === 'string' && item.name !== '' ? item.name : undefined;
  return { listed: { parent, name, body: item, pointer, fetchedAt, attributes }, issues };
}

function buildSighting(
  parent: WooParent,
  name: string | undefined,
  body: Record<string, unknown>,
  pointer: string,
  fetchedAt: string,
  variantId: string,
  options: Record<string, string> | undefined,
): Sighting {
  const ids: VariantIds = { productId: String(parent.id), variantId };
  if (nonEmptyString(body.sku)) ids.sku = body.sku;
  // Every variant reports the parent's URL so that all surfaces agree on which product page is meant.
  if (parent.permalink !== '') ids.url = parent.permalink;
  if (options) ids.options = options;

  const sighting: Sighting = { surface: 'platform', scope: 'variant', ids };
  if (nonEmptyString(name)) sighting.title = name;

  const price = readMinor(body.prices, 'price');
  if (price) {
    sighting.price = observe(price.value, price.raw, 'platform', `${pointer}/prices/price`, fetchedAt);
    const regular = readMinor(body.prices, 'regular_price');
    if (regular && body.on_sale === true && !sameMoney(price.value, regular.value)) {
      sighting.listPrice = observe(regular.value, regular.raw, 'platform', `${pointer}/prices/regular_price`, fetchedAt);
    }
  }

  const availability = availabilityOf(body, pointer, fetchedAt);
  if (availability) sighting.availability = availability;
  return sighting;
}

/** Backorder is checked first: a backordered item also reports itself out of stock. */
function availabilityOf(body: Record<string, unknown>, pointer: string, fetchedAt: string): Observation<Availability> | undefined {
  if (body.is_on_backorder === true) {
    return observe<Availability>('backorder', 'true', 'platform', `${pointer}/is_on_backorder`, fetchedAt);
  }
  if (body.is_in_stock === true) {
    return observe<Availability>('in_stock', 'true', 'platform', `${pointer}/is_in_stock`, fetchedAt);
  }
  if (body.is_in_stock === false) {
    return observe<Availability>('out_of_stock', 'false', 'platform', `${pointer}/is_in_stock`, fetchedAt);
  }
  return undefined;
}

function optionsOf(attributes: unknown): Record<string, string> | undefined {
  if (!Array.isArray(attributes)) return undefined;
  const pairs: [string, string][] = [];
  for (const attribute of attributes as unknown[]) {
    if (isRecord(attribute) && nonEmptyString(attribute.name) && typeof attribute.value === 'string') {
      pairs.push([attribute.name, attribute.value]);
    }
  }
  // fromEntries defines keys as own properties, so an attribute named "__proto__" stays data.
  return pairs.length > 0 ? Object.fromEntries(pairs) : undefined;
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function stringOr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function wholeNumber(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+$/.test(text.trim())) return undefined;
  return Number(text.trim());
}
