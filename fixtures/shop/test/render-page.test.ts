import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShop } from '../src/shop.ts';
import type { Shop } from '../src/shop.ts';
import { renderHome, renderProductPage, renderRobots, renderSitemap } from '../src/render-page.ts';

const NOW = new Date('2026-10-09T00:00:00Z');
const ORIGIN = 'http://shop.test';

const clean = buildShop('clean', NOW);
const misprint = buildShop('misprint', NOW);

function page(shop: Shop, slug: string): string {
  const html = renderProductPage(shop, slug, ORIGIN);
  assert.notEqual(html, null, `page for ${slug}`);
  return html!;
}

/** The JSON-LD block of a page, parsed. */
function jsonLd(html: string): any {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'JSON-LD block present');
  return JSON.parse(m[1]!);
}

const count = (haystack: string, re: RegExp) => (haystack.match(re) ?? []).length;

test('single-shape page: enamel mug', () => {
  const html = page(clean, 'enamel-mug');
  assert.ok(html.includes('<h1 class="product_title entry-title">Enamel Mug</h1>'));
  assert.ok(
    html.includes(
      '<p class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>16.00</bdi></span></p>',
    ),
  );
  assert.ok(!html.includes('<del'), 'no sale markup when not on sale');
  assert.ok(html.includes('<p class="stock in-stock">In stock</p>'));
  assert.ok(html.includes('<meta property="og:type" content="product">'));
  assert.ok(html.includes('<meta property="og:title" content="Enamel Mug">'));
  assert.ok(html.includes('<meta property="og:url" content="http://shop.test/product/enamel-mug/">'));
  assert.ok(html.includes('<meta property="product:price:amount" content="16.00">'));
  assert.ok(html.includes('<meta property="product:price:currency" content="USD">'));
  assert.ok(html.includes('<meta property="product:availability" content="in stock">'));

  const g = jsonLd(html);
  assert.equal(g['@type'], 'Product');
  assert.equal(g.sku, 'MUG-WHT');
  assert.match(g.gtin13, /^\d{13}$/);
  assert.equal(g.mpn, 'NF-MUG-WHT');
  assert.deepEqual(g.brand, { '@type': 'Brand', name: 'Northfold' });
  assert.equal(g.url, 'http://shop.test/product/enamel-mug/');
  assert.equal(g.offers['@type'], 'Offer');
  assert.equal(g.offers.price, '16.00');
  assert.equal(g.offers.priceCurrency, 'USD');
  assert.equal(g.offers.availability, 'https://schema.org/InStock');
  assert.equal(g.offers.url, 'http://shop.test/product/enamel-mug/');
  assert.equal(g.offers.shippingDetails.shippingRate.value, '6.20');
  assert.equal(g.offers.shippingDetails.shippingRate.currency, 'USD');
  assert.equal(g.offers.hasMerchantReturnPolicy.merchantReturnDays, 30);
  assert.equal('priceValidUntil' in g.offers, false, 'no sale end on a regular price');
});

test('offers-shape page: wool beanie', () => {
  const html = page(clean, 'wool-beanie');
  assert.ok(html.includes('<h1 class="product_title entry-title">Wool Beanie</h1>'));
  assert.ok(html.includes('<p class="stock in-stock">In stock</p>'), 'stock follows the first variant');

  const g = jsonLd(html);
  assert.equal(g['@type'], 'Product');
  assert.equal(g.offers.length, 2);
  const [grey, navy] = g.offers;
  assert.equal(grey.sku, 'BEANIE-GRY');
  assert.equal(grey.url, 'http://shop.test/product/wool-beanie/?attribute_pa_color=grey');
  assert.match(grey.gtin13, /^\d{13}$/);
  assert.equal(grey.mpn, 'NF-BEANIE-GRY');
  assert.equal(grey.price, '28.00');
  assert.equal(grey.priceCurrency, 'USD');
  assert.equal(grey.availability, 'https://schema.org/InStock');
  assert.equal(navy.sku, 'BEANIE-NVY');
  assert.equal(navy.url, 'http://shop.test/product/wool-beanie/?attribute_pa_color=navy');
  assert.equal(navy.availability, 'https://schema.org/OutOfStock');
});

test('group-shape page: classic tee with sale markup and sale end date', () => {
  const html = page(clean, 'classic-tee');
  assert.ok(html.includes('<del aria-hidden="true">'));
  assert.ok(html.includes('<ins aria-hidden="true">'));
  assert.ok(html.includes('Original price was: 45.00.'));
  assert.ok(html.includes('Current price is: 39.00.'));
  assert.ok(html.includes('<p class="stock in-stock">In stock</p>'));
  assert.ok(html.includes('<meta property="product:price:amount" content="39.00">'));

  const g = jsonLd(html);
  assert.equal(g['@type'], 'ProductGroup');
  assert.equal(g.productGroupID, 'classic-tee');
  assert.deepEqual(g.variesBy, ['https://schema.org/size']);
  assert.equal(g.hasVariant.length, 3);
  const m = g.hasVariant[1];
  assert.equal(m['@type'], 'Product');
  assert.equal(m.name, 'Classic Tee - M');
  assert.equal(m.size, 'M');
  assert.equal(m.sku, 'TEE-BLU-M');
  assert.match(m.gtin13, /^\d{13}$/);
  assert.equal(m.offers.url, 'http://shop.test/product/classic-tee/?attribute_pa_size=m');
  assert.equal(m.offers.price, '39.00');
  assert.equal(m.offers.priceCurrency, 'USD');
  assert.equal(m.offers.priceValidUntil, '2026-12-08');
  assert.equal(m.offers.shippingDetails.shippingRate.value, '6.20');
  assert.equal(m.offers.hasMerchantReturnPolicy.merchantReturnDays, 30);
});

test('priceValidUntil appears only on sale products', () => {
  for (const slug of ['enamel-mug', 'canvas-tote', 'wool-beanie', 'trail-socks', 'field-cap', 'desk-lamp', 'leather-belt', 'linen-apron']) {
    assert.equal(page(clean, slug).includes('priceValidUntil'), false, slug);
  }
  assert.ok(page(clean, 'rain-shell').includes('"priceValidUntil":"2026-12-08"'));
});

test('shipping rate is free at 129.00 and the flat rate at 39.00', () => {
  const shell = jsonLd(page(clean, 'rain-shell'));
  assert.equal(shell.hasVariant[0].offers.shippingDetails.shippingRate.value, '0.00');
  const tee = jsonLd(page(clean, 'classic-tee'));
  assert.equal(tee.hasVariant[0].offers.shippingDetails.shippingRate.value, '6.20');
});

test('variations form appears only where the product has options', () => {
  const tee = page(clean, 'classic-tee');
  assert.ok(tee.includes('<form class="variations_form cart"><table class="variations">'));
  assert.ok(tee.includes('<select id="pa_size" name="attribute_pa_size">'));
  assert.equal(count(tee, /<option value="[^"]+">/g), 3);
  assert.equal(page(clean, 'enamel-mug').includes('variations_form'), false);
});

test('related products wrap around from the last product to the first two', () => {
  const html = page(clean, 'linen-apron');
  const section = html.match(/<section class="related products">([\s\S]*?)<\/section>/);
  assert.ok(section, 'related section present');
  const body = section[1]!;
  assert.ok(body.includes('href="http://shop.test/product/classic-tee/"'));
  assert.ok(body.includes('href="http://shop.test/product/canvas-tote/"'));
  assert.equal(count(body, /<li class="product">/g), 2);
  assert.ok(body.includes('<span class="price">'));
  assert.equal(body.includes('<p class="price">'), false);
});

test('unknown slug returns null, including a feed ghost slug', () => {
  assert.equal(renderProductPage(clean, 'no-such-product', ORIGIN), null);
  assert.equal(renderProductPage(misprint, 'discontinued-scarf', ORIGIN), null);
});

test('D01: JSON-LD gives the regular price for TEE-BLU-M', () => {
  const html = page(misprint, 'classic-tee');
  const m = jsonLd(html).hasVariant.find((x: any) => x.sku === 'TEE-BLU-M');
  assert.equal(m.offers.price, '45.00');
  assert.equal('priceValidUntil' in m.offers, false);
  assert.ok(html.includes('Current price is: 39.00.'), 'visible price is unchanged');
});

test('D03: og:price on the mug page is stale', () => {
  assert.ok(page(misprint, 'enamel-mug').includes('<meta property="product:price:amount" content="14.00">'));
});

test('D05: JSON-LD says SOCK-L is in stock', () => {
  const m = jsonLd(page(misprint, 'trail-socks')).hasVariant.find((x: any) => x.sku === 'SOCK-L');
  assert.equal(m.offers.availability, 'https://schema.org/InStock');
});

test('D06: JSON-LD on the belt page lists one of three sizes, the form still shows three', () => {
  const html = page(misprint, 'leather-belt');
  assert.equal(jsonLd(html).hasVariant.length, 1);
  assert.equal(count(html, /<option value="[^"]+">/g), 3);
});

test('D07: the apron offer has no priceCurrency key', () => {
  const g = jsonLd(page(misprint, 'linen-apron'));
  assert.equal(g.offers.price, '34.00');
  assert.equal('priceCurrency' in g.offers, false);
});

test('D08: og:price:currency on the cap page is CAD', () => {
  assert.ok(page(misprint, 'field-cap').includes('<meta property="product:price:currency" content="CAD">'));
});

test('D09: the rain shell sale end is in the past', () => {
  const g = jsonLd(page(misprint, 'rain-shell'));
  for (const v of g.hasVariant) assert.equal(v.offers.priceValidUntil, '2026-07-01');
});

test('D11: the mug offer has no shippingDetails', () => {
  assert.equal('shippingDetails' in jsonLd(page(misprint, 'enamel-mug')).offers, false);
});

test('D13: the tote GTIN differs from the clean shop', () => {
  const bad = jsonLd(page(misprint, 'canvas-tote')).gtin13;
  const good = jsonLd(page(clean, 'canvas-tote')).gtin13;
  assert.match(bad, /^\d{13}$/);
  assert.notEqual(bad, good);
});

test('D16: the beanie page carries display:none text', () => {
  assert.ok(page(misprint, 'wool-beanie').includes('<span style="display:none">'));
});

test('D17: the lamp page has a second review', () => {
  assert.equal(count(page(misprint, 'desk-lamp'), /<li class="review">/g), 2);
  assert.equal(count(page(clean, 'desk-lamp'), /<li class="review">/g), 1);
});

test('D18: the tote page carries invisible Unicode characters', () => {
  const html = page(misprint, 'canvas-tote');
  assert.ok(html.includes('​'));
  assert.ok(html.includes('\u{E0062}'));
});

test('D19: the apron offer has no merchant return policy', () => {
  assert.equal('hasMerchantReturnPolicy' in jsonLd(page(misprint, 'linen-apron')).offers, false);
});

test('review text is escaped', () => {
  const hand = structuredClone(clean);
  hand.products.find((p) => p.slug === 'desk-lamp')!.page.reviews.push('<b>&');
  const html = page(hand, 'desk-lamp');
  assert.ok(html.includes('&lt;b&gt;&amp;'));
  assert.equal(html.includes('<b>&'), false);
});

test('JSON-LD never contains a raw closing script tag', () => {
  const hand = structuredClone(clean);
  const p = hand.products.find((x) => x.slug === 'enamel-mug')!;
  p.title = 'Mug </script><script>alert(1)</script>';
  p.page.title = p.title;
  const html = page(hand, 'enamel-mug');
  assert.equal(html.split('</script>').length - 1, 1, 'only the JSON-LD block closes its script');
  assert.equal(jsonLd(html).name, p.title);
});

test('home, sitemap and robots', () => {
  for (const shop of [clean, misprint]) {
    assert.equal(count(renderSitemap(shop, ORIGIN), /<loc>/g), 10);
  }
  const home = renderHome(clean, ORIGIN);
  assert.ok(home.includes('<title>Northfold</title>'));
  assert.ok(home.includes('<h1>Northfold</h1>'));
  assert.equal(count(home, /href="http:\/\/shop\.test\/product\//g), 10);

  const robots = renderRobots(ORIGIN);
  assert.ok(robots.includes('Disallow: /*?add-to-cart='));
  assert.ok(robots.includes('Sitemap: http://shop.test/sitemap.xml'));
});
