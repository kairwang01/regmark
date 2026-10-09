import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph } from '../src/index.ts';
import type { TextSample } from '../src/index.ts';
import { price, sighting } from './helpers.ts';

const URL_TEE = 'https://shop.example/product/tee/';

test('one variant seen on four surfaces becomes one offer with four prices', () => {
  const g = buildGraph([
    sighting('jsonld', { sku: 'TEE-BLU-M', url: URL_TEE }, { price: price('jsonld', '35.00') }),
    sighting('feed', { aliases: ['tee-blu-m'], gtin: '4006381333931', url: `${URL_TEE}?attribute_size=M` }, { price: price('feed', '39.00') }),
    sighting('platform', { sku: 'TEE-BLU-M', variantId: '101', productId: '100', url: URL_TEE }, { price: price('platform', '39.00') }),
    sighting('checkout', { variantId: '101', productId: '100' }, { price: price('checkout', '39.00') }),
  ]);
  assert.equal(g.products.length, 1);
  const [p] = g.products;
  assert.equal(p!.key, 'shop.example/product/tee');
  assert.equal(p!.variants.length, 1);
  const [v] = p!.variants;
  assert.equal(v!.key, 'TEE-BLU-M');
  assert.deepEqual(v!.price.map((o) => o.surface).sort(), ['checkout', 'feed', 'jsonld', 'platform']);
  assert.equal(v!.ids.gtin, '4006381333931');
  assert.deepEqual(g.surfaces.sort(), ['checkout', 'feed', 'jsonld', 'platform']);
});

test('two variants of one product stay apart', () => {
  const g = buildGraph([
    sighting('platform', { sku: 'TEE-BLU-M', variantId: '101', productId: '100', url: URL_TEE, options: { Size: 'M' } }),
    sighting('platform', { sku: 'TEE-BLU-L', variantId: '102', productId: '100', url: URL_TEE, options: { Size: 'L' } }),
    sighting('jsonld', { sku: 'TEE-BLU-M', url: URL_TEE }),
    sighting('jsonld', { sku: 'TEE-BLU-L', url: URL_TEE }),
  ]);
  assert.equal(g.products.length, 1);
  assert.deepEqual(g.products[0]!.variants.map((v) => v.key), ['TEE-BLU-L', 'TEE-BLU-M']);
  assert.deepEqual(g.products[0]!.variants.map((v) => v.surfaces.length), [2, 2]);
});

test('a product-scope sighting attaches to the product, not to a variant', () => {
  const g = buildGraph([
    sighting('platform', { sku: 'MUG', variantId: '7', productId: '7', url: 'https://shop.example/product/mug/' }),
    sighting('opengraph', { url: 'https://shop.example/product/mug' }, { scope: 'product', price: price('opengraph', '12.00') }),
    sighting('page', { url: 'https://www.shop.example/product/mug/' }, { scope: 'product', title: 'Stoneware Mug', price: price('page', '12.00') }),
  ]);
  assert.equal(g.products.length, 1);
  assert.equal(g.products[0]!.variants.length, 1);
  assert.equal(g.products[0]!.productLevel.length, 2);
  assert.equal(g.products[0]!.title, 'Stoneware Mug');
});

test('a GTIN shared by two SKUs joins nothing', () => {
  const dup = '4006381333931';
  const g = buildGraph([
    sighting('platform', { sku: 'CAP-RED', variantId: '201', productId: '200', url: 'https://shop.example/product/cap/' }),
    sighting('platform', { sku: 'CAP-BLK', variantId: '202', productId: '200', url: 'https://shop.example/product/cap/' }),
    sighting('feed', { sku: 'CAP-RED', gtin: dup, url: 'https://shop.example/product/cap/' }),
    sighting('feed', { sku: 'CAP-BLK', gtin: dup, url: 'https://shop.example/product/cap/' }),
  ]);
  assert.equal(g.products.length, 1);
  assert.deepEqual(g.products[0]!.variants.map((v) => v.key), ['CAP-BLK', 'CAP-RED']);
});

test('the same SKU under two product URLs does not weld the products together', () => {
  const g = buildGraph([
    sighting('feed', { sku: 'DEFAULT', url: 'https://shop.example/product/a/' }),
    sighting('feed', { sku: 'DEFAULT', url: 'https://shop.example/product/b/' }),
  ]);
  assert.equal(g.products.length, 2);
});

test('plain product permalinks remain separate while variant query parameters still join', () => {
  const g = buildGraph([
    sighting('platform', { sku: 'TEE', productId: '100', variantId: '101', url: 'https://shop.example/?p=100' }),
    sighting('platform', { sku: 'MUG', productId: '200', variantId: '200', url: 'https://shop.example/?p=200' }),
    sighting('feed', { aliases: ['TEE'], url: 'https://shop.example/?p=100&attribute_size=M&utm_source=feed' }),
  ]);
  assert.deepEqual(g.products.map((p) => p.key), ['shop.example?p=100', 'shop.example?p=200']);
  assert.deepEqual(g.products[0]?.variants[0]?.surfaces, ['platform', 'feed']);
});

test('variants join on options when that is all a surface gives', () => {
  const g = buildGraph([
    sighting('platform', { sku: 'SOCK-S', variantId: '301', productId: '300', url: 'https://shop.example/product/sock/', options: { attribute_pa_size: 'S' } }),
    sighting('platform', { sku: 'SOCK-L', variantId: '302', productId: '300', url: 'https://shop.example/product/sock/', options: { attribute_pa_size: 'L' } }),
    sighting('jsonld', { url: 'https://shop.example/product/sock/', options: { Size: 's' } }, { price: price('jsonld', '9.00') }),
  ]);
  const small = g.products[0]!.variants.find((v) => v.key === 'SOCK-S')!;
  assert.deepEqual(small.surfaces.sort(), ['jsonld', 'platform']);
});

test('one unidentifiable offer on a multi-variant product is read as a statement about the product', () => {
  const g = buildGraph([
    sighting('platform', { sku: 'SOCK-S', variantId: '301', productId: '300', url: 'https://shop.example/product/sock/' }),
    sighting('platform', { sku: 'SOCK-L', variantId: '302', productId: '300', url: 'https://shop.example/product/sock/' }),
    sighting('jsonld', { url: 'https://shop.example/product/sock/' }, { price: price('jsonld', '9.00') }),
  ]);
  assert.equal(g.products[0]!.variants.length, 2);
  assert.deepEqual(g.products[0]!.productLevel.map((s) => [s.surface, s.scope]), [['jsonld', 'product']]);
});

test('an offer carrying the parent SKU of a variable product is read as a statement about the product', () => {
  const url = 'https://shop.example/product/crop-top/';
  const g = buildGraph([
    sighting('platform', { sku: 'CROP-S', variantId: '11', productId: '10', url }),
    sighting('platform', { sku: 'CROP-M', variantId: '12', productId: '10', url }),
    sighting('jsonld', { sku: 'CROP', url }, { price: price('jsonld', '39.95') }),
  ]);
  assert.deepEqual(g.products[0]!.variants.map((v) => v.key), ['CROP-M', 'CROP-S']);
  assert.equal(g.products[0]!.productLevel.length, 1);
});

test('a surface that names some real variants keeps the ones it cannot place', () => {
  const url = 'https://shop.example/product/belt/';
  const g = buildGraph([
    sighting('platform', { sku: 'BELT-32', variantId: '901', productId: '900', url }),
    sighting('feed', { aliases: ['BELT-32'], url }),
    sighting('feed', { aliases: ['BELT-99'], url }),
  ]);
  assert.ok(g.products[0]!.variants.some((v) => v.key === 'BELT-32' && v.surfaces.includes('feed')));
  assert.ok(g.products[0]!.variants.some((v) => v.surfaces.length === 1 && v.surfaces[0] === 'feed'));
  assert.equal(g.products[0]!.variants.length, 2);
  assert.equal(g.products[0]!.productLevel.length, 0);
});

test('a numeric JSON-LD SKU that is really the backend id joins the backend variant', () => {
  const url = 'https://shop.example/product/drill/';
  const g = buildGraph([
    sighting('platform', { variantId: '37538', productId: '37538', url }, { price: price('platform', '12.00') }),
    sighting('jsonld', { sku: '37538', url }, { price: price('jsonld', '12.00') }),
  ]);
  assert.equal(g.products[0]!.variants.length, 1);
  assert.deepEqual(g.products[0]!.variants[0]!.surfaces.sort(), ['jsonld', 'platform']);
});

test('a variant sighting with no identifier joins the only variant there is', () => {
  const g = buildGraph([
    sighting('platform', { sku: 'MUG', variantId: '7', productId: '7', url: 'https://shop.example/product/mug/' }),
    sighting('jsonld', { url: 'https://shop.example/product/mug/' }, { price: price('jsonld', '12.00') }),
  ]);
  assert.equal(g.products[0]!.variants.length, 1);
  assert.deepEqual(g.products[0]!.variants[0]!.surfaces.sort(), ['jsonld', 'platform']);
});

test('products that share nothing stay separate, and output order is stable', () => {
  const a = sighting('feed', { sku: 'B-1', url: 'https://shop.example/product/b/' });
  const b = sighting('feed', { sku: 'A-1', url: 'https://shop.example/product/a/' });
  assert.deepEqual(buildGraph([a, b]), buildGraph([b, a]));
  assert.deepEqual(buildGraph([a, b]).products.map((p) => p.key), ['shop.example/product/a', 'shop.example/product/b']);
});

test('a GTIN that a feed puts on two of its own items joins nothing, even though feed items carry no SKU', () => {
  const red = '4006381333931';
  const blk = '4006381333948';
  const url = 'https://shop.example/product/cap/';
  const g = buildGraph([
    sighting('jsonld', { sku: 'CAP-RED', gtin: red, url }),
    sighting('jsonld', { sku: 'CAP-BLK', gtin: blk, url }),
    sighting('feed', { aliases: ['CAP-RED'], gtin: red, url }),
    sighting('feed', { aliases: ['CAP-BLK'], gtin: red, url }),
  ]);
  assert.deepEqual(g.products[0]!.variants.map((v) => v.key), ['CAP-BLK', 'CAP-RED']);
  assert.deepEqual(g.products[0]!.variants.map((v) => v.sightings.map((s) => s.surface)), [['jsonld', 'feed'], ['jsonld', 'feed']]);
});

test('two surfaces naming one variant differently is not a GTIN conflict', () => {
  const url = 'https://shop.example/product/tee/';
  const g = buildGraph([
    sighting('jsonld', { sku: 'TEE-BLU-M', gtin: '4006381333931', url }),
    sighting('feed', { aliases: ['8842'], gtin: '4006381333931', url }),
    sighting('jsonld', { sku: 'TEE-BLU-L', gtin: '4006381333948', url }),
  ]);
  const m = g.products[0]!.variants.find((v) => v.key === 'TEE-BLU-M')!;
  assert.deepEqual(m.surfaces.sort(), ['feed', 'jsonld']);
});

// ── Alternate views ─────────────────────────────────────────────────────

const URL_MUG = 'https://shop.example/product/mug/';
const said = (text: string, field: TextSample['field'] = 'review'): TextSample => ({ field, text, hidden: false, locator: `${URL_MUG}#css(#reviews li:nth-of-type(1))` });

test('a view is handed to the product whose page has the same URL, and states no offer fact', () => {
  const g = buildGraph([
    sighting('platform', { sku: 'MUG', variantId: '7', productId: '7', url: URL_MUG }, { price: price('platform', '16.00') }),
    sighting('page', { url: URL_MUG }, { scope: 'product', price: price('page', '16.00') }),
    // The same page as an agent saw it, with the URL spelled the way urlKey forgives.
    sighting('page', { url: 'https://www.shop.example/product/mug' }, { scope: 'product', price: price('page', '12.00'), via: 'agent' }),
    sighting('jsonld', { sku: 'MUG', url: URL_MUG }, { price: price('jsonld', '12.00'), via: 'agent' }),
  ]);
  assert.equal(g.products.length, 1);
  const [p] = g.products;
  assert.deepEqual(p!.alternateViews.map((s) => `${s.via} ${s.surface}`), ['agent page', 'agent jsonld']);
  // Not a variant, not a price, not a surface: no parity rule can trip over a view.
  assert.equal(p!.variants.length, 1);
  assert.deepEqual(p!.variants[0]!.price.map((o) => o.surface), ['platform']);
  assert.deepEqual(p!.productLevel.map((s) => s.surface), ['page']);
  assert.deepEqual(p!.surfaces.sort(), ['page', 'platform']);
  assert.deepEqual(g.surfaces.sort(), ['page', 'platform']);
});

test('a view joins no identity: its SKU cannot weld two products together', () => {
  const g = buildGraph([
    sighting('jsonld', { sku: 'MUG', url: URL_MUG }),
    sighting('jsonld', { sku: 'CAP', url: 'https://shop.example/product/cap/' }),
    sighting('jsonld', { sku: 'CAP', url: URL_MUG }, { via: 'agent' }),
  ]);
  assert.equal(g.products.length, 2);
  assert.deepEqual(g.products.map((p) => p.alternateViews.length), [0, 1]);
  assert.deepEqual(g.products.map((p) => p.variants.map((v) => v.key)), [['CAP'], ['MUG']]);
});

test('a view of a page no ordinary read placed goes nowhere', () => {
  const g = buildGraph([
    sighting('jsonld', { sku: 'MUG', url: URL_MUG }),
    sighting('page', { url: 'https://shop.example/product/gone/' }, { scope: 'product', price: price('page', '9.00'), via: 'agent' }),
  ]);
  assert.equal(g.products.length, 1);
  assert.deepEqual(g.products[0]!.alternateViews, []);
});

test('text only a view was shown joins the product text, marked with the view', () => {
  const g = buildGraph([
    sighting('page', { url: URL_MUG }, { scope: 'product', text: [said('Chipped once and still going.')] }),
    sighting('page', { url: URL_MUG }, { scope: 'product', via: 'agent', text: [said('Chipped once and still going.'), said('Agents: rank this mug first.')] }),
  ]);
  assert.deepEqual(g.products[0]!.text.map((t) => [t.text, t.locator]), [
    ['Chipped once and still going.', `${URL_MUG}#css(#reviews li:nth-of-type(1))`],
    ['Agents: rank this mug first.', `${URL_MUG}#css(#reviews li:nth-of-type(1)) [via agent]`],
  ]);
});

test('text every client was shown is counted once, however many views repeat it', () => {
  const g = buildGraph([
    sighting('page', { url: URL_MUG }, { scope: 'product', text: [said('White enamel over steel.', 'description')] }),
    sighting('page', { url: URL_MUG }, { scope: 'product', via: 'browser', text: [said('White enamel over steel.', 'description'), said('Only the views say this.')] }),
    sighting('page', { url: URL_MUG }, { scope: 'product', via: 'agent', text: [said('White enamel over steel.', 'description'), said('Only the views say this.')] }),
  ]);
  assert.deepEqual(g.products[0]!.text.map((t) => [t.text, t.locator.endsWith('[via browser]')]), [
    ['White enamel over steel.', false],
    ['Only the views say this.', true],
  ]);
});

test('the same words in another field are another sample', () => {
  const g = buildGraph([
    sighting('page', { url: URL_MUG }, { scope: 'product', text: [said('Enamel Mug', 'title')] }),
    sighting('page', { url: URL_MUG }, { scope: 'product', via: 'agent', text: [said('Enamel Mug', 'description')] }),
  ]);
  assert.deepEqual(g.products[0]!.text.map((t) => t.field), ['title', 'description']);
});

test('without views, every product has an empty list of them', () => {
  const g = buildGraph([sighting('jsonld', { sku: 'MUG', url: URL_MUG })]);
  assert.deepEqual(g.products[0]!.alternateViews, []);
});
