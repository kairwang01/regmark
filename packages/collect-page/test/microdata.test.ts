import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMicrodata } from '../src/microdata.ts';

const PAGE = 'https://shop.example/p/tee/';
const FETCHED = '2026-10-09T08:00:00Z';

function body(markup: string): string {
  return `<!doctype html><html><head><title>Tee</title></head><body>${markup}</body></html>`;
}

function run(html: string) {
  return extractMicrodata(html, PAGE, FETCHED);
}

describe('extractMicrodata', () => {
  it('reads a Product with one offer', () => {
    const { sightings, issues } = run(
      body(`
        <div itemscope itemtype="https://schema.org/Product">
          <h1 itemprop="name">Linen Tee</h1>
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <span itemprop="price" content="39.00">$39.00</span>
            <meta itemprop="priceCurrency" content="USD">
            <link itemprop="availability" href="https://schema.org/InStock">
            <span itemprop="sku">TEE-BLU-M</span>
          </div>
        </div>`),
    );
    assert.deepEqual(issues, []);
    assert.equal(sightings.length, 1);
    const s = sightings[0]!;
    assert.equal(s.surface, 'microdata');
    assert.equal(s.scope, 'variant');
    assert.equal(s.title, 'Linen Tee');
    assert.equal(s.ids.sku, 'TEE-BLU-M');
    assert.equal(s.ids.url, PAGE);
    assert.deepEqual(s.price?.value, { units: 390000, currency: 'USD' });
    assert.equal(s.price?.raw, '39.00');
    assert.equal(s.price?.locator, `${PAGE}#microdata[0]/offers[0]/price`);
    assert.equal(s.price?.fetchedAt, FETCHED);
    assert.equal(s.availability?.value, 'in_stock');
    assert.equal(s.availability?.raw, 'https://schema.org/InStock');
    assert.equal(s.availability?.locator, `${PAGE}#microdata[0]/offers[0]/availability`);
  });

  it('prefers the content attribute over text, and reads text when there is no attribute', () => {
    const { sightings } = run(
      body(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Linen Tee</span>
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <span itemprop="price" content="12.00">€ 15</span>
            <span itemprop="priceCurrency" content="EUR">EUR</span>
          </div>
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <span itemprop="price">39,00</span>
            <span itemprop="priceCurrency">EUR</span>
          </div>
        </div>`),
    );
    assert.equal(sightings.length, 2);
    assert.deepEqual(sightings[0]!.price?.value, { units: 120000, currency: 'EUR' });
    assert.equal(sightings[0]!.price?.raw, '12.00');
    assert.deepEqual(sightings[1]!.price?.value, { units: 390000, currency: 'EUR' });
    assert.equal(sightings[1]!.price?.raw, '39,00');
    assert.equal(sightings[1]!.price?.locator, `${PAGE}#microdata[0]/offers[1]/price`);
  });

  it('reads price inside a nested offers wrapper and keeps a nested Product out of the outer one', () => {
    const { sightings } = run(
      body(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Starter Kit</span>
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <div itemprop="itemOffered" itemscope itemtype="https://schema.org/Product">
              <span itemprop="name">Mug</span>
              <span itemprop="price" content="99.00">99</span>
            </div>
            <div><div>
              <span itemprop="price" content="9.50">9.50</span>
            </div></div>
            <meta itemprop="priceCurrency" content="GBP">
          </div>
        </div>`),
    );
    assert.equal(sightings.length, 2);
    const outer = sightings[0]!;
    assert.equal(outer.title, 'Starter Kit');
    assert.deepEqual(outer.price?.value, { units: 95000, currency: 'GBP' });
    assert.equal(outer.price?.locator, `${PAGE}#microdata[0]/offers[0]/price`);

    const inner = sightings[1]!;
    assert.equal(inner.title, 'Mug');
    assert.equal(inner.price?.locator, `${PAGE}#microdata[1]/price`);
  });

  it('reads a direct price when the Product has no offers scope', () => {
    const { sightings } = run(
      body(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Pin</span>
          <span itemprop="price">$8.00</span>
          <meta itemprop="priceCurrency" content="USD">
          <span itemprop="sku">PIN-1</span>
        </div>`),
    );
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.scope, 'variant');
    assert.equal(sightings[0]!.ids.sku, 'PIN-1');
    assert.deepEqual(sightings[0]!.price?.value, { units: 80000, currency: 'USD' });
    assert.equal(sightings[0]!.price?.locator, `${PAGE}#microdata[0]/price`);
  });

  it('gives a product-scope sighting for an offer with no identifiers', () => {
    const { sightings } = run(
      body(`
        <div itemscope itemtype="https://schema.org/Product">
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <span itemprop="price">39.00</span>
            <meta itemprop="priceCurrency" content="USD">
            <meta itemprop="availability" content="https://schema.org/OutOfStock">
          </div>
        </div>`),
    );
    assert.equal(sightings[0]!.scope, 'product');
    assert.equal(sightings[0]!.availability?.value, 'out_of_stock');
    assert.equal(sightings[0]!.availability?.raw, 'https://schema.org/OutOfStock');
  });

  it('ignores ProductGroup scopes', () => {
    const { sightings } = run(
      body(`
        <div itemscope itemtype="https://schema.org/ProductGroup">
          <span itemprop="name">Linen Tee</span>
          <span itemprop="price">39.00</span>
        </div>`),
    );
    assert.deepEqual(sightings, []);
  });

  it('returns empty arrays when there is no microdata', () => {
    const { sightings, issues } = run(body('<p>Linen Tee, $39.00</p>'));
    assert.deepEqual(sightings, []);
    assert.deepEqual(issues, []);
  });
});

describe('extractMicrodata: products that are not the page’s own', () => {
  it('leaves out the miniatures of a related-products block', () => {
    const card = (name: string, price: string) => `
      <article itemprop="item" itemscope itemtype="https://schema.org/Product">
        <a itemprop="url" href="/${name}">${name}</a>
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="priceCurrency" content="USD"><meta itemprop="price" content="${price}">
        </div>
      </article>`;
    const { sightings } = run(
      body(`
        <div itemscope itemtype="https://schema.org/Product">
          <h1 itemprop="name">Linen Tee</h1>
          <span itemprop="sku">TEE</span>
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <meta itemprop="priceCurrency" content="USD"><span itemprop="price" content="39.00">$39.00</span>
          </div>
        </div>
        <section itemscope itemtype="https://schema.org/ItemList">${card('mug', '16.00')}${card('cap', '22.00')}</section>`),
    );
    assert.deepEqual(sightings.map((s) => s.price?.raw), ['39.00']);
  });

  it('still reads a product that is the main entity of the page', () => {
    const { sightings } = run(
      body(`
        <div itemscope itemtype="https://schema.org/WebPage">
          <div itemprop="mainEntity" itemscope itemtype="https://schema.org/Product">
            <span itemprop="name">Linen Tee</span>
            <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
              <meta itemprop="priceCurrency" content="USD"><meta itemprop="price" content="39.00">
            </div>
          </div>
        </div>`),
    );
    assert.deepEqual(sightings.map((s) => s.price?.raw), ['39.00']);
  });
});
