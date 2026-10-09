import assert from 'node:assert/strict';
import { test } from 'node:test';
import { money } from '@regmark/core';
import mismatch from '../../src/parity/price-mismatch.ts';
import rule from '../../src/parity/price-tax-basis.ts';
import { taxRateBetween } from '../../src/parity/tax.ts';
import { brief, price, run, variant, whole } from '../helpers.ts';

const URL = 'https://shop.example/store/beach-towel/';

test('taxRateBetween() recognises standard rates in either direction, within a cent', () => {
  assert.equal(taxRateBetween(money('40.86', 'AUD'), money('44.95', 'AUD')), 10);
  assert.equal(taxRateBetween(money('44.95', 'AUD'), money('40.86', 'AUD')), 10);
  assert.equal(taxRateBetween(money('100.00', 'EUR'), money('119.00', 'EUR')), 19);
  assert.equal(taxRateBetween(money('83.33', 'GBP'), money('100.00', 'GBP')), 20);
  assert.equal(taxRateBetween(money('100.00', 'EUR'), money('121.00', null)), 21);
});

test('taxRateBetween() says no for an ordinary gap, for equal amounts, and for currencies that never include tax', () => {
  assert.equal(taxRateBetween(money('39.00', 'EUR'), money('45.00', 'EUR')), null);
  assert.equal(taxRateBetween(money('22.00', 'GBP'), money('24.00', 'GBP')), null);
  assert.equal(taxRateBetween(money('39.00', 'EUR'), money('39.00', 'EUR')), null);
  assert.equal(taxRateBetween(money('100.00', 'USD'), money('110.00', 'USD')), null);
  assert.equal(taxRateBetween(money('100.00', 'CAD'), money('113.00', 'CAD')), null);
  assert.equal(taxRateBetween(money('0', 'EUR'), money('10.00', 'EUR')), null);
});

const taxShop = [
  variant('platform', { sku: 'BT2023', variantId: '7', productId: '7', url: URL }, { price: price('platform', '44.95', 'AUD') }),
  variant('jsonld', { sku: 'BT2023', url: URL }, { price: price('jsonld', '40.86', 'AUD') }),
  whole('page', URL, { price: price('page', '40.86', 'AUD') }),
];

test('a price one GST rate below the datum is a tax-basis warning, for the variant and for the page', () => {
  const findings = run(rule, taxShop);
  assert.deepEqual(brief(findings), [
    { variant: undefined, surface: 'page' },
    { variant: 'BT2023', surface: 'jsonld' },
  ]);
  assert.match(findings[1]!.message, /10% apart/);
  assert.equal(findings[1]!.expected!.value, '44.95 AUD');
});

test('and price.mismatch stays out of it', () => {
  assert.deepEqual(run(mismatch, taxShop), []);
});

test('the same gap in US dollars is a wrong price, not a tax question', () => {
  const usd = [
    variant('platform', { sku: 'BT2023', variantId: '7', productId: '7', url: URL }, { price: price('platform', '44.95') }),
    variant('jsonld', { sku: 'BT2023', url: URL }, { price: price('jsonld', '40.86') }),
  ];
  assert.deepEqual(run(rule, usd), []);
  assert.deepEqual(brief(run(mismatch, usd)), [{ variant: 'BT2023', surface: 'jsonld' }]);
});

test('a gap that is no tax rate is left to price.mismatch', () => {
  const eur = [
    variant('platform', { sku: 'A', variantId: '7', productId: '7', url: URL }, { price: price('platform', '45.00', 'EUR') }),
    variant('jsonld', { sku: 'A', url: URL }, { price: price('jsonld', '39.00', 'EUR') }),
  ];
  assert.deepEqual(run(rule, eur), []);
  assert.equal(run(mismatch, eur).length, 1);
});

test('read-only: a JSON-LD price one VAT rate from the page price is a tax-basis warning', () => {
  const sightings = [whole('page', URL, { price: price('page', '119.00', 'EUR') }), variant('jsonld', { sku: 'A', url: URL }, { price: price('jsonld', '100.00', 'EUR') })];
  assert.deepEqual(brief(run(rule, sightings)), [{ variant: undefined, surface: 'jsonld' }]);
  assert.deepEqual(run(mismatch, sightings), []);
});

test('equal prices are silent', () => {
  assert.deepEqual(run(rule, [taxShop[0]!, variant('jsonld', { sku: 'BT2023', url: URL }, { price: price('jsonld', '44.95', 'AUD') })]), []);
});
