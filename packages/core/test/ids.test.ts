import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gtinKey, isValidGtin, normalizeGtin, optionName, optionsKey, urlKey } from '../src/index.ts';

test('normalizeGtin() accepts the four GTIN lengths and nothing else', () => {
  assert.equal(normalizeGtin('0 12345-67890 5'), '012345678905');
  assert.equal(normalizeGtin('4006381333931'), '4006381333931');
  assert.equal(normalizeGtin('12345'), null);
  assert.equal(normalizeGtin('ABC4006381333931'), null);
  assert.equal(normalizeGtin(undefined), null);
});

test('isValidGtin() applies the GS1 check digit', () => {
  for (const good of ['4006381333931', '012345678905', '73513537', '00012345600012', '9780306406157']) assert.ok(isValidGtin(good), good);
  for (const bad of ['4006381333932', '012345678906', '73513538', '1234']) assert.ok(!isValidGtin(bad), bad);
});

test('gtinKey() makes a UPC-A equal to its EAN-13 and GTIN-14 forms', () => {
  assert.equal(gtinKey('012345678905'), gtinKey('0012345678905'));
  assert.equal(gtinKey('012345678905'), '00012345678905');
});

test('urlKey() ignores scheme, www, trailing slash, variant query and fragment', () => {
  const k = 'shop.example/product/blue-tee';
  assert.equal(urlKey('https://shop.example/product/blue-tee/'), k);
  assert.equal(urlKey('http://www.shop.example/product/blue-tee?variant=12#reviews'), k);
  assert.equal(urlKey('/product/blue-tee/', new URL('https://shop.example')), k);
  assert.equal(urlKey('https://shop.example:8443/product/blue-tee'), 'shop.example:8443/product/blue-tee');
  assert.equal(urlKey('mailto:a@b.c'), null);
  assert.equal(urlKey(''), null);
});

test('urlKey() preserves product identity in plain permalinks', () => {
  assert.equal(urlKey('https://shop.example/?p=100&utm_source=feed&attribute_size=M'), 'shop.example?p=100');
  assert.notEqual(urlKey('https://shop.example/?p=100'), urlKey('https://shop.example/?p=200'));
  assert.equal(urlKey('https://shop.example/?product=tee&variant=10'), 'shop.example?product=tee');
  assert.equal(urlKey('https://shop.example/?product_id=100#reviews'), 'shop.example?product_id=100');
});

test('optionName() strips storefront decoration', () => {
  assert.equal(optionName('attribute_pa_Size'), 'size');
  assert.equal(optionName('Colour'), 'color');
  assert.equal(optionName('pa_shoe-width'), 'shoe width');
});

test('optionsKey() is order-independent and case-insensitive', () => {
  assert.equal(optionsKey({ Size: 'M', Color: 'Blue' }), optionsKey({ pa_color: 'blue', attribute_pa_size: 'm' }));
  assert.equal(optionsKey({ Size: 'M', Color: 'Blue' }), 'color=blue|size=m');
  assert.equal(optionsKey(undefined), '');
});
