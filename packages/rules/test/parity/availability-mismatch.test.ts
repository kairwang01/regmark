import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/availability-mismatch.ts';
import { bought, brief, run, stock, variant, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/tee/';
const platform = (sku: string, a: Parameters<typeof stock>[1], variantId = '101') =>
  variant('platform', { variantId, sku, url: URL }, { availability: stock('platform', a) });

test('a feed that says in stock when the platform says out of stock is reported', () => {
  const findings = run(rule, [
    platform('TEE-M', 'out_of_stock'),
    variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'in_stock') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'feed' }]);
  assert.equal(findings[0]!.expected!.value, 'out_of_stock');
  assert.equal(findings[0]!.actual!.value, 'in_stock');
});

test('a feed that says out of stock when the platform says in stock is reported', () => {
  const findings = run(rule, [
    platform('TEE-M', 'in_stock'),
    variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'out_of_stock') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'feed' }]);
});

test('preorder and in stock are both buyable, so they agree', () => {
  assert.deepEqual(
    run(rule, [
      platform('TEE-M', 'in_stock'),
      variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'preorder') }),
    ]),
    [],
  );
});

test('unknown on either side is no statement', () => {
  assert.deepEqual(
    run(rule, [
      platform('TEE-M', 'unknown'),
      variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'in_stock') }),
    ]),
    [],
  );
  assert.deepEqual(
    run(rule, [
      platform('TEE-M', 'out_of_stock'),
      variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'unknown') }),
    ]),
    [],
  );
});

test('without a platform datum, a disagreement between jsonld and feed is silent, even with checkout present', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { purchasable: bought(true) }),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { availability: stock('jsonld', 'in_stock') }),
      variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'out_of_stock') }),
    ]),
    [],
  );
});

test('a page availability is checked when the datum is the platform', () => {
  const findings = run(rule, [
    platform('TEE-M', 'out_of_stock'),
    variant('page', { sku: 'TEE-M', url: URL }, { availability: stock('page', 'in_stock') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'page' }]);
});

test('a product-level in stock while every variant is out of stock is reported once, without a variant', () => {
  const findings = run(rule, [
    platform('TEE-M', 'out_of_stock', '101'),
    platform('TEE-L', 'out_of_stock', '102'),
    whole('opengraph', URL, { availability: stock('opengraph', 'in_stock') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'opengraph' }]);
});

test('a product-level in stock while one of two variants is in stock is silent', () => {
  assert.deepEqual(
    run(rule, [
      platform('TEE-M', 'out_of_stock', '101'),
      platform('TEE-L', 'in_stock', '102'),
      whole('opengraph', URL, { availability: stock('opengraph', 'in_stock') }),
    ]),
    [],
  );
});

// ── No backend: the page is all there is to believe ──────────────────────

const PAGE_URL = 'https://shop.example/product/mug/';

test('read-only: JSON-LD saying in stock while the page shows sold out is reported for the product', () => {
  const findings = run(rule, [
    whole('page', PAGE_URL, { availability: stock('page', 'out_of_stock') }),
    variant('jsonld', { sku: 'MUG-WHT', url: PAGE_URL }, { availability: stock('jsonld', 'in_stock') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'jsonld' }]);
  assert.equal(findings[0]!.expected!.surface, 'page');
});

test('read-only: a surface agrees with the page when any of its variants matches what the page shows', () => {
  const findings = run(rule, [
    whole('page', PAGE_URL, { availability: stock('page', 'in_stock') }),
    variant('jsonld', { sku: 'SOCK-S', url: PAGE_URL }, { availability: stock('jsonld', 'in_stock') }),
    variant('jsonld', { sku: 'SOCK-L', url: PAGE_URL }, { availability: stock('jsonld', 'out_of_stock') }),
  ]);
  assert.deepEqual(findings, []);
});
