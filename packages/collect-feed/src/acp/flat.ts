// One row of a flat ACP feed, as OpenAI's file-upload format defines it, read
// as one variant sighting.
//
// The format looks like a Google Merchant feed and is not one, and the
// differences decide what an agent shows:
//   - a sale_price is the price whenever it is a valid sale. Sale dates are
//     metadata and schedule nothing, so a window that has ended does not
//     bring the regular price back, as it would in a Google feed;
//   - availability has its own spelling (pre_order, and unknown);
//   - money is always "79.99 USD", never "$79.99" or "79,99";
//   - a row with is_eligible_search=false is kept out of the agent on purpose.
//
// CSV and TSV files may instead follow OpenAI's Google-compatible profile,
// which takes Google's column names and spellings but none of the shipping,
// return or eligibility columns. Each value below is read the way the profile
// in force reads it, and anything the format would reject is reported, not
// repaired.

import { type Availability, type CollectIssue, type Money, money, type Observation, type ReturnPolicy, type ShippingQuote, type Sighting, type VariantIds } from '@regmark/core';
import { parseIso8601 } from '../dates.ts';
import { httpUrl, type MapContext, resolveUrl } from '../map.ts';
import { type FlatRecord, isObject, placeLocator, placeText, type Profile } from './read.ts';

const SURFACE = 'acp' as const;
const DAY_MS = 86_400_000;

/** The availability values each profile accepts. Anything else rejects the row. */
const AVAILABILITY: Readonly<Record<Profile, ReadonlyMap<string, Availability>>> = {
  openai: new Map([
    ['in_stock', 'in_stock'],
    ['out_of_stock', 'out_of_stock'],
    ['pre_order', 'preorder'],
    ['backorder', 'backorder'],
    // "Stock status unavailable": a statement that says nothing either way.
    ['unknown', 'unknown'],
  ]),
  google: new Map([
    ['in_stock', 'in_stock'],
    ['out_of_stock', 'out_of_stock'],
    ['preorder', 'preorder'],
    ['backorder', 'backorder'],
  ]),
};

/**
 * The names each value goes by, the one that wins first. The order is the
 * spec's: "item_id wins over id and sku; group_id wins over item_group_id; the
 * enable_ flags win over their is_eligible_ names; return_window wins over
 * return_deadline_in_days".
 */
const NAMES: Readonly<Record<Profile, { id: readonly string[]; group: readonly string[]; url: string }>> = {
  openai: { id: ['item_id', 'id', 'sku'], group: ['group_id', 'item_group_id'], url: 'url' },
  google: { id: ['id'], group: ['item_group_id'], url: 'link' },
};
const SEARCH = ['enable_search', 'is_eligible_search'] as const;
const RETURN_WINDOW = ['return_window', 'return_deadline_in_days'] as const;

/** Fields every row must carry, besides its id and page URL, or the row is rejected. */
const REQUIRED: Readonly<Record<Profile, readonly string[]>> = {
  openai: ['title', 'description', 'brand', 'seller_name', 'image_url', 'availability', 'price'],
  google: ['title', 'description', 'image_link', 'availability', 'price', 'brand'],
};

/** In the Google-compatible profile these attributes are a grouped variant's options. */
const GOOGLE_OPTIONS = ['color', 'size', 'material', 'age_group', 'gender', 'pattern', 'size_type'] as const;

/** A decimal amount in major units, a space, and the ISO 4217 code: "79.99 USD". */
const MONEY = /^(\d+(?:\.\d+)?)(?:\s+([A-Za-z]{3}))?$/;

/** Omitted, JSON null and an empty cell all mean the row gives no value. */
const present = (v: unknown): boolean => !(v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));

/** A value as it reads in a message, cut so a long cell cannot flood the report. */
function shown(v: unknown): string {
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * The end of a sale window "start/end", each end an ISO 8601 date or a
 * date-time with a zone, start before end. A date alone covers its whole UTC
 * day. The end is returned as written for a date, which price.sale-expired
 * reads as the end of that day, and as an instant otherwise.
 */
function saleWindowEnd(text: string): string | undefined {
  const parts = text.split('/');
  if (parts.length !== 2) return undefined;
  const start = parseIso8601(parts[0]!);
  const end = parseIso8601(parts[1]!);
  if (!start || !end) return undefined;
  const endAt = end.dateOnly ? end.time + DAY_MS - 1 : end.time;
  if (start.time >= endAt) return undefined;
  return end.dateOnly ? parts[1]!.trim() : new Date(end.time).toISOString();
}

/** Reads the fields of one row and reports what it cannot read, with the row's locator. */
type Row = {
  profile: Profile;
  fields: Record<string, unknown>;
  ctx: MapContext;
  issues: CollectIssue[];
  /** `<feed URL>#item[id="..."]` once the id is known; the row's place before. */
  at: string;
};

function report(row: Row, code: string, message: string, field?: string): void {
  row.issues.push({ surface: SURFACE, code, message, locator: field ? `${row.at}/${field}` : row.at });
}
const unreadable = (row: Row, field: string, message: string): void => report(row, 'feed-field-unreadable', message, field);
const ignored = (row: Row, field: string, message: string): void => report(row, 'feed-field-ignored', message, field);

function observe<T>(row: Row, value: T, raw: string, field: string): Observation<T> {
  return { value, raw, surface: SURFACE, locator: `${row.at}/${field}`, fetchedAt: row.ctx.fetchedAt };
}

/** The first of several names for one value that the row fills in. */
const winner = (row: Row, names: readonly string[]): string | undefined => names.find((n) => present(row.fields[n]));

/** Says so when a row fills in two names for one value and they disagree: only the winner is read. */
function reportShadowed(row: Row, names: readonly string[]): void {
  const first = winner(row, names);
  if (!first) return;
  for (const other of names) {
    if (other === first || !present(row.fields[other])) continue;
    if (JSON.stringify(row.fields[other]) === JSON.stringify(row.fields[first])) continue;
    ignored(row, other, `${other} is ignored: ${first} is also given, and wins`);
  }
}

/** Text, or a number written as JSON. Anything else in a text field is reported and left out. */
function text(row: Row, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const v = row.fields[name];
  if (!present(v)) return undefined;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  unreadable(row, name, `${name} is ${shown(v)}, not text`);
  return undefined;
}

/** JSON true or false, or the lowercase words in a CSV or TSV cell. */
function flag(row: Row, name: string | undefined): boolean | undefined {
  if (name === undefined) return undefined;
  const v = row.fields[name];
  if (!present(v)) return undefined;
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  unreadable(row, name, `${name} ${shown(v)} is not true or false`);
  return undefined;
}

/**
 * "79.99 USD", read strictly: a decimal point, no grouping, no symbol. A
 * looser reader would turn "1,299 USD" into an amount the agent may read
 * differently. A missing currency is left null for price.currency-ambiguous
 * to report, unless the caller named one.
 */
function readMoney(row: Row, field: string, written: string): Money | undefined {
  const m = MONEY.exec(written);
  let value: Money | undefined;
  try {
    value = m ? money(m[1]!, m[2] ?? row.ctx.defaultCurrency) : undefined;
  } catch {
    // An amount too large to hold exactly is not one to compare.
    value = undefined;
  }
  if (!value) unreadable(row, field, `${field} "${written}" is not an amount and currency such as "79.99 USD"`);
  return value;
}

/** In a JSON Lines record an object; in a CSV or TSV cell, that object written as JSON. */
function variantDict(row: Row): Record<string, string> | undefined {
  let value = row.fields.variant_dict;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  }
  const entries = isObject(value) ? Object.entries(value) : undefined;
  if (!entries || entries.some(([k, v]) => k.trim() === '' || typeof v !== 'string' || v.trim() === '')) {
    unreadable(row, 'variant_dict', `variant_dict ${shown(row.fields.variant_dict)} is not an object of option names to values`);
    return undefined;
  }
  return Object.fromEntries(entries.map(([k, v]) => [k.trim(), (v as string).trim()]));
}

/**
 * OpenAI format: variant_dict, when the row says it is one of a group
 * (listing_has_variations=true and a group id of its own); otherwise the spec
 * ignores it, and so does this. Without a variant_dict, the older
 * Custom_variantN_category and Custom_variantN_option pairs, under the same
 * condition. Flat attributes such as size describe the item, not a choice.
 */
function openaiOptions(row: Row, grouped: boolean): Record<string, string> | undefined {
  const condition = 'listing_has_variations=true and a group_id that differs from item_id';
  if (present(row.fields.variant_dict)) {
    const dict = variantDict(row);
    if (dict && !grouped) ignored(row, 'variant_dict', `variant_dict is ignored: it needs ${condition}`);
    return grouped ? dict : undefined;
  }
  const pairs: Record<string, string> = {};
  for (const n of [1, 2, 3]) {
    const category = text(row, winner(row, [`Custom_variant${n}_category`, `custom_variant${n}_category`]));
    const option = text(row, winner(row, [`Custom_variant${n}_option`, `custom_variant${n}_option`]));
    if (category && option) pairs[category] = option;
  }
  if (Object.keys(pairs).length === 0) return undefined;
  if (!grouped) ignored(row, 'custom_variant1_category', `the Custom_variant pairs are ignored: they need ${condition}`);
  return grouped ? pairs : undefined;
}

/** Google-compatible profile: the attributes a grouped row fills in become its options. */
function googleOptions(row: Row, grouped: boolean): Record<string, string> | undefined {
  if (!grouped) return undefined;
  const out: Record<string, string> = {};
  for (const name of GOOGLE_OPTIONS) {
    const value = text(row, name);
    if (value) out[name] = value;
  }
  return out;
}

/**
 * A valid sale is the price, whatever its dates say: in this format dates
 * schedule nothing. A sale that is not above zero, below the price and in its
 * currency "is not used", and the price is. A window that reads is kept as
 * the date the sale price says it ends.
 */
function readPrice(row: Row, s: Sighting): void {
  const regularText = text(row, 'price');
  const regular = regularText ? readMoney(row, 'price', regularText) : undefined;
  const saleText = text(row, 'sale_price');
  const sale = saleText ? readMoney(row, 'sale_price', saleText) : undefined;
  if (!regular || !regularText) return;
  if (!sale || !saleText) {
    s.price = observe(row, regular, regularText, 'price');
    return;
  }
  if (sale.units === 0 || sale.units >= regular.units || sale.currency !== regular.currency) {
    const consequence = row.profile === 'google' ? '; the Google-compatible profile rejects the row' : ', so the regular price is shown';
    ignored(row, 'sale_price', `sale_price "${saleText}" is not used: a sale must be above zero, below price "${regularText}" and in its currency${consequence}`);
    s.price = observe(row, regular, regularText, 'price');
    return;
  }
  s.price = observe(row, sale, saleText, 'sale_price');
  s.listPrice = observe(row, regular, regularText, 'price');
  const windowText = text(row, 'sale_price_effective_date');
  if (windowText) {
    const end = saleWindowEnd(windowText);
    if (end) s.priceValidUntil = observe(row, end, windowText, 'sale_price_effective_date');
    else unreadable(row, 'sale_price_effective_date', `sale_price_effective_date "${windowText}" is not a start/end pair of ISO 8601 dates, start first`);
  }
}

function readAvailability(row: Row, s: Sighting): void {
  const written = text(row, 'availability');
  if (!written) return;
  const accepted = AVAILABILITY[row.profile];
  const value = accepted.get(written.toLowerCase());
  if (value) s.availability = observe(row, value, written, 'availability');
  else unreadable(row, 'availability', `availability "${written}" is not one of ${[...accepted.keys()].join(', ')}; an agent rejects the row`);
}

/**
 * shipping_price, one charge in the price's currency; or, for a feed set up
 * for it, the tuple country:region:service_class:price, exactly four
 * positions. Not both: a row that sends both has its tuple ignored.
 */
function readShipping(row: Row, s: Sighting): void {
  const chargeText = text(row, 'shipping_price');
  const tuple = text(row, 'shipping');
  if (chargeText) {
    const cost = readMoney(row, 'shipping_price', chargeText);
    if (cost) s.shipping = observe<ShippingQuote>(row, { free: cost.units === 0, cost }, chargeText, 'shipping_price');
    if (tuple) ignored(row, 'shipping', 'shipping is ignored: the row also gives shipping_price, and a charge is sent one way or the other');
    return;
  }
  if (!tuple) return;
  const pieces = tuple.split(':');
  const country = (pieces[0] ?? '').trim().toUpperCase();
  if (pieces.length !== 4 || !/^[A-Z]{2}$/.test(country)) {
    unreadable(row, 'shipping', `shipping "${tuple}" is not country:region:service_class:price`);
    return;
  }
  const cost = readMoney(row, 'shipping', pieces[3]!.trim());
  if (cost) s.shipping = observe<ShippingQuote>(row, { free: cost.units === 0, cost, country }, tuple, 'shipping');
}

/**
 * accepts_returns says whether returns are taken; the window counts only when
 * they are, and the policy URL changes neither. A row that refuses returns
 * states a policy too: none, written as zero days, as JSON-LD's
 * MerchantReturnNotPermitted is.
 */
function readReturns(row: Row, s: Sighting): void {
  const accepts = flag(row, 'accepts_returns');
  reportShadowed(row, RETURN_WINDOW);
  const windowName = winner(row, RETURN_WINDOW);
  let days: number | undefined;
  if (windowName) {
    const v = row.fields[windowName];
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
    if (Number.isSafeInteger(n) && n > 0) days = n;
    else unreadable(row, windowName, `${windowName} ${shown(v)} is not a whole number of days above zero`);
  }
  if (windowName && days !== undefined && accepts !== true) {
    ignored(row, windowName, `${windowName} is ignored: a return window counts only with accepts_returns=true`);
    days = undefined;
  }
  const policyText = text(row, 'return_policy');
  const policyUrl = policyText ? httpUrl(policyText) : undefined;
  if (policyText && !policyUrl) unreadable(row, 'return_policy', `return_policy "${policyText}" is not an http or https URL`);

  let value: ReturnPolicy | undefined;
  if (accepts === true) value = days !== undefined ? { present: true, days } : { present: true };
  else if (accepts === false) value = { present: true, days: 0 };
  else if (policyUrl) value = { present: true };
  if (!value) return;
  if (policyUrl) value.url = policyUrl;
  const source = Object.fromEntries(['accepts_returns', ...RETURN_WINDOW, 'return_policy'].filter((n) => present(row.fields[n])).map((n) => [n, row.fields[n]]));
  s.returnPolicy = observe(row, value, JSON.stringify(source), accepts !== undefined ? 'accepts_returns' : 'return_policy');
}

/**
 * Maps one flat record to a variant sighting. Returns no sighting when the
 * record lacks the id or the page URL that make it addressable; other
 * problems are reported as issues and the field is left out.
 */
export function mapFlat(record: FlatRecord, profile: Profile, ctx: MapContext): { sighting?: Sighting; issues: CollectIssue[] } {
  const names = NAMES[profile];
  const row: Row = { profile, fields: record.fields, ctx, issues: [], at: placeLocator(ctx.feedUrl, record.place) };

  const id = text(row, winner(row, names.id));
  if (!id) {
    report(row, 'feed-item-incomplete', `${placeText(record.place)} has no ${names.id[0]}`);
    return { issues: row.issues };
  }
  row.at = `${ctx.feedUrl}#item[id="${id}"]`;
  reportShadowed(row, names.id);
  const link = text(row, names.url);
  if (!link) {
    report(row, 'feed-item-incomplete', `item "${id}" has no ${names.url}`);
    return { issues: row.issues };
  }

  const ids: VariantIds = { aliases: [id] };
  const url = resolveUrl(link, ctx.feedUrl);
  if (url) ids.url = url;
  const gtin = text(row, 'gtin');
  if (gtin) ids.gtin = gtin;
  const mpn = text(row, 'mpn');
  if (mpn) ids.mpn = mpn;
  const brand = text(row, 'brand');
  if (brand) ids.brand = brand;
  reportShadowed(row, names.group);
  const group = text(row, winner(row, names.group));
  // A group id equal to the item's own "does not establish a variant group".
  if (group && group !== id) ids.groupId = group;
  const options =
    profile === 'openai'
      ? openaiOptions(row, flag(row, 'listing_has_variations') === true && ids.groupId !== undefined)
      : googleOptions(row, ids.groupId !== undefined);
  if (options && Object.keys(options).length > 0) ids.options = options;

  const sighting: Sighting = { surface: SURFACE, scope: 'variant', ids };
  const title = text(row, 'title');
  if (title) sighting.title = title;

  // A row the merchant keeps out of agent search states nothing a buyer is
  // shown. It still lists the variant, so the feed is not partial for
  // leaving it out, but none of its facts are read. The Google-compatible
  // profile has search on for every row, whatever the column says.
  if (profile === 'openai') {
    reportShadowed(row, SEARCH);
    if (flag(row, winner(row, SEARCH)) === false) return { sighting, issues: row.issues };
  }

  const missing = REQUIRED[profile].filter((name) => !present(row.fields[name]));
  if (missing.length > 0) {
    report(row, 'feed-item-incomplete', `item "${id}" has no ${missing.join(', ')}, which the format requires; an agent rejects the row`);
  }

  readPrice(row, sighting);
  readAvailability(row, sighting);
  if (profile === 'openai') {
    readShipping(row, sighting);
    readReturns(row, sighting);
  }
  return { sighting, issues: row.issues };
}
