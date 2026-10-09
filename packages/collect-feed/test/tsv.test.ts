import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFeed } from '../src/index.ts';
import { at, FEED_URL, FETCHED_AT, NOW, observation } from './support.ts';

describe('tab-separated feed', () => {
  it('accepts g: prefixes and "sale price" headers', () => {
    const body = [
      'g:id\tTitle\tLink\tsale price\tg:price\tavailability',
      'A-1\tKettle\thttps://shop.example/p/kettle\t30.00 USD\t39.00 USD\tin stock',
    ].join('\n');
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings, [
      {
        surface: 'feed',
        scope: 'variant',
        ids: { aliases: ['A-1'], url: 'https://shop.example/p/kettle' },
        title: 'Kettle',
        price: observation({ units: 300000, currency: 'USD' }, '30.00 USD', at('A-1', 'sale_price')),
        listPrice: observation({ units: 390000, currency: 'USD' }, '39.00 USD', at('A-1', 'price')),
        availability: observation('in_stock', 'in stock', at('A-1', 'availability')),
      },
    ]);
  });

  it('keeps a quoted cell that contains a tab, with doubled quotes inside', () => {
    const body = [
      'id\ttitle\tlink\tprice',
      'B-1\t"Tea\tBlend ""Gold"""\thttps://shop.example/p/tea\t8.00 USD',
      'B-2\t"Line one\nLine two"\thttps://shop.example/p/two\t8.00 USD',
    ].join('\n');
    const [tea, two] = parseFeed(body, FEED_URL, FETCHED_AT, NOW).sightings;
    assert.equal(tea?.title, 'Tea\tBlend "Gold"');
    assert.equal(tea?.ids.url, 'https://shop.example/p/tea');
    assert.equal(two?.title, 'Line one\nLine two');
  });

  it('reads the shipping cell in country:region:service:price form', () => {
    const body = [
      'id\tlink\tprice\tshipping',
      'C-1\thttps://shop.example/p/c\t20.00 USD\tUS::Standard:6.20 USD, CA::Express:14.00 CAD',
      'C-2\thttps://shop.example/p/d\t20.00 USD\t::Free:0.00 USD',
    ].join('\n');
    const [first, second] = parseFeed(body, FEED_URL, FETCHED_AT, NOW).sightings;
    assert.deepStrictEqual(
      first?.shipping,
      observation({ free: false, cost: { units: 62000, currency: 'USD' }, country: 'US' }, 'US::Standard:6.20 USD', at('C-1', 'shipping')),
    );
    assert.deepStrictEqual(
      second?.shipping,
      observation({ free: true, cost: { units: 0, currency: 'USD' } }, '::Free:0.00 USD', at('C-2', 'shipping')),
    );
  });

  it('leaves missing cells empty on a short row', () => {
    const body = ['id\ttitle\tlink\tprice', 'E-1\tShort\thttps://shop.example/p/short'].join('\n');
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings, [
      {
        surface: 'feed',
        scope: 'variant',
        ids: { aliases: ['E-1'], url: 'https://shop.example/p/short' },
        title: 'Short',
      },
    ]);
  });

  it('skips empty lines and accepts CRLF line endings', () => {
    const body = 'id\tlink\tprice\r\n\r\nF-1\thttps://shop.example/p/f\t1.00 USD\r\n\r\n';
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(
      result.sightings.map((s) => s.ids.aliases),
      [['F-1']],
    );
  });

  it('ignores a byte order mark at the start', () => {
    const body = '﻿id\tlink\tprice\nG-1\thttps://shop.example/p/g\t3.00 USD';
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings[0]?.ids.aliases, ['G-1']);
    assert.deepStrictEqual(
      result.sightings[0]?.price,
      observation({ units: 30000, currency: 'USD' }, '3.00 USD', at('G-1', 'price')),
    );
  });

  it('reports a row without an id as incomplete', () => {
    const body = ['id\tlink\tprice', '\thttps://shop.example/p/h\t3.00 USD'].join('\n');
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.sightings, []);
    assert.equal(result.issues[0]?.code, 'feed-item-incomplete');
  });

  it('preserves a leading empty header column without shifting item fields', () => {
    const body = '\tid\tlink\tprice\n\tA-1\thttps://shop.example/p/a\t3.00 USD';
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepEqual(result.issues, []);
    assert.equal(result.sightings[0]?.ids.aliases?.[0], 'A-1');
    assert.equal(result.sightings[0]?.price?.value.units, 30000);
  });

  it('reports plain error text and malformed quotes instead of an empty success', () => {
    for (const body of ['Service unavailable', 'id\tlink\ttitle\nA-1\thttps://shop.example/p/a\t"unclosed']) {
      const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
      assert.deepEqual(result.sightings, []);
      assert.equal(result.issues[0]?.code, 'parse-error');
    }
  });
});
