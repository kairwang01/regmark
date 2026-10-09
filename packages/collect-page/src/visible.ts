// What a person sees on the product page: the headline price, its regular
// price when it is on sale, and the stock line. Only the markup of the common
// storefront themes is recognised; anything else yields nothing rather than a guess.
import { parseAllMoney, type Availability, type CollectResult, type Money, type Observation, type Sighting } from '@regmark/core';
import type { CheerioAPI } from 'cheerio';
import { documentOf, type PageSource } from './document.ts';
import { findAll, hasClass, productTitle, select, tidy, textContent, type Node } from './text.ts';

export type VisibleOptions = {
  /** CSS selector for the element holding the current price. Overrides the built-in recognisers. */
  priceSelector?: string;
  availabilitySelector?: string;
  titleSelector?: string;
  /** Currency to assume when the text shows only a bare "$" or no symbol. */
  currency?: string | null;
};

type Hint = { currency?: string | null };
type Obs = <T>(value: T, raw: string, selector: string) => Observation<T>;

type PriceRead = {
  price?: Observation<Money>;
  listPrice?: Observation<Money>;
  /** Set by the Shopify branch when the product carries its sold-out marker. */
  soldOut?: Observation<Availability>;
};

export function extractVisible(html: PageSource, pageUrl: string, fetchedAt: string, options: VisibleOptions = {}): CollectResult {
  const $ = documentOf(html);
  const hint: Hint = { currency: options.currency };
  const obs: Obs = (value, raw, selector) => ({ value, raw, surface: 'page', locator: `${pageUrl}#css(${selector})`, fetchedAt });

  const heading = productTitle($, options.titleSelector);
  const read = readPrice($, options, hint, obs);
  const availability = readAvailability($, options, obs, read.soldOut);

  if (!read.price && !availability) return { sightings: [], issues: [] };

  const sighting: Sighting = { surface: 'page', scope: 'product', ids: { url: pageUrl } };
  if (heading) sighting.title = heading.text;
  if (read.price) sighting.price = read.price;
  if (read.listPrice) sighting.listPrice = read.listPrice;
  if (availability) sighting.availability = availability;
  return { sightings: [sighting], issues: [] };
}

/** The one amount in a piece of text, or undefined when there are none or several. */
function single(text: string, hint: Hint): Money | undefined {
  const all = parseAllMoney(text, hint);
  return all.length === 1 ? all[0] : undefined;
}

const isScreenReader = (n: Node): boolean => hasClass(n, 'screen-reader-text');

/**
 * The first recogniser that applies decides the price. Once one applies, a
 * price it cannot read unambiguously is left out; a later recogniser is not
 * tried, because it would be reading a different part of the page.
 */
function readPrice($: CheerioAPI, options: VisibleOptions, hint: Hint, obs: Obs): PriceRead {
  if (options.priceSelector) {
    const el = select($, options.priceSelector)[0];
    if (!el) return {};
    const text = tidy(textContent(el));
    const money = single(text, hint);
    return money ? { price: obs(money, text, options.priceSelector) } : {};
  }

  const woo = wooContainer($);
  if (woo) return readWoo(woo.el, woo.selector, hint, obs);

  const dawn = dawnContainer($);
  if (dawn) return readDawn(dawn, hint, obs);

  return {};
}

function wooContainer($: CheerioAPI): { el: Node; selector: string } | undefined {
  for (const selector of ['.summary p.price', '.summary .price', 'p.price']) {
    const el = select($, selector)[0];
    if (el) return { el, selector };
  }
  return undefined;
}

function readWoo(el: Node, selector: string, hint: Hint, obs: Obs): PriceRead {
  // Screen-reader spans repeat the prices in words; counting them would turn
  // one price into two.
  const ins = findAll(el, (n) => n.name === 'ins')[0];
  if (ins) {
    const insText = tidy(textContent(ins, isScreenReader));
    const price = single(insText, hint);
    const del = findAll(el, (n) => n.name === 'del')[0];
    const delText = del ? tidy(textContent(del, isScreenReader)) : '';
    const listPrice = del ? single(delText, hint) : undefined;
    return {
      ...(price ? { price: obs(price, insText, `${selector} ins`) } : {}),
      ...(listPrice ? { listPrice: obs(listPrice, delText, `${selector} del`) } : {}),
    };
  }

  // Two or more amounts with no sale markup is a price range, which has no single price.
  const text = tidy(textContent(el, isScreenReader));
  const money = single(text, hint);
  return money ? { price: obs(money, text, selector) } : {};
}

function dawnContainer($: CheerioAPI): Node | undefined {
  return select($, '.price').find((el) => findAll(el, (n) => hasClass(n, 'price__regular')).length > 0);
}

/** The first `.outer .inner` pair under `el`, in document order. */
function inside(el: Node, outer: string, inner: string): Node | undefined {
  for (const o of findAll(el, (n) => hasClass(n, outer))) {
    const found = findAll(o, (n) => hasClass(n, inner))[0];
    if (found) return found;
  }
  return undefined;
}

function readDawn(el: Node, hint: Hint, obs: Obs): PriceRead {
  // Class names without the dot; the locator spells the selector out.
  const pick = (outer: string, inner: string): Observation<Money> | undefined => {
    const node = inside(el, outer, inner);
    if (!node) return undefined;
    const text = tidy(textContent(node));
    const money = single(text, hint);
    return money ? obs(money, text, `.${outer} .${inner}`) : undefined;
  };

  const out: PriceRead = {};
  if (hasClass(el, 'price--on-sale')) {
    out.price = pick('price__sale', 'price-item--sale');
    out.listPrice = pick('price__sale', 'price-item--regular');
  } else {
    out.price = pick('price__regular', 'price-item--regular');
  }
  if (hasClass(el, 'price--sold-out')) out.soldOut = obs<Availability>('out_of_stock', 'price--sold-out', '.price');
  return out;
}

/**
 * Availability: an explicit selector wins outright. Otherwise the Shopify
 * sold-out marker, then the stock line of the common themes.
 */
function readAvailability($: CheerioAPI, options: VisibleOptions, obs: Obs, soldOut: Observation<Availability> | undefined): Observation<Availability> | undefined {
  if (options.availabilitySelector) {
    const el = select($, options.availabilitySelector)[0];
    return el ? decideAvailability(el, options.availabilitySelector, obs) : undefined;
  }
  if (soldOut) return soldOut;
  for (const selector of ['.summary .stock', 'p.stock']) {
    const el = select($, selector)[0];
    if (el) return decideAvailability(el, selector, obs);
  }
  return undefined;
}

function decideAvailability(el: Node, selector: string, obs: Obs): Observation<Availability> | undefined {
  const raw = tidy(textContent(el));
  const value = availabilityFromClass(el) ?? availabilityFromText(raw);
  return value ? obs(value, raw, selector) : undefined;
}

function availabilityFromClass(el: Node): Availability | undefined {
  if (hasClass(el, 'out-of-stock')) return 'out_of_stock';
  if (hasClass(el, 'in-stock')) return 'in_stock';
  if (hasClass(el, 'available-on-backorder')) return 'backorder';
  return undefined;
}

function availabilityFromText(raw: string): Availability | undefined {
  const t = raw.toLowerCase();
  // "not in stock" contains "in stock", so it must be checked first.
  if (/out of stock|sold out|not in stock/.test(t)) return 'out_of_stock';
  if (t.includes('in stock')) return 'in_stock';
  if (t.includes('backorder')) return 'backorder';
  if (/pre-?order/.test(t)) return 'preorder';
  return undefined;
}
