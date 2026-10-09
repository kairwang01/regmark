import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/price-currency-ambiguous.ts';
import { brief, price, run, variant, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/tee/';

test('a JSON-LD price with no currency is reported against a USD checkout', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00', 'USD') }),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00', null) }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'jsonld' }]);
  assert.equal(findings[0]!.message, 'jsonld gives 39.00 with no currency');
});

test('a feed price in CAD is reported against a USD checkout', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00', 'USD') }),
    variant('feed', { sku: 'TEE-M', url: URL }, { price: price('feed', '39.00', 'CAD') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'feed' }]);
  assert.equal(findings[0]!.actual!.value, '39.00 CAD');
  assert.equal(findings[0]!.expected!.value, '39.00 USD');
});

test('a product-level OpenGraph price in CAD is reported without a variant', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00', 'USD') }),
    whole('opengraph', URL, { price: price('opengraph', '39.00', 'CAD') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'opengraph' }]);
});

test('a page price with no currency is exempt', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00', 'USD') }),
      variant('page', { sku: 'TEE-M', url: URL }, { price: price('page', '39.00', null) }),
    ]),
    [],
  );
});

test('a machine price in the same currency as the datum is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00', 'USD') }),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '35.00', 'USD') }),
      whole('opengraph', URL, { price: price('opengraph', '39.00', 'USD') }),
    ]),
    [],
  );
});

test('a datum with no currency gives nothing to compare with', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00', null) }),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00', 'CAD') }),
    ]),
    [],
  );
});

test('no datum at all is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00', 'CAD') }),
      variant('feed', { sku: 'TEE-M', url: URL }, { price: price('feed', '39.00', 'USD') }),
    ]),
    [],
  );
});
