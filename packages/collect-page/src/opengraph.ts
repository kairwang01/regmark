// Open Graph and product meta tags. These describe the product as a whole, so
// they yield at most one product-scope sighting.

import { documentOf, type PageSource } from './document.ts';
import { parseAllMoney, parseMoney } from '@regmark/core';
import type { Availability, CollectResult, Money, Observation, Sighting, Surface } from '@regmark/core';

const SURFACE: Surface = 'opengraph';

type Tag = { attr: 'property' | 'name'; key: string; content: string };

const PRICE_AMOUNT = ['product:price:amount', 'og:price:amount', 'product:sale_price:amount'];
const PRICE_CURRENCY = ['product:price:currency', 'og:price:currency', 'product:sale_price:currency'];
const AVAILABILITY_KEYS = ['product:availability', 'og:availability'];

// Keys are matched after lowercasing, spaces, hyphens and underscores are removed.
const AVAILABILITY = new Map<string, Availability>([
  ['instock', 'in_stock'],
  ['availablefororder', 'in_stock'],
  ['outofstock', 'out_of_stock'],
  ['oos', 'out_of_stock'],
  ['soldout', 'out_of_stock'],
  ['preorder', 'preorder'],
  ['backorder', 'backorder'],
  ['discontinued', 'discontinued'],
]);

export function extractOpenGraph(html: PageSource, pageUrl: string, fetchedAt: string): CollectResult {
  const tags = readTags(html);
  const sighting = buildSighting(tags, pageUrl, fetchedAt);
  return { sightings: sighting ? [sighting] : [], issues: [] };
}

/** First tag per key, in document order. Empty content is ignored. */
function readTags(html: PageSource): Map<string, Tag> {
  const $ = documentOf(html);
  const found = new Map<string, Tag>();
  for (const el of $('meta').toArray()) {
    const meta = $(el);
    const content = meta.attr('content');
    if (content === undefined || content.trim() === '') continue;
    for (const attr of ['property', 'name'] as const) {
      const raw = meta.attr(attr);
      if (raw === undefined) continue;
      const key = raw.trim().toLowerCase();
      if (key !== '' && !found.has(key)) found.set(key, { attr, key, content });
    }
  }
  return found;
}

function firstTag(tags: Map<string, Tag>, keys: readonly string[]): Tag | undefined {
  for (const key of keys) {
    const tag = tags.get(key);
    if (tag) return tag;
  }
  return undefined;
}

function buildSighting(tags: Map<string, Tag>, pageUrl: string, fetchedAt: string): Sighting | undefined {
  const price = priceOf(tags, pageUrl, fetchedAt);
  const availability = availabilityOf(tags, pageUrl, fetchedAt);
  if (!price && !availability) return undefined;

  const url = resolve(firstTag(tags, ['og:url'])?.content, pageUrl);
  const ids: Sighting['ids'] = { url };
  const aliasTag = firstTag(tags, ['product:retailer_item_id']);
  const alias = aliasTag?.content.trim();
  if (alias) ids.aliases = [alias];

  const sighting: Sighting = { surface: SURFACE, scope: 'product', ids };
  const title = firstTag(tags, ['og:title'])?.content.trim();
  if (title) sighting.title = title;
  if (price) sighting.price = price;
  if (availability) sighting.availability = availability;
  return sighting;
}

function priceOf(tags: Map<string, Tag>, pageUrl: string, fetchedAt: string): Observation<Money> | undefined {
  const amount = firstTag(tags, PRICE_AMOUNT);
  if (!amount) return undefined;
  const currency = firstTag(tags, PRICE_CURRENCY)?.content.trim() ?? null;
  const money = readMoney(amount.content, currency);
  if (!money) return undefined;
  return {
    value: money,
    raw: amount.content,
    surface: SURFACE,
    locator: `${pageUrl}#meta[${amount.attr}="${amount.key}"]`,
    fetchedAt,
  };
}

function availabilityOf(tags: Map<string, Tag>, pageUrl: string, fetchedAt: string): Observation<Availability> | undefined {
  const tag = firstTag(tags, AVAILABILITY_KEYS);
  if (!tag) return undefined;
  const value = AVAILABILITY.get(tag.content.toLowerCase().replace(/[\s_-]/g, ''));
  if (!value) return undefined;
  return {
    value,
    raw: tag.content,
    surface: SURFACE,
    locator: `${pageUrl}#meta[${tag.attr}="${tag.key}"]`,
    fetchedAt,
  };
}

function resolve(raw: string | undefined, pageUrl: string): string {
  if (raw === undefined) return pageUrl;
  try {
    return new URL(raw.trim(), pageUrl).href;
  } catch {
    return pageUrl;
  }
}

function readMoney(text: string, currency: string | null): Money | null {
  // More than one amount means a range or a strike-through pair; neither is one price.
  if (parseAllMoney(text, { currency }).length !== 1) return null;
  return parseMoney(text, { currency });
}
