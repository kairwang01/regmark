import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractOpenGraph } from '../src/opengraph.ts';

const PAGE = 'https://shop.example/p/tee/';
const FETCHED = '2026-10-09T08:00:00Z';

function head(...tags: string[]): string {
  return `<!doctype html><html><head>${tags.join('\n')}</head><body></body></html>`;
}

function run(html: string) {
  return extractOpenGraph(html, PAGE, FETCHED);
}

describe('extractOpenGraph', () => {
  it('reads a full set of product tags into one product-scope sighting', () => {
    const { sightings, issues } = run(
      head(
        '<meta property="og:title" content="Linen Tee">',
        '<meta property="og:url" content="https://shop.example/p/tee/">',
        '<meta property="product:price:amount" content="39.00">',
        '<meta property="product:price:currency" content="USD">',
        '<meta property="product:availability" content="in stock">',
        '<meta property="product:retailer_item_id" content="TEE-BLU-M">',
      ),
    );
    assert.deepEqual(issues, []);
    assert.equal(sightings.length, 1);
    const s = sightings[0]!;
    assert.equal(s.surface, 'opengraph');
    assert.equal(s.scope, 'product');
    assert.equal(s.title, 'Linen Tee');
    assert.equal(s.ids.url, 'https://shop.example/p/tee/');
    assert.deepEqual(s.ids.aliases, ['TEE-BLU-M']);
    assert.deepEqual(s.price?.value, { units: 390000, currency: 'USD' });
    assert.equal(s.price?.raw, '39.00');
    assert.equal(s.price?.locator, `${PAGE}#meta[property="product:price:amount"]`);
    assert.equal(s.price?.fetchedAt, FETCHED);
    assert.equal(s.availability?.value, 'in_stock');
    assert.equal(s.availability?.raw, 'in stock');
    assert.equal(s.availability?.locator, `${PAGE}#meta[property="product:availability"]`);
  });

  it('gives a sighting from availability alone', () => {
    const { sightings } = run(head('<meta property="og:availability" content="out of stock">'));
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.price, undefined);
    assert.equal(sightings[0]!.availability?.value, 'out_of_stock');
    assert.equal(sightings[0]!.availability?.locator, `${PAGE}#meta[property="og:availability"]`);
  });

  it('accepts name= in place of property=', () => {
    const { sightings } = run(
      head('<meta name="product:price:amount" content="12,50"><meta name="product:price:currency" content="EUR">'),
    );
    assert.equal(sightings.length, 1);
    assert.deepEqual(sightings[0]!.price?.value, { units: 125000, currency: 'EUR' });
    assert.equal(sightings[0]!.price?.locator, `${PAGE}#meta[name="product:price:amount"]`);
  });

  it('gives no sighting when nothing relevant is present', () => {
    const { sightings, issues } = run(
      head('<meta property="og:title" content="Linen Tee"><meta property="og:type" content="product">'),
    );
    assert.deepEqual(sightings, []);
    assert.deepEqual(issues, []);
  });

  it('gives no sighting for an availability value it does not know', () => {
    const { sightings } = run(head('<meta property="og:availability" content="maybe">'));
    assert.deepEqual(sightings, []);
  });

  it('puts product:retailer_item_id into aliases', () => {
    const { sightings } = run(
      head('<meta property="product:retailer_item_id" content="backend-99182"><meta property="og:availability" content="instock">'),
    );
    assert.deepEqual(sightings[0]!.ids.aliases, ['backend-99182']);
  });

  it('resolves a relative og:url against the page URL', () => {
    const { sightings } = run(
      head('<meta property="og:url" content="/p/tee/blue-m"><meta property="og:availability" content="instock">'),
    );
    assert.equal(sightings[0]!.ids.url, 'https://shop.example/p/tee/blue-m');
  });

  it('uses the page URL when og:url is absent', () => {
    const { sightings } = run(head('<meta property="og:availability" content="instock">'));
    assert.equal(sightings[0]!.ids.url, PAGE);
  });

  it('prefers product:price:amount over og:price:amount when both are present', () => {
    const { sightings } = run(
      head(
        '<meta property="og:price:amount" content="45.00">',
        '<meta property="product:price:amount" content="39.00">',
        '<meta property="product:price:currency" content="USD">',
      ),
    );
    assert.equal(sightings[0]!.price?.value.units, 390000);
    assert.equal(sightings[0]!.price?.locator, `${PAGE}#meta[property="product:price:amount"]`);
  });

  it('matches property names case-insensitively', () => {
    const { sightings } = run(head('<meta property="PRODUCT:Availability" content="InStock">'));
    assert.equal(sightings[0]!.availability?.value, 'in_stock');
  });
});
