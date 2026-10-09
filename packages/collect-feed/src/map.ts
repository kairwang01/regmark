import {
  type Availability,
  type CollectIssue,
  type Money,
  type Observation,
  type ShippingQuote,
  type Sighting,
  type VariantIds,
  parseMoney,
} from '@regmark/core';
import type { FeedItem } from './item.ts';

export type MapContext = {
  feedUrl: string;
  fetchedAt: string;
  now: Date;
  defaultCurrency: string | null;
};

const AVAILABILITY: ReadonlyMap<string, Availability> = new Map([
  ['in_stock', 'in_stock'],
  ['out_of_stock', 'out_of_stock'],
  ['preorder', 'preorder'],
  ['backorder', 'backorder'],
]);

const OPTION_FIELDS = ['color', 'size', 'material', 'pattern'] as const;

export function resolveUrl(link: string, feedUrl: string): string | undefined {
  try {
    return new URL(link, feedUrl).href;
  } catch {
    return undefined;
  }
}

function parseDate(text: string): number | undefined {
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/**
 * Whether a sale is on at `now`. An absent or unreadable window counts as on:
 * the feed published a sale price, and guessing that it has lapsed would hide
 * a real disagreement. `until` is set only for a readable interval.
 */
function saleWindow(text: string | undefined, now: Date): { active: boolean; until?: string } {
  if (!text) return { active: true };
  const parts = text.split('/');
  if (parts.length !== 2) return { active: true };
  const start = parseDate((parts[0] ?? '').trim());
  const endText = (parts[1] ?? '').trim();
  const end = parseDate(endText);
  if (start === undefined || end === undefined) return { active: true };
  const at = now.getTime();
  return start <= at && at <= end ? { active: true, until: endText } : { active: false };
}

/**
 * Maps one feed item to a variant sighting. Returns no sighting when the item
 * lacks the id or link that makes it addressable; other problems with single
 * fields are reported as issues and the field is left out.
 */
export function mapItem(item: FeedItem, position: number, ctx: MapContext): { sighting?: Sighting; issues: CollectIssue[] } {
  const issues: CollectIssue[] = [];
  const f = (name: string): string | undefined => item.fields[name] || undefined;

  const id = f('id');
  if (!id) {
    issues.push({
      surface: 'feed',
      code: 'feed-item-incomplete',
      message: `item ${position} has no id`,
      locator: `${ctx.feedUrl}#item[${position}]`,
    });
    return { issues };
  }
  const at = `${ctx.feedUrl}#item[id="${id}"]`;
  const link = f('link');
  if (!link) {
    issues.push({ surface: 'feed', code: 'feed-item-incomplete', message: `item "${id}" has no link`, locator: at });
    return { issues };
  }

  const observe = <T>(value: T, raw: string, field: string): Observation<T> => ({
    value,
    raw,
    surface: 'feed',
    locator: `${at}/${field}`,
    fetchedAt: ctx.fetchedAt,
  });
  const readMoney = (field: string, text: string): Money | undefined => {
    const money = parseMoney(text, { currency: ctx.defaultCurrency });
    if (!money) {
      issues.push({
        surface: 'feed',
        code: 'feed-field-unreadable',
        message: `${field} "${text}" is not an amount`,
        locator: `${at}/${field}`,
      });
    }
    return money ?? undefined;
  };

  const ids: VariantIds = { aliases: [id] };
  const url = resolveUrl(link, ctx.feedUrl);
  if (url) ids.url = url;
  const gtin = f('gtin');
  if (gtin) ids.gtin = gtin;
  const mpn = f('mpn');
  if (mpn) ids.mpn = mpn;
  const brand = f('brand');
  if (brand) ids.brand = brand;
  const groupId = f('item_group_id');
  if (groupId) ids.groupId = groupId;
  const options: Record<string, string> = {};
  for (const name of OPTION_FIELDS) {
    const value = f(name);
    if (value) options[name] = value;
  }
  if (Object.keys(options).length > 0) ids.options = options;

  const sighting: Sighting = { surface: 'feed', scope: 'variant', ids };
  const title = f('title');
  if (title) sighting.title = title;

  // A sale in effect is what a buyer pays; the feed price becomes the list price.
  const regularText = f('price');
  const regular = regularText ? readMoney('price', regularText) : undefined;
  const saleText = f('sale_price');
  const sale = saleText ? readMoney('sale_price', saleText) : undefined;
  if (sale && saleText) {
    const interval = saleWindow(f('sale_price_effective_date'), ctx.now);
    if (interval.active) {
      sighting.price = observe(sale, saleText, 'sale_price');
      if (regular && regularText) sighting.listPrice = observe(regular, regularText, 'price');
      if (interval.until) {
        sighting.priceValidUntil = observe(interval.until, interval.until, 'sale_price_effective_date');
      }
    } else if (regular && regularText) {
      sighting.price = observe(regular, regularText, 'price');
    }
  } else if (regular && regularText) {
    sighting.price = observe(regular, regularText, 'price');
  }

  const availabilityText = f('availability');
  if (availabilityText) {
    const value = AVAILABILITY.get(availabilityText.toLowerCase().replace(/\s+/g, '_'));
    if (value) sighting.availability = observe(value, availabilityText, 'availability');
  }

  // Google takes the first entry that states a price.
  const entry = item.shipping[0];
  if (entry) {
    const cost = readMoney('shipping', entry.price);
    if (cost) {
      const country = entry.country?.toUpperCase();
      const quote: ShippingQuote = { free: cost.units === 0, cost };
      if (country && /^[A-Z]{2}$/.test(country)) quote.country = country;
      sighting.shipping = observe(quote, entry.raw, 'shipping');
    }
  }

  return { sighting, issues };
}
