import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVisible } from '../src/visible.ts';

const URL = 'https://shop.example/p/';
const AT = '2026-10-09T00:00:00.000Z';

const run = (html: string, options?: Parameters<typeof extractVisible>[3]) => extractVisible(html, URL, AT, options);

const obs = (value: unknown, raw: string, selector: string) => ({
  value,
  raw,
  surface: 'page',
  locator: `${URL}#css(${selector})`,
  fetchedAt: AT,
});

const WOO_REGULAR = `<p class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>39.00</bdi></span></p>`;

const WOO_SALE = `<p class="price"><del aria-hidden="true"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>45.00</bdi></span></del> <span class="screen-reader-text">Original price was: $45.00.</span><ins aria-hidden="true"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>39.00</bdi></span></ins><span class="screen-reader-text">Current price is: $39.00.</span></p>`;

test('WooCommerce regular price is read with the page currency hint', () => {
  const result = run(`<h1 class="product_title">Blue Mug</h1>${WOO_REGULAR}`, { currency: 'USD' });
  assert.deepEqual(result, {
    sightings: [
      {
        surface: 'page',
        scope: 'product',
        ids: { url: URL },
        title: 'Blue Mug',
        price: obs({ units: 390000, currency: 'USD' }, '$39.00', 'p.price'),
      },
    ],
    issues: [],
  });
});

test('a bare dollar sign leaves the currency null when no hint is given', () => {
  const result = run(WOO_REGULAR);
  assert.deepEqual(result.sightings[0]?.price?.value, { units: 390000, currency: null });
});

test('WooCommerce sale reads the ins as price and the del as list price', () => {
  const result = run(WOO_SALE, { currency: 'USD' });
  assert.deepEqual(result.sightings, [
    {
      surface: 'page',
      scope: 'product',
      ids: { url: URL },
      price: obs({ units: 390000, currency: 'USD' }, '$39.00', 'p.price ins'),
      listPrice: obs({ units: 450000, currency: 'USD' }, '$45.00', 'p.price del'),
    },
  ]);
});

test('WooCommerce price range yields no price and no sighting', () => {
  const result = run('<p class="price"><span>$19.00</span> – <span>$29.00</span></p>', { currency: 'USD' });
  assert.deepEqual(result, { sightings: [], issues: [] });
});

test('WooCommerce sale with two amounts in ins yields no price', () => {
  const result = run('<p class="price"><del>$45.00</del><ins>$39.00 $41.00</ins></p>', { currency: 'USD' });
  assert.deepEqual(result, { sightings: [], issues: [] });
});

test('the summary price wins over a related-products price later in the page', () => {
  const html = `<div class="summary"><p class="price">$39.00</p></div><section class="related"><p class="price">$12.00</p></section>`;
  const result = run(html, { currency: 'USD' });
  assert.deepEqual(result.sightings[0]?.price, obs({ units: 390000, currency: 'USD' }, '$39.00', '.summary p.price'));
});

test('priceSelector with one amount is the price', () => {
  const result = run('<div class="custom-price">Now $12.50</div>', { priceSelector: '.custom-price', currency: 'USD' });
  assert.deepEqual(result.sightings, [
    { surface: 'page', scope: 'product', ids: { url: URL }, price: obs({ units: 125000, currency: 'USD' }, 'Now $12.50', '.custom-price') },
  ]);
});

test('priceSelector with two amounts yields no price', () => {
  const result = run('<div class="custom-price">$12.50 was $15.00</div>', { priceSelector: '.custom-price', currency: 'USD' });
  assert.deepEqual(result, { sightings: [], issues: [] });
});

test('priceSelector overrides the built-in recognisers', () => {
  const result = run(WOO_REGULAR, { priceSelector: '.nothing-here', currency: 'USD' });
  assert.deepEqual(result, { sightings: [], issues: [] });
});

test('Shopify Dawn regular price', () => {
  const html = `<div class="price price--not-on-sale"><div class="price__container"><div class="price__regular"><span class="visually-hidden">Regular price</span><span class="price-item price-item--regular">$39.00</span></div></div></div>`;
  const result = run(html, { currency: 'USD' });
  assert.deepEqual(result.sightings, [
    {
      surface: 'page',
      scope: 'product',
      ids: { url: URL },
      price: obs({ units: 390000, currency: 'USD' }, '$39.00', '.price__regular .price-item--regular'),
    },
  ]);
});

test('Shopify Dawn on sale reads sale and regular items', () => {
  const html = `<div class="price price--on-sale"><div class="price__container"><div class="price__regular"><span class="visually-hidden">Regular price</span><span class="price-item price-item--regular">$45.00</span></div><div class="price__sale"><span class="visually-hidden">Sale price</span><span class="price-item price-item--sale price-item--last">$39.00</span><s class="price-item price-item--regular">$45.00</s></div></div></div>`;
  const result = run(html, { currency: 'USD' });
  assert.deepEqual(result.sightings, [
    {
      surface: 'page',
      scope: 'product',
      ids: { url: URL },
      price: obs({ units: 390000, currency: 'USD' }, '$39.00', '.price__sale .price-item--sale'),
      listPrice: obs({ units: 450000, currency: 'USD' }, '$45.00', '.price__sale .price-item--regular'),
    },
  ]);
});

test('Shopify Dawn sold out sets out_of_stock from the container class', () => {
  const html = `<div class="price price--sold-out"><div class="price__container"><div class="price__regular"><span class="price-item price-item--regular">$39.00</span></div></div></div>`;
  const result = run(html, { currency: 'USD' });
  assert.deepEqual(result.sightings, [
    {
      surface: 'page',
      scope: 'product',
      ids: { url: URL },
      price: obs({ units: 390000, currency: 'USD' }, '$39.00', '.price__regular .price-item--regular'),
      availability: obs('out_of_stock', 'price--sold-out', '.price'),
    },
  ]);
});

test('a Dawn price with two amounts is omitted but the sold-out marker still counts', () => {
  const html = `<div class="price price--sold-out"><div class="price__regular"><span class="price-item price-item--regular">$39.00 $45.00</span></div></div>`;
  const result = run(html, { currency: 'USD' });
  assert.deepEqual(result.sightings, [
    { surface: 'page', scope: 'product', ids: { url: URL }, availability: obs('out_of_stock', 'price--sold-out', '.price') },
  ]);
});

test('a bare dollar sign takes the currency hint', () => {
  const result = run('<p class="price">$39.00</p>', { currency: 'CAD' });
  assert.deepEqual(result.sightings[0]?.price?.value, { units: 390000, currency: 'CAD' });
});

test('text that names its own currency keeps it over the hint', () => {
  const result = run('<p class="price">€39,00</p>', { currency: 'USD' });
  assert.deepEqual(result.sightings[0]?.price, obs({ units: 390000, currency: 'EUR' }, '€39,00', 'p.price'));
});

test('availability from the in-stock class', () => {
  const result = run('<p class="stock in-stock">In stock</p>');
  assert.deepEqual(result.sightings, [
    { surface: 'page', scope: 'product', ids: { url: URL }, availability: obs('in_stock', 'In stock', 'p.stock') },
  ]);
});

test('availability from the out-of-stock class', () => {
  const result = run('<div class="summary"><p class="stock out-of-stock">Out of stock</p></div>');
  assert.deepEqual(result.sightings[0]?.availability, obs('out_of_stock', 'Out of stock', '.summary .stock'));
});

test('availability from the backorder class', () => {
  const result = run('<p class="stock available-on-backorder">Available on backorder</p>');
  assert.deepEqual(result.sightings[0]?.availability, obs('backorder', 'Available on backorder', 'p.stock'));
});

test('availability from text when no class decides', () => {
  assert.equal(run('<p class="stock">Sold out</p>').sightings[0]?.availability?.value, 'out_of_stock');
  assert.equal(run('<p class="stock">Not in stock</p>').sightings[0]?.availability?.value, 'out_of_stock');
  assert.equal(run('<p class="stock">Only 3 in stock</p>').sightings[0]?.availability?.value, 'in_stock');
  assert.equal(run('<p class="stock">Ships on backorder</p>').sightings[0]?.availability?.value, 'backorder');
  assert.equal(run('<p class="stock">Pre-order now</p>').sightings[0]?.availability?.value, 'preorder');
  assert.equal(run('<p class="stock">Preorder</p>').sightings[0]?.availability?.value, 'preorder');
});

test('availability text that decides nothing is omitted', () => {
  assert.deepEqual(run('<p class="stock">Ask us</p>'), { sightings: [], issues: [] });
});

test('explicit availabilitySelector is used first', () => {
  const html = `<p class="stock in-stock">In stock</p><div class="avail">Sold out</div>`;
  const result = run(html, { availabilitySelector: '.avail' });
  assert.deepEqual(result.sightings[0]?.availability, obs('out_of_stock', 'Sold out', '.avail'));
});

test('title: titleSelector beats the product heading', () => {
  const html = `<h1 class="product_title">Shop Title</h1><div class="product-name">Chosen</div><p class="price">$5.00</p>`;
  assert.equal(run(html, { titleSelector: '.product-name', currency: 'USD' }).sightings[0]?.title, 'Chosen');
});

test('title: h1.product_title beats h1[itemprop="name"]', () => {
  const html = `<h1 itemprop="name">Itemprop</h1><h1 class="product_title">Product Title</h1><p class="price">$5.00</p>`;
  assert.equal(run(html).sightings[0]?.title, 'Product Title');
});

test('title: h1[itemprop="name"] beats the h1 inside main', () => {
  const html = `<main><h1>Main H1</h1></main><h1 itemprop="name">Itemprop</h1><p class="price">$5.00</p>`;
  assert.equal(run(html).sightings[0]?.title, 'Itemprop');
});

test('title: the h1 inside main beats an earlier h1 outside it', () => {
  const html = `<h1>Outside</h1><main><h1>Inside</h1></main><p class="price">$5.00</p>`;
  assert.equal(run(html).sightings[0]?.title, 'Inside');
});

test('title: the first h1 is the last resort, and whitespace is collapsed', () => {
  const html = `<h1>  Blue\n\t Mug  </h1><h1>Second</h1><p class="price">$5.00</p>`;
  assert.equal(run(html).sightings[0]?.title, 'Blue Mug');
});

test('a page with nothing recognisable yields no sightings', () => {
  const html = `<html><body><div class="price">$5</div><h1>Only heading</h1></body></html>`;
  assert.deepEqual(run(html), { sightings: [], issues: [] });
});

test('an invalid selector matches nothing rather than throwing', () => {
  assert.deepEqual(run(WOO_REGULAR, { priceSelector: '[' }), { sightings: [], issues: [] });
});
