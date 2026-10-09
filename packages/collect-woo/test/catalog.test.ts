import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sighting } from '@regmark/core';
import { collectWooCatalog } from '../src/index.ts';
import { API_BASE, ORIGIN, createFakeShop, defaultCatalog, generatedProducts, makeContext, obs, usd } from './fake-store.ts';

const LIST = `${API_BASE}/products?per_page=100&page=1`;
const PAGE_2 = `${API_BASE}/products?per_page=100&page=2`;

function at(sightings: Sighting[], variantId: string): Sighting {
  const found = sightings.find((s) => s.ids.variantId === variantId);
  assert.ok(found, `no sighting for variant ${variantId}`);
  return found;
}

test('simple and variable products yield sightings in list order, one request per variation', async () => {
  const shop = createFakeShop();
  const result = await collectWooCatalog(makeContext(shop));

  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    shop.calls.map((c) => c.url),
    [LIST, `${API_BASE}/products/101`, `${API_BASE}/products/102`, `${API_BASE}/products/103`, `${API_BASE}/products/401`],
  );
  assert.deepEqual(
    result.sightings.map((s) => s.ids.variantId),
    ['101', '102', '103', '200', '300', '401', '500'],
  );
  assert.deepEqual(
    result.parents.map((p) => p.id),
    [100, 200, 300, 400, 500],
  );
});

test('selection can use the full listing without a second catalogue fetch', async () => {
  const shop = createFakeShop();
  const result = await collectWooCatalog(makeContext(shop), {
    select(parent, parents) {
      assert.deepEqual(parents.map((p) => p.id), [100, 200, 300, 400, 500]);
      return parent.id === parents.find((p) => p.variationIds.length === 1)?.id;
    },
  });

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings.map((s) => s.ids.variantId), ['401']);
  assert.deepEqual(shop.calls.map((c) => c.url), [LIST, `${API_BASE}/products/401`]);
});

test('a variation sighting has exact ids, the parent url, options and listPrice only when on sale', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop()));
  const tee = at(result.sightings, '101');

  assert.deepEqual(tee, {
    surface: 'platform',
    scope: 'variant',
    ids: {
      productId: '100',
      variantId: '101',
      sku: 'TEE-BLU-S',
      url: `${ORIGIN}/product/classic-tee/`,
      options: { Size: 's' },
    },
    title: 'Classic Tee',
    price: obs(usd(390000), '3900', `${API_BASE}/products/101#/prices/price`),
    listPrice: obs(usd(450000), '4500', `${API_BASE}/products/101#/prices/regular_price`),
    availability: obs('in_stock', 'true', `${API_BASE}/products/101#/is_in_stock`),
  });

  const medium = at(result.sightings, '102');
  assert.equal(medium.listPrice, undefined, 'not on sale, so no list price');
  assert.deepEqual(medium.ids.options, { Size: 'm' });
});

test('an out-of-stock variation reads as out_of_stock with the raw flag', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop()));
  const large = at(result.sightings, '103');
  assert.deepEqual(large.availability, obs('out_of_stock', 'false', `${API_BASE}/products/103#/is_in_stock`));
});

test('a simple product is read from the list response with list pointers', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop()));

  assert.deepEqual(at(result.sightings, '200'), {
    surface: 'platform',
    scope: 'variant',
    ids: { productId: '200', variantId: '200', sku: 'MUG-1', url: `${ORIGIN}/product/enamel-mug/` },
    title: 'Enamel Mug',
    price: obs(usd(120000), '1200', `${LIST}#/1/prices/price`),
    listPrice: obs(usd(150000), '1500', `${LIST}#/1/prices/regular_price`),
    availability: obs('in_stock', 'true', `${LIST}#/1/is_in_stock`),
  });
});

test('backorder is reported as backorder even though the item is not in stock', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop()));
  const hoodie = at(result.sightings, '300');
  assert.deepEqual(hoodie.availability, obs('backorder', 'true', `${LIST}#/2/is_on_backorder`));
  assert.equal(hoodie.listPrice, undefined);
});

test('a variation takes its attributes from the parent entry and omits options when there are none', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop()));
  const tote = at(result.sightings, '401');
  assert.deepEqual(tote.ids.options, { Color: 'natural' });
  assert.equal(tote.ids.productId, '400');
  assert.equal(tote.ids.url, `${ORIGIN}/product/canvas-tote/`);
  assert.equal(at(result.sightings, '200').ids.options, undefined);
});

test('pages through the list until a short page, and stops there', async () => {
  const shop = createFakeShop({ catalog: { products: generatedProducts(103), details: [] } });
  const result = await collectWooCatalog(makeContext(shop));

  assert.deepEqual(
    shop.calls.map((c) => c.url),
    [LIST, PAGE_2],
  );
  assert.equal(result.parents.length, 103);
  assert.equal(result.sightings.length, 103);
  assert.equal(result.sightings[100]?.ids.productId, '1100');
});

test('stops at the x-wp-totalpages header even when the page is full', async () => {
  const shop = createFakeShop({ catalog: { products: generatedProducts(100), details: [] }, listTotalPages: '1' });
  await collectWooCatalog(makeContext(shop));
  assert.equal(shop.calls.filter((c) => c.path === '/products').length, 1);
});

test('stops after 50 pages when every page is full and the header is not a number', async () => {
  const shop = createFakeShop({
    catalog: { products: generatedProducts(6000), details: [] },
    listTotalPages: 'many',
  });
  const result = await collectWooCatalog(makeContext(shop), { maxProducts: 10000 });

  assert.equal(shop.calls.filter((c) => c.path === '/products').length, 50);
  assert.equal(result.parents.length, 5000);
});

test('maxProducts caps the listing', async () => {
  const shop = createFakeShop({ catalog: { products: generatedProducts(250), details: [] } });
  const result = await collectWooCatalog(makeContext(shop), { maxProducts: 150 });

  assert.equal(shop.calls.filter((c) => c.path === '/products').length, 2);
  assert.equal(result.parents.length, 150);
  assert.equal(result.sightings.length, 150);
});

test('select skipping a parent makes no request for its variations, and parents still lists it', async () => {
  const shop = createFakeShop();
  const result = await collectWooCatalog(makeContext(shop), { select: (parent) => parent.id !== 100 });

  assert.deepEqual(
    shop.calls.map((c) => c.url),
    [LIST, `${API_BASE}/products/401`],
  );
  assert.deepEqual(
    result.sightings.map((s) => s.ids.variantId),
    ['200', '300', '401', '500'],
  );
  assert.ok(result.parents.some((p) => p.id === 100));
});

test('a variation that fails to load is an issue, and the others still come through', async () => {
  const shop = createFakeShop({ fail: { '/products/102': 500 } });
  const result = await collectWooCatalog(makeContext(shop));

  assert.deepEqual(result.issues, [
    { surface: 'platform', code: 'fetch-failed', message: 'HTTP 500', locator: `${API_BASE}/products/102` },
  ]);
  assert.deepEqual(
    result.sightings.map((s) => s.ids.variantId),
    ['101', '103', '200', '300', '401', '500'],
  );
});

test('a failing first list request returns only that issue', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop({ fail: { '/products': 500 } })));
  assert.deepEqual(result, {
    sightings: [],
    issues: [{ surface: 'platform', code: 'fetch-failed', message: 'HTTP 500', locator: LIST }],
    parents: [],
  });
});

test('a robots refusal is reported as robots-disallowed', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop({ robots: ['/products/102'] })));
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.code, 'robots-disallowed');
  assert.equal(result.issues[0]?.locator, `${API_BASE}/products/102`);
  assert.equal(result.sightings.some((s) => s.ids.variantId === '102'), false);
});

test('a list that is not JSON is a parse-error with no parents', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop({ nonJson: ['/products'] })));
  assert.deepEqual(result, {
    sightings: [],
    issues: [{ surface: 'platform', code: 'parse-error', message: 'response is not JSON', locator: LIST }],
    parents: [],
  });
});

test('a variation that is not JSON is a parse-error, and the rest still come through', async () => {
  const result = await collectWooCatalog(makeContext(createFakeShop({ nonJson: ['/products/101'] })));
  assert.deepEqual(result.issues, [
    { surface: 'platform', code: 'parse-error', message: 'response is not JSON', locator: `${API_BASE}/products/101` },
  ]);
  assert.equal(result.sightings.some((s) => s.ids.variantId === '101'), false);
  assert.ok(result.sightings.some((s) => s.ids.variantId === '102'));
});

test('garbage prices give a sighting without a price, not a crash', async () => {
  const catalog = defaultCatalog();
  const mug = catalog.products[1];
  assert.ok(mug);
  mug.prices = 'garbage';
  const result = await collectWooCatalog(makeContext(createFakeShop({ catalog })));

  const sighting = at(result.sightings, '200');
  assert.equal(sighting.ids.sku, 'MUG-1');
  assert.equal(sighting.price, undefined);
  assert.equal(sighting.listPrice, undefined);
  assert.deepEqual(sighting.availability, obs('in_stock', 'true', `${LIST}#/1/is_in_stock`));
  assert.deepEqual(result.issues, []);
});
