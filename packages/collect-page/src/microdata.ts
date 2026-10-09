// schema.org microdata, basic support only: one sighting per offers scope of
// each Product, or one from a direct price when the Product has no offers.

import type { CheerioAPI } from 'cheerio';
import { documentOf, type PageSource } from './document.ts';
import { parseAllMoney, parseMoney } from '@regmark/core';
import type { Availability, CollectIssue, CollectResult, Money, Observation, Sighting, Surface, VariantIds } from '@regmark/core';

const SURFACE: Surface = 'microdata';

type Doc = CheerioAPI;
type El = ReturnType<Doc>[0];

const PRODUCT_TYPE = /^https?:\/\/(?:www\.)?schema\.org\/Product$/i;

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

export function extractMicrodata(html: PageSource, pageUrl: string, fetchedAt: string): CollectResult {
  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [];
  try {
    const $ = documentOf(html);
    // A product that is a property of another item (an entry in a list of
    // related products, an accessory) is not the product this page sells.
    const products = $('[itemscope]').toArray().filter((el) => isProduct($, el) && !isElsewhere($, el));
    products.forEach((product, productIndex) => {
      emitProduct($, product, productIndex, { pageUrl, fetchedAt, out: sightings });
    });
  } catch (err) {
    issues.push({ surface: SURFACE, code: 'extract-failed', message: `could not read microdata: ${messageOf(err)}`, locator: pageUrl });
  }
  return { sightings, issues };
}

type Ctx = { pageUrl: string; fetchedAt: string; out: Sighting[] };

function emitProduct($: Doc, product: El, productIndex: number, ctx: Ctx): void {
  const prefix = `${ctx.pageUrl}#microdata[${productIndex}]`;
  const title = readValue($, findProp($, product, 'name'), ['content'])?.value;
  const offers = $(product)
    .find('[itemprop]')
    .toArray()
    .filter((el) => hasToken($, el, 'itemprop', 'offers') && ownedBy($, el, product));

  offers.forEach((offer, offerIndex) => {
    emitSighting($, offer, product, `${prefix}/offers[${offerIndex}]`, title, ctx);
  });

  if (offers.length === 0 && findProp($, product, 'price')) {
    emitSighting($, product, product, prefix, title, ctx);
  }
}

/** One sighting from `root`: an offer element, or the product itself when it carries a direct price. */
function emitSighting($: Doc, root: El, product: El, prefix: string, title: string | undefined, ctx: Ctx): void {
  const sku = fromRootOrProduct($, root, product, 'sku', ['content']);
  const gtin = fromRoot($, root, ['gtin13', 'gtin'], ['content']) ?? fromRootOrProduct($, root, product, 'gtin13', ['content']) ?? fromRootOrProduct($, root, product, 'gtin', ['content']);
  const mpn = fromRootOrProduct($, root, product, 'mpn', ['content']);
  const offerUrl = readValue($, findProp($, root, 'url'), ['href', 'content']);

  const ids: VariantIds = { url: ctx.pageUrl };
  if (sku !== undefined) ids.sku = sku.value;
  if (gtin !== undefined) ids.gtin = gtin.value;
  if (mpn !== undefined) ids.mpn = mpn.value;

  const variant = ids.sku !== undefined || ids.gtin !== undefined || ids.mpn !== undefined || hasQuery(offerUrl?.value, ctx.pageUrl);
  const sighting: Sighting = { surface: SURFACE, scope: variant ? 'variant' : 'product', ids };
  if (title !== undefined) sighting.title = title;

  const currency = readValue($, findProp($, root, 'priceCurrency'), ['content'])?.value ?? null;
  const priceField = readValue($, findProp($, root, 'price'), ['content']);
  if (priceField) {
    const price = moneyObs(ctx, `${prefix}/price`, priceField.value, currency);
    if (price) sighting.price = price;
  }

  const availabilityField = readValue($, findProp($, root, 'availability'), ['href', 'content']);
  const availability = availabilityField ? availabilityObs(ctx, `${prefix}/availability`, availabilityField.value) : undefined;
  if (availability) sighting.availability = availability;

  ctx.out.push(sighting);
}

function fromRoot($: Doc, root: El, names: string[], attrs: string[]): { value: string } | undefined {
  for (const name of names) {
    const found = readValue($, findProp($, root, name), attrs);
    if (found) return found;
  }
  return undefined;
}

/** A value read from the root, falling back to the product when the root does not state it. */
function fromRootOrProduct($: Doc, root: El, product: El, name: string, attrs: string[]): { value: string } | undefined {
  const own = readValue($, findProp($, root, name), attrs);
  if (own) return own;
  if (root === product) return undefined;
  return readValue($, findProp($, product, name), attrs);
}

/** itemprop values that make an item one of a list, or a product other than the page's own. */
const ELSEWHERE: ReadonlySet<string> = new Set(['item', 'itemlistelement', 'isrelatedto', 'issimilarto', 'isaccessoryorsparepartfor', 'isconsumablefor']);

function isElsewhere($: Doc, el: El): boolean {
  return tokens($(el).attr('itemprop')).some((t) => ELSEWHERE.has(t.toLowerCase()));
}

function isProduct($: Doc, el: El): boolean {
  if ($(el).attr('itemscope') === undefined) return false;
  return tokens($(el).attr('itemtype')).some((t) => PRODUCT_TYPE.test(t));
}

/**
 * The first element under `root` with the given itemprop that belongs to root
 * and not to a nested itemscope.
 */
function findProp($: Doc, root: El, name: string): El | undefined {
  return $(root)
    .find('[itemprop]')
    .toArray()
    .find((el) => hasToken($, el, 'itemprop', name) && ownedBy($, el, root));
}

/** True when no itemscope boundary sits between `el` and `root`. */
function ownedBy($: Doc, el: El, root: El): boolean {
  let cur = $(el).parent();
  while (cur.length > 0) {
    if (cur.get(0) === root) return true;
    if (cur.attr('itemscope') !== undefined) return false;
    cur = cur.parent();
  }
  return false;
}

/** The attribute value (when non-empty), else the element's trimmed text. */
function readValue($: Doc, el: El | undefined, attrs: string[]): { value: string } | undefined {
  if (!el) return undefined;
  for (const attr of attrs) {
    const raw = $(el).attr(attr);
    if (raw !== undefined && raw.trim() !== '') return { value: raw.trim() };
  }
  const text = $(el).text().trim();
  return text === '' ? undefined : { value: text };
}

function hasToken($: Doc, el: El, attr: string, token: string): boolean {
  return tokens($(el).attr(attr)).includes(token);
}

function tokens(value: string | undefined): string[] {
  return (value ?? '').trim().split(/\s+/).filter((t) => t !== '');
}

function moneyObs(ctx: Ctx, locator: string, amount: string, currency: string | null): Observation<Money> | undefined {
  const money = readMoney(amount, currency);
  return money ? obs(ctx, locator, money, amount) : undefined;
}

function availabilityObs(ctx: Ctx, locator: string, value: string): Observation<Availability> | undefined {
  const availability = AVAILABILITY.get((value.trim().split(/[/#]/).pop() ?? '').toLowerCase());
  return availability ? obs(ctx, locator, availability, value) : undefined;
}

function obs<T>(ctx: Ctx, locator: string, value: T, raw: string): Observation<T> {
  return { value, raw, surface: SURFACE, locator, fetchedAt: ctx.fetchedAt };
}

function hasQuery(rawUrl: string | undefined, base: string): boolean {
  if (rawUrl === undefined) return false;
  try {
    return new URL(rawUrl, base).search.length > 1;
  } catch {
    return false;
  }
}

function readMoney(text: string, currency: string | null): Money | null {
  // More than one amount means a range or a strike-through pair; neither is one price.
  if (parseAllMoney(text, { currency }).length !== 1) return null;
  return parseMoney(text, { currency });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
