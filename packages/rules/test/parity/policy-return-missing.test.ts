import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/policy-return-missing.ts';
import { obs, returns, run, runFull, variant, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/belt/';
const ids = { sku: 'BELT-34', variantId: '902', productId: '900', url: URL };

test('a real product with no return policy anywhere fires once, for the product', () => {
  const findings = run(rule, [variant('platform', ids), variant('jsonld', { sku: 'BELT-34', url: URL })]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.variant, undefined);
  assert.equal(findings[0]!.surface, undefined);
  assert.equal(findings[0]!.product, 'shop.example/product/belt');
});

test('a policy on one variant jsonld sighting is silent', () => {
  const findings = run(rule, [
    variant('platform', ids),
    variant('jsonld', { sku: 'BELT-34', url: URL }, { returnPolicy: returns('jsonld') }),
  ]);
  assert.deepEqual(findings, []);
});

test('a policy on a product-level sighting is silent', () => {
  const findings = run(rule, [variant('platform', ids), whole('jsonld', URL, { returnPolicy: returns('jsonld') })]);
  assert.deepEqual(findings, []);
});

test('a policy that says present: false does not count', () => {
  const findings = run(rule, [
    variant('platform', ids),
    variant('jsonld', { sku: 'BELT-34', url: URL }, { returnPolicy: obs('jsonld', { present: false }, 'none') }),
  ]);
  assert.equal(findings.length, 1);
});

test('a product with no real variant is silent', () => {
  const findings = run(rule, [
    variant('platform', ids),
    variant('feed', { sku: 'OLD-9', url: 'https://shop.example/product/old/' }),
  ]);
  assert.deepEqual(findings.filter((f) => f.product === 'shop.example/product/old'), []);
});

test('skipped when neither platform nor checkout was collected', () => {
  const r = runFull(rule, [variant('jsonld', ids), variant('feed', { sku: 'BELT-34', url: URL })]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.rules[0]!.skipped, 'needs one of platform, checkout');
});
