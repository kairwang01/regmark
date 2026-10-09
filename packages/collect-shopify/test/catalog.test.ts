import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FetchRefused } from '@regmark/core';
import { collectShopifyCatalog } from '../src/index.ts';
import { FETCHED_AT, ORIGIN, catalogUrl, fakeShop, pageBody, plainProduct } from './fake-shop.ts';

const PAGE1 = catalogUrl(1);

const TEE = {
  id: 6789,
  title: 'Classic Tee',
  handle: 'classic-tee',
  vendor: 'Northfold',
  options: [
    { name: 'Size', position: 1, values: ['S', 'M'] },
    { name: 'Color', position: 2, values: ['Blue'] },
  ],
  variants: [
    {
      id: 40001,
      title: 'S / Blue',
      option1: 'S',
      option2: 'Blue',
      option3: null,
      sku: 'TEE-BLU-S',
      price: '39.00',
      compare_at_price: '45.00',
      available: true,
      product_id: 6789,
    },
    {
      id: 40002,
      title: 'M / Blue',
      option1: 'M',
      option2: 'Blue',
      option3: null,
      sku: 'TEE-BLU-M',
      price: '39.00',
      compare_at_price: null,
      available: false,
      product_id: 6789,
    },
  ],
};

const TOTE = {
  id: 7001,
  title: 'Tote Bag',
  handle: 'tote-bag',
  vendor: '',
  options: [{ name: 'Title', position: 1, values: ['Default Title'] }],
  variants: [
    {
      id: 50001,
      title: 'Default Title',
      option1: 'Default Title',
      option2: null,
      option3: null,
      sku: 'TOTE-1',
      price: '12.5',
      compare_at_price: '12.50',
      available: true,
      product_id: 7001,
    },
  ],
};

describe('collectShopifyCatalog: sightings', () => {
  it('turns each variant into a platform sighting with exact ids, options, prices and locators', async () => {
    const { ctx, calls } = fakeShop({ [PAGE1]: { body: pageBody([TEE, TOTE]) } });
    const result = await collectShopifyCatalog(ctx);

    assert.deepEqual(calls, [PAGE1]);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.parents, [
      { id: 6789, handle: 'classic-tee', url: `${ORIGIN}/products/classic-tee`, variantCount: 2 },
      { id: 7001, handle: 'tote-bag', url: `${ORIGIN}/products/tote-bag`, variantCount: 1 },
    ]);

    const base = `${PAGE1}#/products/0/variants`;
    assert.deepEqual(result.sightings, [
      {
        surface: 'platform',
        scope: 'variant',
        title: 'Classic Tee',
        ids: {
          productId: '6789',
          variantId: '40001',
          sku: 'TEE-BLU-S',
          brand: 'Northfold',
          url: `${ORIGIN}/products/classic-tee`,
          options: { Size: 'S', Color: 'Blue' },
        },
        price: {
          value: { units: 390000, currency: null },
          raw: '39.00',
          surface: 'platform',
          locator: `${base}/0/price`,
          fetchedAt: FETCHED_AT,
        },
        listPrice: {
          value: { units: 450000, currency: null },
          raw: '45.00',
          surface: 'platform',
          locator: `${base}/0/compare_at_price`,
          fetchedAt: FETCHED_AT,
        },
        availability: {
          value: 'in_stock',
          raw: 'true',
          surface: 'platform',
          locator: `${base}/0/available`,
          fetchedAt: FETCHED_AT,
        },
      },
      {
        surface: 'platform',
        scope: 'variant',
        title: 'Classic Tee',
        ids: {
          productId: '6789',
          variantId: '40002',
          sku: 'TEE-BLU-M',
          brand: 'Northfold',
          url: `${ORIGIN}/products/classic-tee`,
          options: { Size: 'M', Color: 'Blue' },
        },
        price: {
          value: { units: 390000, currency: null },
          raw: '39.00',
          surface: 'platform',
          locator: `${base}/1/price`,
          fetchedAt: FETCHED_AT,
        },
        availability: {
          value: 'out_of_stock',
          raw: 'false',
          surface: 'platform',
          locator: `${base}/1/available`,
          fetchedAt: FETCHED_AT,
        },
      },
      {
        surface: 'platform',
        scope: 'variant',
        title: 'Tote Bag',
        ids: {
          productId: '7001',
          variantId: '50001',
          sku: 'TOTE-1',
          url: `${ORIGIN}/products/tote-bag`,
        },
        price: {
          value: { units: 125000, currency: null },
          raw: '12.5',
          surface: 'platform',
          locator: `${PAGE1}#/products/1/variants/0/price`,
          fetchedAt: FETCHED_AT,
        },
        availability: {
          value: 'in_stock',
          raw: 'true',
          surface: 'platform',
          locator: `${PAGE1}#/products/1/variants/0/available`,
          fetchedAt: FETCHED_AT,
        },
      },
    ]);
  });

  it('applies the currency the caller passes to every price', async () => {
    const { ctx } = fakeShop({ [PAGE1]: { body: pageBody([TEE]) } });
    const result = await collectShopifyCatalog(ctx, { currency: 'USD' });
    assert.equal(result.sightings[0]!.price!.value.currency, 'USD');
    assert.equal(result.sightings[0]!.listPrice!.value.currency, 'USD');
  });

  it('reports a list price only when compare_at_price is strictly greater than the price', async () => {
    const variant = (id: number, compare: unknown) => ({
      id,
      option1: null,
      option2: null,
      option3: null,
      price: '39.00',
      compare_at_price: compare,
      available: true,
    });
    const product = {
      id: 1,
      handle: 'p',
      title: 'P',
      variants: [variant(1, '39.00'), variant(2, '10'), variant(3, null), variant(4, 'call us'), variant(5, '40')],
    };
    const { ctx } = fakeShop({ [PAGE1]: { body: pageBody([product]) } });
    const result = await collectShopifyCatalog(ctx);
    const listed = result.sightings.map((s) => s.listPrice?.value.units);
    assert.deepEqual(listed, [undefined, undefined, undefined, undefined, 400000]);
    assert.equal(result.sightings[4]!.listPrice!.locator, `${PAGE1}#/products/0/variants/4/compare_at_price`);
  });

  it('omits availability when available is missing or not a boolean', async () => {
    const product = {
      id: 1,
      handle: 'p',
      title: 'P',
      variants: [
        { id: 1, price: '5.00' },
        { id: 2, price: '5.00', available: 'true' },
      ],
    };
    const { ctx } = fakeShop({ [PAGE1]: { body: pageBody([product]) } });
    const result = await collectShopifyCatalog(ctx);
    assert.equal(result.sightings.length, 2);
    for (const s of result.sightings) assert.equal(s.availability, undefined);
  });

  it('keeps the sighting but omits the price when the price is garbage', async () => {
    const product = {
      id: 1,
      handle: 'p',
      title: 'P',
      variants: [{ id: 1, sku: 'A', price: 'free', compare_at_price: '50.00', available: true }],
    };
    const { ctx, logs } = fakeShop({ [PAGE1]: { body: pageBody([product]) } });
    const result = await collectShopifyCatalog(ctx);
    assert.equal(result.sightings.length, 1);
    assert.equal(result.sightings[0]!.price, undefined);
    assert.equal(result.sightings[0]!.listPrice, undefined);
    assert.equal(result.sightings[0]!.ids.sku, 'A');
    assert.deepEqual(result.issues, []);
    assert.deepEqual(logs, []);
  });

  it('produces no sightings for a product the select callback rejects, but still lists it', async () => {
    const { ctx } = fakeShop({ [PAGE1]: { body: pageBody([TEE, TOTE]) } });
    const result = await collectShopifyCatalog(ctx, { select: (parent) => parent.id !== 6789 });
    assert.deepEqual(
      result.sightings.map((s) => s.ids.productId),
      ['7001'],
    );
    assert.deepEqual(
      result.parents.map((p) => p.id),
      [6789, 7001],
    );
  });

  it('treats a select callback that throws as a rejection', async () => {
    const { ctx, logs } = fakeShop({ [PAGE1]: { body: pageBody([TOTE]) } });
    const result = await collectShopifyCatalog(ctx, {
      select: () => {
        throw new Error('bad filter');
      },
    });
    assert.equal(result.sightings.length, 0);
    assert.equal(result.parents.length, 1);
    assert.equal(logs.length, 1);
  });
});

describe('collectShopifyCatalog: paging', () => {
  it('pages until a short page, with maxProducts 1000: two requests and 253 parents', async () => {
    const first = Array.from({ length: 250 }, (_, i) => plainProduct(i + 1));
    const second = Array.from({ length: 3 }, (_, i) => plainProduct(251 + i));
    const { ctx, calls } = fakeShop({
      [catalogUrl(1)]: { body: pageBody(first) },
      [catalogUrl(2)]: { body: pageBody(second) },
    });
    const result = await collectShopifyCatalog(ctx, { maxProducts: 1000 });
    assert.deepEqual(calls, [
      `${ORIGIN}/products.json?limit=250&page=1`,
      `${ORIGIN}/products.json?limit=250&page=2`,
    ]);
    assert.equal(result.parents.length, 253);
    assert.equal(result.sightings.length, 253);
    assert.deepEqual(result.issues, []);
  });

  it('stops after one page with the default maxProducts when the first page is full', async () => {
    const first = Array.from({ length: 250 }, (_, i) => plainProduct(i + 1));
    const { ctx, calls } = fakeShop({
      [catalogUrl(1)]: { body: pageBody(first) },
      [catalogUrl(2)]: { body: pageBody([plainProduct(999)]) },
    });
    const result = await collectShopifyCatalog(ctx);
    assert.deepEqual(calls, [PAGE1]);
    assert.equal(result.parents.length, 250);
  });

  it('cuts the listing to maxProducts and emits sightings only for the kept products', async () => {
    const { ctx, calls } = fakeShop({ [PAGE1]: { body: pageBody([plainProduct(1), plainProduct(2), plainProduct(3), plainProduct(4), plainProduct(5)]) } });
    const result = await collectShopifyCatalog(ctx, { maxProducts: 2 });
    assert.deepEqual(calls, [PAGE1]);
    assert.deepEqual(
      result.parents.map((p) => p.id),
      [1, 2],
    );
    assert.deepEqual(
      result.sightings.map((s) => s.ids.productId),
      ['1', '2'],
    );
  });

  it('stops at the 20-page hard limit even when every page is full', async () => {
    const full = pageBody(Array.from({ length: 250 }, (_, i) => plainProduct(i + 1)));
    const answers: Record<string, { body: string }> = {};
    for (let page = 1; page <= 25; page++) answers[catalogUrl(page)] = { body: full };
    const { ctx, calls } = fakeShop(answers);
    const result = await collectShopifyCatalog(ctx, { maxProducts: 100000 });
    assert.equal(calls.length, 20);
    assert.equal(result.parents.length, 5000);
  });
});

describe('collectShopifyCatalog: failures', () => {
  const cases: [string, { status?: number; body?: string; throws?: Error }, string, string][] = [
    ['a robots refusal', { throws: new FetchRefused('robots', PAGE1) }, 'robots-disallowed', 'robots: ' + PAGE1],
    ['a network error', { throws: new Error('socket hang up') }, 'fetch-failed', 'socket hang up'],
    ['an HTTP 404', { status: 404, body: '<html></html>' }, 'fetch-failed', 'HTTP 404'],
    ['a body that is not JSON', { body: '<html>maintenance</html>' }, 'parse-error', 'response is not JSON'],
    ['JSON without products', { body: '{"collections":[]}' }, 'parse-error', 'response has no products array'],
  ];

  for (const [name, answer, code, message] of cases) {
    it(`reports ${name} on the first request and returns nothing`, async () => {
      const { ctx } = fakeShop({ [PAGE1]: answer });
      const result = await collectShopifyCatalog(ctx);
      assert.deepEqual(result, {
        sightings: [],
        issues: [{ surface: 'platform', code, message, locator: PAGE1 }],
        parents: [],
      });
    });
  }

  it('keeps the first page when the second page fails', async () => {
    const first = Array.from({ length: 250 }, (_, i) => plainProduct(i + 1));
    const { ctx, calls } = fakeShop({
      [catalogUrl(1)]: { body: pageBody(first) },
      [catalogUrl(2)]: { status: 500, body: '' },
    });
    const result = await collectShopifyCatalog(ctx, { maxProducts: 1000 });
    assert.deepEqual(calls, [catalogUrl(1), catalogUrl(2)]);
    assert.equal(result.parents.length, 250);
    assert.equal(result.sightings.length, 250);
    assert.deepEqual(result.issues, [
      { surface: 'platform', code: 'fetch-failed', message: 'HTTP 500', locator: catalogUrl(2) },
    ]);
  });
});

describe('collectShopifyCatalog: malformed entries', () => {
  it('skips entries that cannot be identified, without an issue, and keeps raw indexes for locators', async () => {
    const products = [
      'a string',
      null,
      { id: 'abc', handle: 'not-numeric' },
      { id: 5, handle: 42 },
      {
        id: 9,
        handle: 'ok',
        title: 'Ok',
        variants: [
          'not a variant',
          { id: 'x', price: '1.00' },
          { id: 91, sku: 'OK-1', price: '5.00', available: true },
        ],
      },
    ];
    const { ctx } = fakeShop({ [PAGE1]: { body: pageBody(products) } });
    const result = await collectShopifyCatalog(ctx);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.parents, [{ id: 9, handle: 'ok', url: `${ORIGIN}/products/ok`, variantCount: 1 }]);
    assert.equal(result.sightings.length, 1);
    assert.equal(result.sightings[0]!.ids.variantId, '91');
    assert.equal(result.sightings[0]!.price!.locator, `${PAGE1}#/products/4/variants/2/price`);
  });

  it('does not treat a product with a numeric id but a non-array variants field as having variants', async () => {
    const { ctx } = fakeShop({ [PAGE1]: { body: pageBody([{ id: 3, handle: 'bare', variants: 'none' }]) } });
    const result = await collectShopifyCatalog(ctx);
    assert.deepEqual(result.parents, [{ id: 3, handle: 'bare', url: `${ORIGIN}/products/bare`, variantCount: 0 }]);
    assert.deepEqual(result.sightings, []);
  });
});
