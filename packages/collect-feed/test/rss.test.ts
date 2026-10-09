import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFeed } from '../src/index.ts';
import { FEED_URL, FETCHED_AT, NOW, at, observation, rss } from './support.ts';

const TWO_ITEMS = rss(`
<item>
  <g:id>SKU-1</g:id>
  <title>Linen Shirt</title>
  <link>https://shop.example/p/linen-shirt?variant=1</link>
  <g:gtin>0012345678905</g:gtin>
  <g:mpn>LS-1</g:mpn>
  <g:brand>Acme</g:brand>
  <g:item_group_id>LS</g:item_group_id>
  <g:price>39.00 USD</g:price>
  <g:availability>in stock</g:availability>
  <g:color>Blue</g:color>
  <g:size>M</g:size>
  <g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>6.20 USD</g:price></g:shipping>
</item>
<item>
  <g:id>SKU-2</g:id>
  <title>Wool Cap</title>
  <link>/p/wool-cap</link>
  <g:price>25.50 USD</g:price>
  <g:availability>out_of_stock</g:availability>
</item>`);

describe('RSS 2.0', () => {
  it('maps every field of two items', () => {
    const result = parseFeed(TWO_ITEMS, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings, [
      {
        surface: 'feed',
        scope: 'variant',
        ids: {
          aliases: ['SKU-1'],
          url: 'https://shop.example/p/linen-shirt?variant=1',
          gtin: '0012345678905',
          mpn: 'LS-1',
          brand: 'Acme',
          groupId: 'LS',
          options: { color: 'Blue', size: 'M' },
        },
        title: 'Linen Shirt',
        price: observation({ units: 390000, currency: 'USD' }, '39.00 USD', at('SKU-1', 'price')),
        availability: observation('in_stock', 'in stock', at('SKU-1', 'availability')),
        shipping: observation(
          { free: false, cost: { units: 62000, currency: 'USD' }, country: 'US' },
          '6.20 USD',
          at('SKU-1', 'shipping'),
        ),
      },
      {
        surface: 'feed',
        scope: 'variant',
        ids: { aliases: ['SKU-2'], url: 'https://shop.example/p/wool-cap' },
        title: 'Wool Cap',
        price: observation({ units: 255000, currency: 'USD' }, '25.50 USD', at('SKU-2', 'price')),
        availability: observation('out_of_stock', 'out_of_stock', at('SKU-2', 'availability')),
      },
    ]);
  });

  it('keeps leading zeros in gtin and id as strings', () => {
    const body = rss(`<item>
      <g:id>0042</g:id><title>Zero</title><link>https://shop.example/p/zero</link>
      <g:gtin>0012345678905</g:gtin><g:price>1.00 USD</g:price>
    </item>`);
    const [sighting] = parseFeed(body, FEED_URL, FETCHED_AT, NOW).sightings;
    assert.equal(sighting?.ids.gtin, '0012345678905');
    assert.deepStrictEqual(sighting?.ids.aliases, ['0042']);
  });

  it('reads CDATA title and link as plain text', () => {
    const body = rss(`<item>
      <g:id>T-1</g:id>
      <title><![CDATA[Tea & Honey <Blend>]]></title>
      <link><![CDATA[https://shop.example/p/tea?a=1&b=2]]></link>
      <g:price>8.00 USD</g:price>
    </item>`);
    const [sighting] = parseFeed(body, FEED_URL, FETCHED_AT, NOW).sightings;
    assert.equal(sighting?.title, 'Tea & Honey <Blend>');
    assert.equal(sighting?.ids.url, 'https://shop.example/p/tea?a=1&b=2');
  });

  it('takes the first non-empty value when title and g:title both appear', () => {
    const body = rss(`<item>
      <g:id>M-1</g:id>
      <title>Shop Tea</title>
      <g:title>Tea, 250g</g:title>
      <g:link>https://shop.example/p/a</g:link>
      <link>https://shop.example/p/b</link>
      <g:price>8.00 USD</g:price>
    </item>
    <item>
      <g:id>M-2</g:id>
      <g:title></g:title>
      <title>Real Title</title>
      <link>https://shop.example/p/c</link>
      <g:price>8.00 USD</g:price>
    </item>`);
    const [first, second] = parseFeed(body, FEED_URL, FETCHED_AT, NOW).sightings;
    assert.equal(first?.title, 'Shop Tea');
    assert.equal(first?.ids.url, 'https://shop.example/p/a');
    assert.equal(second?.title, 'Real Title');
  });

  it('handles a single item that is not wrapped in an array', () => {
    const body = rss(`<item>
      <g:id>ONE</g:id><title>Only</title><link>https://shop.example/p/only</link>
      <g:price>5.00 USD</g:price>
    </item>`);
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings.length, 1);
    assert.deepStrictEqual(result.sightings[0]?.ids.aliases, ['ONE']);
  });

  it('accepts a byte order mark and leading whitespace before the declaration', () => {
    const result = parseFeed(`﻿ \n${TWO_ITEMS}`, FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings.length, 2);
    assert.deepStrictEqual(result.issues, []);
  });

  it('returns no sightings for an empty channel', () => {
    const result = parseFeed(rss(''), FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result, { sightings: [], issues: [] });
  });
});
