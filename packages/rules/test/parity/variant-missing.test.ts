import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/variant-missing.ts';
import { brief, run, runFull, variant, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/belt/';
const platform3 = () => [
  variant('platform', { sku: 'BELT-32', variantId: '901', productId: '900', url: URL }),
  variant('platform', { sku: 'BELT-34', variantId: '902', productId: '900', url: URL }),
  variant('platform', { sku: 'BELT-36', variantId: '903', productId: '900', url: URL }),
];

test('JSON-LD listing one of three sizes is reported for the other two', () => {
  const findings = run(rule, [...platform3(), variant('jsonld', { sku: 'BELT-32', url: URL })]);
  assert.deepEqual(brief(findings), [
    { variant: 'BELT-34', surface: 'jsonld' },
    { variant: 'BELT-36', surface: 'jsonld' },
  ]);
  assert.equal(findings[0]!.product, 'shop.example/product/belt');
  assert.equal(findings[0]!.message, 'missing from jsonld, which lists 1 of 3 variants');
});

test('JSON-LD listing all three sizes is silent', () => {
  const findings = run(rule, [
    ...platform3(),
    variant('jsonld', { sku: 'BELT-32', url: URL }),
    variant('jsonld', { sku: 'BELT-34', url: URL }),
    variant('jsonld', { sku: 'BELT-36', url: URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('JSON-LD with only a product-level statement, and no variant, is silent', () => {
  const findings = run(rule, [...platform3(), whole('jsonld', URL)]);
  assert.deepEqual(findings, []);
});

test('a feed listing one of three sizes is silent, because feeds are exempt', () => {
  const findings = run(rule, [...platform3(), variant('feed', { sku: 'BELT-32', url: URL })]);
  assert.deepEqual(findings, []);
});

test('a single-variant product can never be partial', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'BELT-32', variantId: '901', productId: '900', url: URL }),
    variant('jsonld', { sku: 'BELT-32', url: URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('two surfaces partial at once each report their own gaps', () => {
  const findings = run(rule, [
    ...platform3(),
    variant('jsonld', { sku: 'BELT-32', url: URL }),
    variant('ucp', { sku: 'BELT-34', url: URL }),
  ]);
  assert.deepEqual(brief(findings), [
    { variant: 'BELT-32', surface: 'ucp' },
    { variant: 'BELT-34', surface: 'jsonld' },
    { variant: 'BELT-36', surface: 'jsonld' },
    { variant: 'BELT-36', surface: 'ucp' },
  ]);
});

test('a JSON-LD variant that is not real does not count as listing a real one', () => {
  const alone = run(rule, [
    variant('platform', { sku: 'BELT-32', variantId: '901', productId: '900', url: URL }),
    variant('platform', { sku: 'BELT-34', variantId: '902', productId: '900', url: URL }),
    variant('jsonld', { sku: 'BELT-99', url: URL }),
  ]);
  assert.deepEqual(alone, []);

  const beside = run(rule, [...platform3(), variant('jsonld', { sku: 'BELT-32', url: URL }), variant('jsonld', { sku: 'BELT-99', url: URL })]);
  assert.deepEqual(brief(beside), [
    { variant: 'BELT-34', surface: 'jsonld' },
    { variant: 'BELT-36', surface: 'jsonld' },
  ]);
});

test('skipped when neither platform nor checkout was collected', () => {
  const r = runFull(rule, [variant('jsonld', { sku: 'BELT-32', url: URL }), variant('feed', { sku: 'BELT-34', url: URL })]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.rules[0]!.skipped, 'needs one of platform, checkout');
});
