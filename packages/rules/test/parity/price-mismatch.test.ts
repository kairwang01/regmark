import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/price-mismatch.ts';
import { brief, price, run, variant, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/tee/';

test('a JSON-LD price that differs from the checkout price is reported', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '35.00') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'jsonld' }]);
  assert.equal(findings[0]!.expected!.value, '39.00 USD');
  assert.equal(findings[0]!.actual!.value, '35.00 USD');
  assert.equal(findings[0]!.message, 'jsonld says 35.00 USD, checkout charges 39.00 USD');
});

test('a feed price that differs from the checkout price is reported', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('feed', { sku: 'TEE-M', url: URL }, { price: price('feed', '35.00') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'feed' }]);
});

test('a page price is checked when the datum is the platform', () => {
  const findings = run(rule, [
    variant('platform', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('platform', '39.00') }),
    variant('page', { sku: 'TEE-M', url: URL }, { price: price('page', '35.00') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'page' }]);
});

test('a price that agrees with the datum is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00') }),
    ]),
    [],
  );
});

test('two machine surfaces that disagree with each other, and no datum, is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '35.00') }),
      variant('feed', { sku: 'TEE-M', url: URL }, { price: price('feed', '39.00') }),
    ]),
    [],
  );
});

test('a currency difference is left to price.currency-ambiguous', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00', 'USD') }),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00', 'CAD') }),
    ]),
    [],
  );
});

test('a price with no currency that gives the same amount is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00', null) }),
    ]),
    [],
  );
});

test('a price with no currency that gives a different amount is reported', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '35.00', null) }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'jsonld' }]);
});

test('one finding per surface, even when that surface states two wrong prices', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('feed', { sku: 'TEE-M', url: URL }, { price: price('feed', '35.00') }),
    variant('feed', { sku: 'TEE-M', url: URL }, { price: price('feed', '36.00') }),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '35.00') }),
  ]);
  assert.deepEqual(brief(findings), [
    { variant: 'TEE-M', surface: 'feed' },
    { variant: 'TEE-M', surface: 'jsonld' },
  ]);
  assert.equal(findings[0]!.actual!.value, '35.00 USD');
});

test('checkout beats the platform, and the platform is not checked against it', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
      variant('platform', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('platform', '40.00') }),
    ]),
    [],
  );

  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('platform', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('platform', '40.00') }),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '35.00') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'jsonld' }]);
  assert.equal(findings[0]!.expected!.value, '39.00 USD');
});

test('a product-level price that matches one of the variants is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
      variant('checkout', { variantId: '102', sku: 'TEE-L', url: URL }, { price: price('checkout', '35.00') }),
      whole('opengraph', URL, { price: price('opengraph', '35.00') }),
    ]),
    [],
  );
});

test('a product-level price that matches none of the variants is reported once, without a variant', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('checkout', { variantId: '102', sku: 'TEE-L', url: URL }, { price: price('checkout', '40.00') }),
    whole('opengraph', URL, { price: price('opengraph', '35.00') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'opengraph' }]);
  // Variants are ordered by key, so TEE-L is the "first variant" here.
  assert.equal(findings[0]!.expected!.value, '40.00 USD');
  assert.equal(findings[0]!.actual!.value, '35.00 USD');
});

test('a product-level price is silent when no variant has a price datum', () => {
  assert.deepEqual(
    run(rule, [
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00') }),
      whole('opengraph', URL, { price: price('opengraph', '35.00') }),
    ]),
    [],
  );
});

test('a page product-level price is silent when the only datum is the page itself', () => {
  assert.deepEqual(
    run(rule, [
      variant('page', { sku: 'TEE-M', url: URL }, { price: price('page', '39.00') }),
      whole('page', URL, { price: price('page', '35.00') }),
    ]),
    [],
  );
});

test('a page product-level price is reported when the datum is the checkout', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    whole('page', URL, { price: price('page', '35.00') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'page' }]);
});

// ── No backend: the page is all there is to believe ──────────────────────

const PAGE_URL = 'https://shop.example/product/mug/';

test('read-only: a JSON-LD price that differs from the price on the page is reported once, for the product', () => {
  const findings = run(rule, [
    whole('page', PAGE_URL, { price: price('page', '16.00') }),
    variant('jsonld', { sku: 'MUG-WHT', url: PAGE_URL }, { price: price('jsonld', '14.00') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'jsonld' }]);
  assert.equal(findings[0]!.expected!.surface, 'page');
  assert.equal(findings[0]!.expected!.value, '16.00 USD');
  assert.equal(findings[0]!.actual!.value, '14.00 USD');
});

test('read-only: a surface agrees with the page when any of its offers carries the page price', () => {
  const findings = run(rule, [
    whole('page', PAGE_URL, { price: price('page', '19.00') }),
    variant('jsonld', { sku: 'TEE-S', url: PAGE_URL }, { price: price('jsonld', '19.00') }),
    variant('jsonld', { sku: 'TEE-XL', url: PAGE_URL }, { price: price('jsonld', '22.00') }),
  ]);
  assert.deepEqual(findings, []);
});

test('read-only: each disagreeing surface is reported separately, and a currency difference is left to the currency rule', () => {
  const findings = run(rule, [
    whole('page', PAGE_URL, { price: price('page', '16.00') }),
    whole('opengraph', PAGE_URL, { price: price('opengraph', '14.00') }),
    variant('feed', { aliases: ['MUG-WHT'], url: PAGE_URL }, { price: price('feed', '15.00') }),
    variant('jsonld', { sku: 'MUG-WHT', url: PAGE_URL }, { price: price('jsonld', '16.00', 'CAD') }),
  ]);
  assert.deepEqual(brief(findings), [
    { variant: undefined, surface: 'feed' },
    { variant: undefined, surface: 'opengraph' },
  ]);
});

test('read-only fallback is off as soon as one variant has a backend datum', () => {
  const findings = run(rule, [
    whole('page', PAGE_URL, { price: price('page', '16.00') }),
    variant('platform', { sku: 'MUG-WHT', variantId: '500', productId: '500', url: PAGE_URL }, { price: price('platform', '16.00') }),
    variant('jsonld', { sku: 'MUG-WHT', url: PAGE_URL }, { price: price('jsonld', '14.00') }),
  ]);
  // Reported once, against the platform, for the variant; not a second time against the page.
  assert.deepEqual(brief(findings), [{ variant: 'MUG-WHT', surface: 'jsonld' }]);
  assert.equal(findings[0]!.expected!.surface, 'platform');
});

test('read-only fallback is off when the page is not in the datum order', () => {
  const findings = run(rule, [whole('page', PAGE_URL, { price: price('page', '16.00') }), variant('jsonld', { sku: 'MUG-WHT', url: PAGE_URL }, { price: price('jsonld', '14.00') })], { datum: ['checkout', 'platform'] });
  assert.deepEqual(findings, []);
});
