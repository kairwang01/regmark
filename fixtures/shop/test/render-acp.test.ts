import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShop } from '../src/shop.ts';
import { renderAcpFeed } from '../src/render-acp.ts';

const NOW = new Date('2026-10-09T00:00:00Z');

const clean = buildShop('clean', NOW);
const misprint = buildShop('misprint', NOW);

/** Every record of the JSON Lines feed, in order. */
function records(feed: string): Record<string, unknown>[] {
  assert.ok(feed.endsWith('\n'));
  return feed
    .slice(0, -1)
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function recordFor(feed: string, id: string): Record<string, unknown> {
  const hit = records(feed).find((r) => r.item_id === id);
  assert.ok(hit, `record ${id}`);
  return hit;
}

test('clean ACP feed: one record per line, one line per variant, and no ghost', () => {
  const list = records(renderAcpFeed(clean, 'http://shop.test'));
  assert.equal(list.length, 19);
  assert.equal(records(renderAcpFeed(misprint, 'http://shop.test')).some((r) => r.item_id === 'GHOST-01'), false);
});

test('clean ACP feed: TEE-BLU-M in OpenAI format, a variant of its group, on sale', () => {
  assert.deepEqual(recordFor(renderAcpFeed(clean, 'http://shop.test'), 'TEE-BLU-M'), {
    item_id: 'TEE-BLU-M',
    group_id: 'classic-tee',
    listing_has_variations: true,
    variant_dict: { size: 'M' },
    title: 'Classic Tee - M',
    description: 'A midweight cotton tee, cut straight and washed once before it ships.',
    url: 'http://shop.test/product/classic-tee/?attribute_pa_size=m',
    brand: 'Northfold',
    seller_name: 'Northfold',
    image_url: 'http://shop.test/images/classic-tee.jpg',
    price: '45.00 USD',
    sale_price: '39.00 USD',
    availability: 'in_stock',
    gtin: clean.products.find((p) => p.slug === 'classic-tee')!.acp[1]!.gtin,
    mpn: 'NF-TEE-BLU-M',
    shipping_price: '6.20 USD',
  });
});

test('clean ACP feed: a single-variant product is not a group, and the shell ships free', () => {
  const feed = renderAcpFeed(clean, 'http://shop.test');
  const mug = recordFor(feed, 'MUG-WHT');
  assert.equal('group_id' in mug, false);
  assert.equal('variant_dict' in mug, false);
  assert.equal(mug.url, 'http://shop.test/product/enamel-mug/');
  assert.equal(recordFor(feed, 'SHELL-M').shipping_price, '0.00 USD');
  assert.equal(recordFor(feed, 'BEANIE-NVY').availability, 'out_of_stock');
});

test('clean ACP feed: like the Google feed, it states no return policy', () => {
  assert.ok(records(renderAcpFeed(clean, 'http://shop.test')).every((r) => !('accepts_returns' in r)));
});

test('a return policy, when the shop data has one, is written in the spec fields', () => {
  const hand = structuredClone(clean);
  hand.products.find((p) => p.slug === 'enamel-mug')!.acp[0]!.returnDays = 30;
  const mug = recordFor(renderAcpFeed(hand, 'http://shop.test'), 'MUG-WHT');
  assert.equal(mug.accepts_returns, true);
  assert.equal(mug.return_deadline_in_days, 30);
  assert.equal(mug.return_policy, 'http://shop.test/returns/');
});

test('D21: the ACP feed still has the old price for SOCK-M, and the right one for its siblings', () => {
  const feed = renderAcpFeed(misprint, 'http://shop.test');
  assert.equal(recordFor(feed, 'SOCK-M').price, '10.00 USD');
  assert.equal(recordFor(feed, 'SOCK-S').price, '12.00 USD');
});

test('D22: the ACP feed lists BEANIE-NVY as in stock', () => {
  assert.equal(recordFor(renderAcpFeed(misprint, 'http://shop.test'), 'BEANIE-NVY').availability, 'in_stock');
});

test('D11: the mug ACP record has no shipping price', () => {
  assert.equal('shipping_price' in recordFor(renderAcpFeed(misprint, 'http://shop.test'), 'MUG-WHT'), false);
});

test('the Google feed defects do not reach the ACP feed', () => {
  const feed = renderAcpFeed(misprint, 'http://shop.test');
  assert.equal(recordFor(feed, 'TOTE-NAT').price, '24.00 USD');
  assert.equal(recordFor(feed, 'TEE-BLU-S').shipping_price, '6.20 USD');
  assert.notEqual(recordFor(feed, 'CAP-RED').gtin, recordFor(feed, 'CAP-BLK').gtin);
});

test('shop text is JSON-escaped, one record to a line', () => {
  const hand = structuredClone(clean);
  hand.products.find((p) => p.slug === 'enamel-mug')!.title = 'Mug "white"\nline two';
  const feed = renderAcpFeed(hand, 'http://shop.test');
  assert.equal(feed.split('\n').length, 20);
  assert.equal(recordFor(feed, 'MUG-WHT').title, 'Mug "white"\nline two');
});
