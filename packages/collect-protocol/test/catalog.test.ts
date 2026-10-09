// How a catalogue answer becomes sightings, tested against the shared reader
// with a scripted Ask, so each case states one thing about the mapping. The
// transports have their own tests in ucp.test.ts and mcp.test.ts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CollectIssue } from '@regmark/core';
import { backendId, lookupIds, readCatalogue } from '../src/catalog.ts';
import type { Answer, Ask, CatalogueOptions, Operation } from '../src/catalog.ts';
import type { ProductRef } from '../src/refs.ts';
import { FETCHED_AT, ORIGIN, found, lookupAnswer, product, usd, variant } from './fake-endpoint.ts';

const AT = `${ORIGIN}/ucp/v1/catalog/lookup`;
const TEE: ProductRef = { url: `${ORIGIN}/products/classic-tee`, title: 'Classic Tee', handle: 'classic-tee', variantIds: ['101', '102'], skus: ['TEE-S', 'TEE-M'] };

type Asked = [Operation, Record<string, unknown>];

/** An Ask that answers each question with the next payload, or with what `answer` returns for it. */
function script(answer: (operation: Operation, request: Record<string, unknown>) => Record<string, unknown> | CollectIssue): { ask: Ask; asked: Asked[] } {
  const asked: Asked[] = [];
  const ask: Ask = async (operation, request) => {
    asked.push([operation, request]);
    const out = answer(operation, request);
    if ('code' in out && 'surface' in out) return { ok: false, issue: out as CollectIssue } satisfies Answer;
    return { ok: true, payload: out, url: AT, pointer: '', fetchedAt: FETCHED_AT };
  };
  return { ask, asked };
}

const options = (refs: ProductRef[], extra: Partial<CatalogueOptions> = {}): CatalogueOptions => ({
  surface: 'ucp',
  refs,
  lookup: true,
  search: true,
  includeUnavailable: false,
  ...extra,
});

describe('readCatalogue: what a variant says', () => {
  it('maps a looked-up variant to a sighting with ids, prices, stock, raw text and locators', async () => {
    const small = variant('101', 'TEE-S', 3900, {
      list_price: usd(4500),
      barcodes: [{ type: 'GTIN', value: '4006381333931' }],
      options: [{ name: 'Size', label: 'S' }],
      availability: { available: true, status: 'in_stock' },
    });
    const { ask } = script(() => lookupAnswer([product('100', 'classic-tee', [found(small, ['101', 'exact'])], { title: 'Classic Tee', url: 'https://other-host.example/products/classic-tee' })]));
    const result = await readCatalogue(ask, options([{ ...TEE, variantIds: ['101'] }]));

    assert.deepEqual(result.issues, []);
    const at = `${AT}#lookup_catalog[id="101"]/products/0/variants/0`;
    assert.deepEqual(result.sightings, [
      {
        surface: 'ucp',
        scope: 'variant',
        // The ref's URL, not the catalogue's: the graph joins surfaces by URL.
        ids: { url: TEE.url, sku: 'TEE-S', gtin: '4006381333931', options: { Size: 'S' }, aliases: ['101'] },
        title: 'Classic Tee',
        price: { value: { units: 390000, currency: 'USD' }, raw: '{"amount":3900,"currency":"USD"}', surface: 'ucp', locator: `${at}/price`, fetchedAt: FETCHED_AT },
        listPrice: { value: { units: 450000, currency: 'USD' }, raw: '{"amount":4500,"currency":"USD"}', surface: 'ucp', locator: `${at}/list_price`, fetchedAt: FETCHED_AT },
        availability: { value: 'in_stock', raw: '{"available":true,"status":"in_stock"}', surface: 'ucp', locator: `${at}/availability`, fetchedAt: FETCHED_AT },
      },
    ]);
  });

  it('reads amounts in each currency’s own minor unit: none for JPY, three places for KWD', async () => {
    const yen = variant('1', 'A', 4200, { price: { amount: 4200, currency: 'JPY' } });
    const dinar = variant('2', 'B', 1250, { price: { amount: 1250, currency: 'KWD' } });
    const { ask } = script(() => lookupAnswer([product('9', 'p', [found(yen, ['1', 'exact']), found(dinar, ['2', 'exact'])])]));
    const result = await readCatalogue(ask, options([{ url: `${ORIGIN}/products/p`, variantIds: ['1', '2'] }]));
    assert.deepEqual(result.sightings.map((s) => s.price?.value), [{ units: 42_000_000, currency: 'JPY' }, { units: 12_500, currency: 'KWD' }]);
  });

  it('reads stock from available, qualified by a well-known status that agrees with it', async () => {
    const cases: [unknown, string | undefined][] = [
      [{ available: true }, 'in_stock'],
      [{ available: false }, 'out_of_stock'],
      [{ available: true, status: 'preorder' }, 'preorder'],
      [{ available: true, status: 'backorder' }, 'backorder'],
      [{ available: false, status: 'discontinued' }, 'discontinued'],
      [{ status: 'out_of_stock' }, 'out_of_stock'],
      // When the two disagree, `available` is the answer.
      [{ available: false, status: 'in_stock' }, 'out_of_stock'],
      [{ available: true, status: 'running_low' }, 'in_stock'],
      // Silent: nothing a buyer could act on.
      [{ status: 'running_low' }, undefined],
      [{ status: 'constructor' }, undefined],
      [{}, undefined],
      ['in_stock', undefined],
    ];
    for (const [availability, expected] of cases) {
      const { ask } = script(() => lookupAnswer([product('9', 'p', [found(variant('1', 'A', 100, { availability }), ['1', 'exact'])])]));
      const [sighting] = (await readCatalogue(ask, options([{ url: `${ORIGIN}/products/p`, variantIds: ['1'] }]))).sightings;
      assert.equal(sighting?.availability?.value, expected, JSON.stringify(availability));
    }
  });

  it('takes the numeric id of a Shopify variant gid as an alias, and no alias from an opaque id', () => {
    assert.equal(backendId('gid://shopify/ProductVariant/41884547022928'), '41884547022928');
    assert.equal(backendId(' 4021 '), '4021');
    assert.equal(backendId('gid://shopify/Product/7258385809488'), undefined);
    assert.equal(backendId('prod_abc123_size10'), undefined);
    assert.equal(backendId('gid://shopify/ProductVariant/12x'), undefined);
  });
});

describe('readCatalogue: what it leaves out', () => {
  it('states nothing for a variant matched only as featured: it stands for the product, not for itself', async () => {
    const { ask } = script(() => lookupAnswer([product('100', 'classic-tee', [found(variant('101', 'TEE-S', 3900), ['classic-tee', 'featured'])])]));
    const result = await readCatalogue(ask, options([{ url: TEE.url, handle: 'classic-tee' }], { search: false }));
    assert.deepEqual(result.sightings.map((s) => s.scope), ['product']);
    assert.deepEqual(result.issues, []);
  });

  it('ignores variants no asked-for id found, including ones a sloppy server adds without inputs', async () => {
    const extra = variant('103', 'TEE-L', 3900);
    const { ask } = script(() => lookupAnswer([product('100', 'classic-tee', [found(variant('101', 'TEE-S', 3900), ['101', 'exact']), extra, found(variant('104', 'X', 1), ['999', 'exact'])])]));
    const result = await readCatalogue(ask, options([{ ...TEE, variantIds: ['101'] }]));
    assert.deepEqual(result.sightings.map((s) => s.ids.sku), ['TEE-S']);
  });

  it('accepts a variant without inputs whose own id was asked for', async () => {
    const { ask } = script(() => lookupAnswer([product('100', 'classic-tee', [variant('101', 'TEE-S', 3900)])]));
    const result = await readCatalogue(ask, options([{ ...TEE, variantIds: ['101'] }]));
    assert.deepEqual(result.sightings.map((s) => [s.ids.sku, s.scope]), [['TEE-S', 'variant']]);
  });

  it('reports a price it cannot read and states none: no currency, a decimal string, a fraction, a negative', async () => {
    for (const bad of [{ amount: 3900 }, { amount: '39.00', currency: 'USD' }, { amount: 39.5, currency: 'USD' }, { amount: -1, currency: 'USD' }, { amount: 3900, currency: 'usd' }, 3900]) {
      const { ask } = script(() => lookupAnswer([product('9', 'p', [found(variant('1', 'A', 0, { price: bad }), ['1', 'exact'])])]));
      const result = await readCatalogue(ask, options([{ url: `${ORIGIN}/products/p`, variantIds: ['1'] }]));
      assert.equal(result.sightings[0]?.price, undefined, JSON.stringify(bad));
      assert.deepEqual(result.issues.map((i) => [i.code, i.locator]), [['field-unreadable', `${AT}#lookup_catalog[id="1"]/products/0/variants/0/price`]]);
    }
  });

  it('states no list price that is zero (Shopify’s "none"), not above the price, or in another currency', async () => {
    for (const list of [usd(0), usd(3900), usd(1000), { amount: 9900, currency: 'EUR' }, { amount: 'x' }]) {
      const { ask } = script(() => lookupAnswer([product('9', 'p', [found(variant('1', 'A', 3900, { list_price: list }), ['1', 'exact'])])]));
      const result = await readCatalogue(ask, options([{ url: `${ORIGIN}/products/p`, variantIds: ['1'] }]));
      assert.equal(result.sightings[0]?.listPrice, undefined, JSON.stringify(list));
      assert.ok(result.sightings[0]?.price, 'the price itself is still read');
      assert.deepEqual(result.issues, []);
    }
  });

  it('states no price for a variant sold by weight or time: that price is per pound or per hour, not per item', async () => {
    const byWeight = variant('1', 'BANANA', 79, { quantity_unit: { unit: 'LBR', scale: 2, display_text: 'lb', increment: 25 }, list_price: usd(99) });
    const each = variant('2', 'BUNCH', 199, { quantity_unit: { unit: 'C62' } });
    const { ask } = script(() => lookupAnswer([product('9', 'p', [found(byWeight, ['1', 'exact']), found(each, ['2', 'exact'])])]));
    const result = await readCatalogue(ask, options([{ url: `${ORIGIN}/products/p`, variantIds: ['1', '2'] }]));
    assert.deepEqual(result.sightings.map((s) => [s.ids.sku, s.price?.value.units, s.listPrice, s.availability?.value]), [
      ['BANANA', undefined, undefined, 'in_stock'],
      ['BUNCH', 19_900, undefined, 'in_stock'],
    ]);
    assert.deepEqual(result.issues, []);
  });

  it('leaves out Shopify’s placeholder option, barcodes that are not GTINs, and an empty SKU', async () => {
    const plain = variant('1', '', 100, {
      options: [{ name: 'Title', label: 'Default Title' }],
      barcodes: [{ type: 'MPN', value: 'NF-1' }, { type: 'SKU', value: 'A' }, { type: 'GTIN', value: '' }],
    });
    const { ask } = script(() => lookupAnswer([product('9', 'p', [found(plain, ['1', 'exact'])])]));
    const [sighting] = (await readCatalogue(ask, options([{ url: `${ORIGIN}/products/p`, variantIds: ['1'] }]))).sightings;
    assert.deepEqual(sighting?.ids, { url: `${ORIGIN}/products/p`, aliases: ['1'] });
  });

  it('takes a GTIN from an EAN, UPC, JAN or ISBN barcode as given, and leaves checking it to the identity rule', async () => {
    for (const type of ['EAN', 'upc', 'JAN', 'ISBN']) {
      const { ask } = script(() => lookupAnswer([product('9', 'p', [found(variant('1', 'A', 1, { barcodes: [{ type, value: ' 012345678905 ' }] }), ['1', 'exact'])])]));
      const [sighting] = (await readCatalogue(ask, options([{ url: `${ORIGIN}/products/p`, variantIds: ['1'] }]))).sightings;
      assert.equal(sighting?.ids.gtin, '012345678905', type);
    }
  });

  it('skips entries that are not objects and a product without variants, without throwing', async () => {
    const { ask } = script(() => lookupAnswer([null, 'x', product('9', 'p', 'no' as never), product('8', 'q', [null, 7, found(variant('1', 'A', 1), ['1', 'exact'])] as never)]));
    const result = await readCatalogue(ask, options([{ url: `${ORIGIN}/products/q`, variantIds: ['1'] }]));
    assert.deepEqual(result.sightings.map((s) => s.ids.sku), ['A']);
  });

  it('states a variant once when two answers both return it', async () => {
    const v = found(variant('101', 'TEE-S', 3900), ['101', 'exact']);
    const { ask } = script(() => lookupAnswer([product('100', 'classic-tee', [v]), product('100', 'classic-tee', [v])]));
    const result = await readCatalogue(ask, options([{ ...TEE, variantIds: ['101'] }]));
    assert.equal(result.sightings.length, 1);
  });
});

describe('readCatalogue: what it asks', () => {
  it('asks by the storefront API’s variant ids, written as Shopify gids on Shopify', () => {
    assert.deepEqual(lookupIds(TEE, 'shopify'), ['gid://shopify/ProductVariant/101', 'gid://shopify/ProductVariant/102']);
    assert.deepEqual(lookupIds(TEE, 'woocommerce'), ['101', '102']);
    assert.deepEqual(lookupIds(TEE), ['101', '102']);
    assert.deepEqual(lookupIds({ ...TEE, variantIds: ['gid://shopify/ProductVariant/7'] }, 'shopify'), ['gid://shopify/ProductVariant/7']);
  });

  it('asks by SKU without variant ids, and by handle without SKUs', () => {
    assert.deepEqual(lookupIds({ ...TEE, variantIds: undefined }), ['TEE-S', 'TEE-M']);
    assert.deepEqual(lookupIds({ url: TEE.url, handle: 'classic-tee' }), ['classic-tee']);
    assert.deepEqual(lookupIds({ url: TEE.url }), []);
  });

  it('batches ids across products, ten to a request, and maps each answer back to the product that asked', async () => {
    const refs = [1, 2, 3].map((n): ProductRef => ({ url: `${ORIGIN}/products/p${n}`, variantIds: Array.from({ length: 8 }, (_, i) => `${n}0${i}`) }));
    const { ask, asked } = script((_op, request) => {
      const ids = request.ids as string[];
      return lookupAnswer(ids.map((id) => product(`p${id[0]}`, `p${id[0]}`, [found(variant(id, `SKU-${id}`, 100), [id, 'exact'])])));
    });
    const result = await readCatalogue(ask, options(refs));
    assert.deepEqual(asked.map(([op, r]) => [op, (r.ids as string[]).length]), [['lookup_catalog', 10], ['lookup_catalog', 10], ['lookup_catalog', 4]]);
    assert.equal(result.sightings.length, 24);
    for (const s of result.sightings) assert.equal(s.ids.url, `${ORIGIN}/products/p${s.ids.sku!.slice(4, 5)}`);
  });

  it('does not look up a product with more variants than five requests can hold, and says so', async () => {
    const big: ProductRef = { url: `${ORIGIN}/products/big`, variantIds: Array.from({ length: 51 }, (_, i) => String(i + 1)) };
    const { ask, asked } = script(() => lookupAnswer([]));
    const result = await readCatalogue(ask, options([big], { search: false }));
    assert.deepEqual(asked, []);
    assert.deepEqual(result.issues.map((i) => [i.code, i.locator]), [['too-many-variants', big.url]]);
  });

  it('sends filters.available=false only when asked to include unavailable variants', async () => {
    for (const includeUnavailable of [true, false]) {
      const { ask, asked } = script(() => lookupAnswer([]));
      await readCatalogue(ask, options([TEE], { includeUnavailable, search: false }));
      assert.deepEqual(asked[0]?.[1], includeUnavailable ? { ids: ['101', '102'], filters: { available: false } } : { ids: ['101', '102'] });
    }
  });

  it('never searches for a product the storefront API gave exact ids for: a search may hold part of its variants', async () => {
    const { ask, asked } = script(() => lookupAnswer([]));
    const result = await readCatalogue(ask, options([TEE]));
    assert.deepEqual(asked.map(([op]) => op), ['lookup_catalog']);
    assert.deepEqual(result.issues.map((i) => [i.code, i.message, i.locator]), [['not-found', 'the catalogue has no product for this page', TEE.url]]);
  });

  it('searches by title for a product known only from outside, and takes the result that names the same page', async () => {
    const ref: ProductRef = { url: `${ORIGIN}/products/classic-tee/`, title: 'Classic Tee', skus: ['TEE-S'], handle: 'classic-tee' };
    const { ask, asked } = script((op) =>
      op === 'lookup_catalog'
        ? lookupAnswer([], { messages: [{ type: 'info', code: 'not_found', content: 'TEE-S' }] })
        : lookupAnswer([product('7', 'classic-tee-kids', [variant('70', 'KID', 100)]), product('1', 'classic-tee', [variant('11', 'TEE-S', 3900), variant('12', 'TEE-M', 3900)])]),
    );
    const result = await readCatalogue(ask, options([ref]));
    assert.deepEqual(asked, [
      ['lookup_catalog', { ids: ['TEE-S'] }],
      ['search_catalog', { query: 'Classic Tee', pagination: { limit: 10 } }],
    ]);
    assert.deepEqual(result.sightings.map((s) => [s.ids.sku, s.scope, s.price?.locator]), [
      ['TEE-S', 'variant', `${AT}#search_catalog[query="Classic Tee"]/products/1/variants/0/price`],
      ['TEE-M', 'variant', `${AT}#search_catalog[query="Classic Tee"]/products/1/variants/1/price`],
    ]);
    assert.deepEqual(result.issues, []);
  });

  it('takes no search result that names another page or handle, and reports the product not found', async () => {
    const ref: ProductRef = { url: `${ORIGIN}/products/classic-tee`, title: 'Classic Tee', handle: 'classic-tee' };
    const { ask } = script((op) => (op === 'lookup_catalog' ? lookupAnswer([]) : lookupAnswer([product('7', 'classic-tee-2', [variant('70', 'X', 100)], { url: `${ORIGIN}/products/classic-tee-2` })])));
    const result = await readCatalogue(ask, options([ref]));
    assert.deepEqual(result.sightings, []);
    assert.deepEqual(result.issues.map((i) => i.code), ['not-found']);
  });

  it('stops at the first failed request and reports it once, without calling the rest not found', async () => {
    const refs = [1, 2].map((n): ProductRef => ({ url: `${ORIGIN}/products/p${n}`, variantIds: Array.from({ length: 10 }, (_, i) => `${n}${i}`) }));
    const failure: CollectIssue = { surface: 'ucp', code: 'fetch-failed', message: 'lookup_catalog: HTTP 503', locator: AT };
    const { ask, asked } = script(() => failure);
    const result = await readCatalogue(ask, options(refs));
    assert.equal(asked.length, 1);
    assert.deepEqual(result.issues, [failure]);
  });

  it('reports a catalogue that answers with ucp.status error, by its UCP code', async () => {
    const cases: [string, string][] = [['version_unsupported', 'version-unsupported'], ['capabilities_incompatible', 'not-supported'], ['rate_limited', 'fetch-failed']];
    for (const [ucpCode, code] of cases) {
      const { ask } = script(() => ({ ucp: { version: '2026-08-25', status: 'error' }, messages: [{ type: 'error', code: ucpCode, content: 'no' }] }));
      const result = await readCatalogue(ask, options([TEE]));
      assert.deepEqual(result.issues.map((i) => [i.code, i.message]), [[code, `lookup_catalog: the catalogue answered with an error (${ucpCode}: no)`]]);
    }
  });

  it('reports an answer with no products list as a parse error', async () => {
    const { ask } = script(() => ({ ucp: { version: '2026-08-25' }, product: {} }));
    const result = await readCatalogue(ask, options([TEE]));
    assert.deepEqual(result.issues.map((i) => i.code), ['parse-error']);
  });

  it('asks nothing for no products', async () => {
    const { ask, asked } = script(() => lookupAnswer([]));
    assert.deepEqual(await readCatalogue(ask, options([])), { sightings: [], issues: [] });
    assert.deepEqual(asked, []);
  });
});
