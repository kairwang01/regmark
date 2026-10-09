import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/shipping-mismatch.ts';
import { brief, run, runFull, shipping, variant } from '../helpers.ts';

const URL = 'https://shop.example/product/tee/';
const checkout = (quote: Parameters<typeof shipping>[1], extra: Parameters<typeof shipping>[2] = {}) =>
  variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { shipping: shipping('checkout', quote, extra) });
const feed = (quote: Parameters<typeof shipping>[1], extra: Parameters<typeof shipping>[2] = {}) =>
  variant('feed', { sku: 'TEE-M', url: URL }, { shipping: shipping('feed', quote, extra) });

test('a feed that says shipping is free when checkout charges 6.20 is reported', () => {
  const findings = run(rule, [checkout('6.20'), feed('0.00')]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'feed' }]);
  assert.equal(findings[0]!.expected!.value, '6.20 USD');
  assert.equal(findings[0]!.actual!.value, 'free');
});

test('a shipping cost that agrees with checkout is silent', () => {
  assert.deepEqual(run(rule, [checkout('6.20'), feed('6.20')]), []);
});

test('a quote for a different country is not compared', () => {
  assert.deepEqual(run(rule, [checkout('6.20', { country: 'US' }), feed('0.00', { country: 'CA' })]), []);
});

test('a quote with no country is compared with the checkout quote', () => {
  assert.deepEqual(brief(run(rule, [checkout('6.20', { country: 'US' }), feed('0.00')])), [{ variant: 'TEE-M', surface: 'feed' }]);
});

test('country codes are compared without regard to case', () => {
  assert.deepEqual(brief(run(rule, [checkout('6.20', { country: 'US' }), feed('0.00', { country: 'us' })])), [
    { variant: 'TEE-M', surface: 'feed' },
  ]);
});

test('a conditional quote, such as one with a minimum spend, is silent', () => {
  assert.deepEqual(run(rule, [checkout('6.20'), feed('0.00', { conditional: true })]), []);
});

test('a free quote with no stated cost is compared with a paid checkout', () => {
  const findings = run(rule, [checkout('6.20'), variant('feed', { sku: 'TEE-M', url: URL }, { shipping: shipping('feed', null, { free: true }) })]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'feed' }]);
});

test('no stated cost and not free is silent', () => {
  assert.deepEqual(
    run(rule, [checkout('6.20'), variant('feed', { sku: 'TEE-M', url: URL }, { shipping: shipping('feed', null, { free: false }) })]),
    [],
  );
});

test('a checkout that is free when the feed charges 6.20 is reported', () => {
  const findings = run(rule, [checkout('0.00'), feed('6.20')]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'feed' }]);
  assert.equal(findings[0]!.expected!.value, 'free');
  assert.equal(findings[0]!.actual!.value, '6.20 USD');
});

test('the rule is skipped when checkout was not collected', () => {
  const result = runFull(rule, [feed('0.00')]);
  assert.ok(result.rules[0]!.skipped);
  assert.deepEqual(result.findings, []);
});
