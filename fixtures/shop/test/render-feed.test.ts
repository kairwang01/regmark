import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShop } from '../src/shop.ts';
import { renderFeed } from '../src/render-feed.ts';

const NOW = new Date('2026-10-09T00:00:00Z');

const clean = buildShop('clean', NOW);
const misprint = buildShop('misprint', NOW);

/** The inner text of every <item>, in feed order. */
function items(feed: string): string[] {
  return feed
    .split('<item>')
    .slice(1)
    .map((s) => s.split('</item>')[0]!);
}

function itemFor(feed: string, id: string): string {
  const hit = items(feed).find((i) => i.includes(`<g:id>${id}</g:id>`));
  assert.ok(hit, `item ${id}`);
  return hit;
}

test('clean feed: header and item count', () => {
  const feed = renderFeed(clean, 'http://shop.test');
  assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(feed.includes('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">'));
  assert.ok(feed.includes('<link>http://shop.test/</link>'));
  assert.equal(items(feed).length, 19);
});

test('clean feed: TEE-BLU-M is on sale with a dated window and a flat shipping rate', () => {
  const item = itemFor(renderFeed(clean, 'http://shop.test'), 'TEE-BLU-M');
  assert.ok(item.includes('<g:title>Classic Tee - M</g:title>'));
  assert.ok(item.includes('<g:link>http://shop.test/product/classic-tee/?attribute_pa_size=m</g:link>'));
  assert.ok(item.includes('<g:price>45.00 USD</g:price>'));
  assert.ok(item.includes('<g:sale_price>39.00 USD</g:sale_price>'));
  assert.ok(item.includes('<g:sale_price_effective_date>2026-10-02T00:00:00Z/2026-12-08T23:59:59Z</g:sale_price_effective_date>'));
  assert.ok(item.includes('<g:availability>in_stock</g:availability>'));
  assert.ok(item.includes('<g:condition>new</g:condition>'));
  assert.match(item, /<g:gtin>\d{13}<\/g:gtin>/);
  assert.ok(item.includes('<g:mpn>NF-TEE-BLU-M</g:mpn>'));
  assert.ok(item.includes('<g:brand>Northfold</g:brand>'));
  assert.ok(item.includes('<g:item_group_id>classic-tee</g:item_group_id>'));
  assert.ok(item.includes('<g:size>M</g:size>'));
  assert.ok(item.includes('<g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>6.20 USD</g:price></g:shipping>'));
});

test('clean feed: a single-product item has no group id and no option elements', () => {
  const item = itemFor(renderFeed(clean, 'http://shop.test'), 'MUG-WHT');
  assert.equal(item.includes('<g:item_group_id>'), false);
  assert.equal(item.includes('<g:size>'), false);
  assert.equal(item.includes('<g:color>'), false);
  assert.ok(item.includes('<g:price>16.00 USD</g:price>'));
  assert.ok(item.includes('<g:link>http://shop.test/product/enamel-mug/</g:link>'));
});

test('clean feed: out-of-stock beanie and free shipping on the shell', () => {
  const feed = renderFeed(clean, 'http://shop.test');
  assert.ok(itemFor(feed, 'BEANIE-NVY').includes('<g:availability>out_of_stock</g:availability>'));
  const shell = itemFor(feed, 'SHELL-M');
  assert.ok(shell.includes('<g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>0.00 USD</g:price></g:shipping>'));
  assert.ok(shell.includes('<g:price>159.00 USD</g:price>'));
  assert.ok(shell.includes('<g:sale_price>129.00 USD</g:sale_price>'));
});

test('misprint feed: 20 items, the ghost last and linking to its gone page', () => {
  const list = items(renderFeed(misprint, 'http://shop.test'));
  assert.equal(list.length, 20);
  const last = list[list.length - 1]!;
  assert.ok(last.includes('<g:id>GHOST-01</g:id>'));
  assert.ok(last.includes('<g:link>http://shop.test/product/discontinued-scarf/</g:link>'));
  assert.ok(last.includes('<g:price>42.00 USD</g:price>'));
  assert.ok(last.includes('<g:brand>Northfold</g:brand>'));
  assert.ok(last.includes('<g:gtin>4006381999908</g:gtin>'));
});

test('D02: the feed still has last week’s price for TOTE-NAT', () => {
  assert.ok(itemFor(renderFeed(misprint, 'http://shop.test'), 'TOTE-NAT').includes('<g:price>22.00 USD</g:price>'));
});

test('D04: the feed lists BEANIE-NVY as in stock', () => {
  assert.ok(itemFor(renderFeed(misprint, 'http://shop.test'), 'BEANIE-NVY').includes('<g:availability>in_stock</g:availability>'));
});

test('D10: the feed promises free shipping on TEE-BLU-S', () => {
  assert.ok(itemFor(renderFeed(misprint, 'http://shop.test'), 'TEE-BLU-S').includes('<g:price>0.00 USD</g:price>'));
});

test('D11: the mug feed item has no shipping element', () => {
  assert.equal(itemFor(renderFeed(misprint, 'http://shop.test'), 'MUG-WHT').includes('<g:shipping>'), false);
});

test('D12: both caps carry the same GTIN', () => {
  const feed = renderFeed(misprint, 'http://shop.test');
  const gtin = (id: string) => itemFor(feed, id).match(/<g:gtin>(\d+)<\/g:gtin>/)![1];
  assert.equal(gtin('CAP-RED'), gtin('CAP-BLK'));
  assert.equal(gtin('CAP-RED'), buildShop('clean', NOW).products.find((p) => p.slug === 'field-cap')!.feed[0]!.gtin);
});

test('text content is XML-escaped', () => {
  const hand = structuredClone(clean);
  hand.products.find((p) => p.slug === 'enamel-mug')!.feed[0]!.sku = 'A&B<C>';
  const feed = renderFeed(hand, 'http://shop.test');
  assert.ok(feed.includes('<g:id>A&amp;B&lt;C&gt;</g:id>'));
});
