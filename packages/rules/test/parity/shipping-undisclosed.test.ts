import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/shipping-undisclosed.ts';
import { brief, run, runFull, shipping, variant } from '../helpers.ts';

const URL = 'https://shop.example/product/tee/';
const checkout = (quote: Parameters<typeof shipping>[1]) =>
  variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { shipping: shipping('checkout', quote) });

test('a paid checkout shipping cost that no other surface states is reported once, without a surface', () => {
  const findings = run(rule, [checkout('6.20')]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: undefined }]);
  assert.equal(findings[0]!.actual!.value, '6.20 USD');
  assert.equal(findings[0]!.severity, 'warn');
});

test('a JSON-LD shipping cost on the page makes the cost disclosed', () => {
  assert.deepEqual(
    run(rule, [
      checkout('6.20'),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { shipping: shipping('jsonld', '6.20') }),
    ]),
    [],
  );
});

test('a page shipping statement counts as disclosure, even when it disagrees', () => {
  assert.deepEqual(
    run(rule, [
      checkout('6.20'),
      variant('page', { sku: 'TEE-M', url: URL }, { shipping: shipping('page', '0.00') }),
    ]),
    [],
  );
});

test('free shipping at checkout is silent', () => {
  assert.deepEqual(run(rule, [checkout('0.00')]), []);
});

test('a checkout with no stated cost is silent', () => {
  assert.deepEqual(run(rule, [checkout(null)]), []);
});

test('a shipping object with neither a cost nor free shipping leaves the cost undisclosed', () => {
  const findings = run(rule, [
    checkout('6.20'),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { shipping: shipping('jsonld', null) }),
  ]);
  assert.equal(findings.length, 1);
});

test('an explicit free shipping statement with no number counts as disclosure', () => {
  assert.deepEqual(run(rule, [
    checkout('6.20'),
    variant('jsonld', { sku: 'TEE-M', url: URL }, { shipping: shipping('jsonld', null, { free: true }) }),
  ]), []);
});

test('a quote for another destination does not disclose the checkout destination cost', () => {
  const findings = run(rule, [
    variant('checkout', { sku: 'TEE-M', url: URL }, { shipping: shipping('checkout', '6.20', { country: 'US' }) }),
    variant('feed', { sku: 'TEE-M', url: URL }, { shipping: shipping('feed', '6.20', { country: 'CA' }) }),
  ]);
  assert.equal(findings.length, 1);
});

test('the rule is skipped when checkout was not collected', () => {
  const result = runFull(rule, [
    variant('feed', { sku: 'TEE-M', url: URL }, { shipping: shipping('feed', '6.20') }),
  ]);
  assert.ok(result.rules[0]!.skipped);
  assert.deepEqual(result.findings, []);
});
