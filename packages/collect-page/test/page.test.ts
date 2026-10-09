import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import { extractJsonLd, extractMicrodata, extractOpenGraph, extractPage, extractText, extractVisible } from '../src/index.ts';

const url = 'https://shop.example/product/mug';
const at = '2026-10-09T12:00:00Z';
const html = `<main>
  <h1>Enamel mug</h1>
  <div class="summary"><p class="price">$12.00</p><p class="stock in-stock">In stock</p></div>
  <div class="product__description">A durable mug. <span hidden>Hidden note</span></div>
  <meta property="product:price:amount" content="12.00">
  <meta property="product:price:currency" content="USD">
  <div itemscope itemtype="https://schema.org/Product">
    <meta itemprop="sku" content="MUG">
    <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
      <meta itemprop="price" content="12.00"><meta itemprop="priceCurrency" content="USD">
    </div>
  </div>
  <script type="application/ld+json">{"@type":"Product","sku":"MUG","offers":{"@type":"Offer","price":"12.00","priceCurrency":"USD"}}</script>
</main>`;

test('extractors can share a document without changing it or each other’s evidence', () => {
  const document = load(html);
  const original = document.html();
  for (const extract of [extractJsonLd, extractMicrodata, extractOpenGraph]) {
    assert.deepEqual(extract(document, url, at), extract(html, url, at));
  }
  assert.deepEqual(extractVisible(document, url, at), extractVisible(html, url, at));
  assert.deepEqual(extractText(document, url), extractText(html, url));
  assert.equal(document.html(), original);
});

test('whole-page extraction preserves independent prices and infers the visible currency', () => {
  const result = extractPage(html, url, at);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings.map((s) => s.surface), ['page', 'jsonld', 'microdata', 'opengraph']);
  for (const sighting of result.sightings) assert.deepEqual(sighting.price?.value, { units: 120000, currency: 'USD' });
  assert.ok(result.sightings[0]?.text?.some((t) => t.text === 'Hidden note' && t.hidden));
});
