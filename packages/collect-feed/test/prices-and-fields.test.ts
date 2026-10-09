import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFeed, type FeedOptions } from '../src/index.ts';
import { FEED_URL, FETCHED_AT, NOW, at, observation, rss } from './support.ts';

/** One item with id P-1 and the given extra elements, read at `now`. */
function sightingOf(extra: string, now: Date = NOW, options?: FeedOptions) {
  const body = rss(`<item><g:id>P-1</g:id><title>Thing</title><link>https://shop.example/p/thing</link>${extra}</item>`);
  const result = parseFeed(body, FEED_URL, FETCHED_AT, now, options);
  assert.deepStrictEqual(result.issues, []);
  assert.equal(result.sightings.length, 1);
  return result.sightings[0]!;
}

const USD = (units: number) => ({ units, currency: 'USD' });
const REGULAR = '<g:price>39.00 USD</g:price>';

describe('sale price', () => {
  it('is in effect when there is no effective date', () => {
    const s = sightingOf(`${REGULAR}<g:sale_price>30.00 USD</g:sale_price>`);
    assert.deepStrictEqual(s.price, observation(USD(300000), '30.00 USD', at('P-1', 'sale_price')));
    assert.deepStrictEqual(s.listPrice, observation(USD(390000), '39.00 USD', at('P-1', 'price')));
    assert.equal(s.priceValidUntil, undefined);
  });

  it('is in effect inside the interval, and the interval end is kept as written', () => {
    const s = sightingOf(
      `${REGULAR}<g:sale_price>30.00 USD</g:sale_price>` +
        '<g:sale_price_effective_date>2026-10-01T00:00-0800/2026-10-15T23:59-0800</g:sale_price_effective_date>',
    );
    assert.deepStrictEqual(s.price, observation(USD(300000), '30.00 USD', at('P-1', 'sale_price')));
    assert.deepStrictEqual(s.listPrice, observation(USD(390000), '39.00 USD', at('P-1', 'price')));
    assert.deepStrictEqual(
      s.priceValidUntil,
      observation('2026-10-15T23:59-0800', '2026-10-15T23:59-0800', at('P-1', 'sale_price_effective_date')),
    );
  });

  it('is not in effect after the interval, so the regular price is the price', () => {
    const s = sightingOf(
      `${REGULAR}<g:sale_price>30.00 USD</g:sale_price>` +
        '<g:sale_price_effective_date>2026-10-01T00:00-0800/2026-10-15T23:59-0800</g:sale_price_effective_date>',
      new Date('2026-10-20T00:00:00Z'),
    );
    assert.deepStrictEqual(s.price, observation(USD(390000), '39.00 USD', at('P-1', 'price')));
    assert.equal(s.listPrice, undefined);
    assert.equal(s.priceValidUntil, undefined);
  });

  it('is not in effect before the interval either', () => {
    const s = sightingOf(
      `${REGULAR}<g:sale_price>30.00 USD</g:sale_price>` +
        '<g:sale_price_effective_date>2026-10-01T00:00-0800/2026-10-15T23:59-0800</g:sale_price_effective_date>',
      new Date('2026-09-30T00:00:00Z'),
    );
    assert.deepStrictEqual(s.price, observation(USD(390000), '39.00 USD', at('P-1', 'price')));
    assert.equal(s.listPrice, undefined);
  });

  it('treats an unreadable interval as in effect, without priceValidUntil', () => {
    const s = sightingOf(
      `${REGULAR}<g:sale_price>30.00 USD</g:sale_price>` +
        '<g:sale_price_effective_date>soon/later</g:sale_price_effective_date>',
    );
    assert.deepStrictEqual(s.price, observation(USD(300000), '30.00 USD', at('P-1', 'sale_price')));
    assert.deepStrictEqual(s.listPrice, observation(USD(390000), '39.00 USD', at('P-1', 'price')));
    assert.equal(s.priceValidUntil, undefined);
  });

  it('reports an unreadable sale price and keeps the regular price', () => {
    const body = rss(
      `<item><g:id>P-1</g:id><title>Thing</title><link>https://shop.example/p/thing</link>${REGULAR}<g:sale_price>ask</g:sale_price></item>`,
    );
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.sightings[0]?.price, observation(USD(390000), '39.00 USD', at('P-1', 'price')));
    assert.equal(result.sightings[0]?.listPrice, undefined);
    assert.deepStrictEqual(
      result.issues.map((i) => [i.code, i.locator]),
      [['feed-field-unreadable', at('P-1', 'sale_price')]],
    );
  });
});

describe('availability', () => {
  const cases: Array<[string, string | undefined]> = [
    ['in stock', 'in_stock'],
    ['in_stock', 'in_stock'],
    ['out of stock', 'out_of_stock'],
    ['preorder', 'preorder'],
    ['backorder', 'backorder'],
    ['sold out someday', undefined],
  ];
  for (const [text, expected] of cases) {
    it(`reads "${text}" as ${expected ?? 'nothing'}`, () => {
      const s = sightingOf(`${REGULAR}<g:availability>${text}</g:availability>`);
      if (expected === undefined) {
        assert.equal(s.availability, undefined);
      } else {
        assert.deepStrictEqual(s.availability, observation(expected, text, at('P-1', 'availability')));
      }
    });
  }
});

describe('shipping', () => {
  it('reads a paid quote with its country', () => {
    const s = sightingOf(
      `${REGULAR}<g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>6.20 USD</g:price></g:shipping>`,
    );
    assert.deepStrictEqual(
      s.shipping,
      observation({ free: false, cost: USD(62000), country: 'US' }, '6.20 USD', at('P-1', 'shipping')),
    );
  });

  it('reads a zero cost as free', () => {
    const s = sightingOf(
      `${REGULAR}<g:shipping><g:country>us</g:country><g:price>0.00 USD</g:price></g:shipping>`,
    );
    assert.deepStrictEqual(
      s.shipping,
      observation({ free: true, cost: USD(0), country: 'US' }, '0.00 USD', at('P-1', 'shipping')),
    );
  });

  it('takes the first entry that has a price', () => {
    const s = sightingOf(
      `${REGULAR}` +
        '<g:shipping><g:country>FR</g:country><g:service>Post</g:service></g:shipping>' +
        '<g:shipping><g:country>CA</g:country><g:price>9.00 CAD</g:price></g:shipping>' +
        '<g:shipping><g:country>US</g:country><g:price>6.20 USD</g:price></g:shipping>',
    );
    assert.deepStrictEqual(
      s.shipping,
      observation({ free: false, cost: { units: 90000, currency: 'CAD' }, country: 'CA' }, '9.00 CAD', at('P-1', 'shipping')),
    );
  });

  it('is absent when no entry states a price', () => {
    const s = sightingOf(`${REGULAR}<g:shipping><g:country>US</g:country><g:service>Pickup</g:service></g:shipping>`);
    assert.equal(s.shipping, undefined);
  });
});

describe('currency', () => {
  it('uses defaultCurrency when a price carries none', () => {
    const s = sightingOf('<g:price>39</g:price>', NOW, { defaultCurrency: 'EUR' });
    assert.deepStrictEqual(s.price, observation({ units: 390000, currency: 'EUR' }, '39', at('P-1', 'price')));
  });

  it('leaves the currency null when there is no default and the price states none', () => {
    const s = sightingOf('<g:price>39.00</g:price>');
    assert.deepStrictEqual(s.price, observation({ units: 390000, currency: null }, '39.00', at('P-1', 'price')));
  });

  it('prefers the currency written in the price over the default', () => {
    const s = sightingOf('<g:price>39.00 GBP</g:price>', NOW, { defaultCurrency: 'EUR' });
    assert.equal(s.price?.value.currency, 'GBP');
  });
});
