import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/variant-unpurchasable.ts';
import { bought, brief, run, runFull, stock, variant } from '../helpers.ts';

const URL = 'https://shop.example/product/tee/';
const ids = { sku: 'TEE-M', variantId: '1', productId: '9', url: URL };

test('checkout refuses while the storefront and a feed say in stock fires once, with no surface', () => {
  const findings = run(rule, [
    variant('platform', ids, { availability: stock('platform', 'in_stock') }),
    variant('checkout', ids, { purchasable: bought(false) }),
    variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'in_stock') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: undefined }]);
  assert.ok(findings[0]!.actual!.value.startsWith('refused:'));
  assert.equal(findings[0]!.actual!.surface, 'checkout');
});

test('checkout refuses but the storefront says out of stock is silent', () => {
  const findings = run(rule, [
    variant('platform', ids, { availability: stock('platform', 'out_of_stock') }),
    variant('checkout', ids, { purchasable: bought(false) }),
    variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'in_stock') }),
  ]);
  assert.deepEqual(findings, []);
});

test('checkout refuses, no platform observation, but jsonld says in stock fires', () => {
  const findings = run(rule, [
    variant('platform', ids),
    variant('checkout', ids, { purchasable: bought(false) }),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { availability: stock('jsonld', 'in_stock') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: undefined }]);
});

test('checkout refuses and nothing else says buyable is silent', () => {
  const findings = run(rule, [
    variant('platform', ids),
    variant('checkout', ids, { purchasable: bought(false) }),
    variant('feed', { sku: 'TEE-M', url: URL }, { availability: stock('feed', 'unknown') }),
  ]);
  assert.deepEqual(findings, []);
});

test('checkout accepts the item is silent', () => {
  const findings = run(rule, [
    variant('platform', ids, { availability: stock('platform', 'in_stock') }),
    variant('checkout', ids, { purchasable: bought(true) }),
  ]);
  assert.deepEqual(findings, []);
});

test('skipped without checkout', () => {
  const r = runFull(rule, [variant('platform', ids, { availability: stock('platform', 'in_stock') })]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.rules[0]!.skipped, 'needs checkout');
});
