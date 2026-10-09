import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/price-sale-expired.ts';
import { brief, price, run, until, variant } from '../helpers.ts';

const URL = 'https://shop.example/product/tee/';

/** A checkout that charges 39.00, and a JSON-LD sale that ended on `date`. */
const sale = (date: string, amount = '39.00') => [
  variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
  variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', amount), priceValidUntil: until('jsonld', date) }),
];

test('a sale that ended well before today, still shown at the datum price, is reported', () => {
  const findings = run(rule, sale('2026-07-01'));
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'jsonld' }]);
  assert.equal(findings[0]!.actual!.value, '2026-07-01');
  assert.equal(findings[0]!.severity, 'warn');
});

test('a sale that ends later than today is silent', () => {
  assert.deepEqual(run(rule, sale('2026-12-31')), []);
});

test('a bare date of today has not expired', () => {
  assert.deepEqual(run(rule, sale('2026-10-09')), []);
});

test('a bare date of yesterday has expired', () => {
  assert.deepEqual(brief(run(rule, sale('2026-10-08'))), [{ variant: 'TEE-M', surface: 'jsonld' }]);
});

test('a datetime earlier today is silent, because it is the same UTC day', () => {
  assert.deepEqual(run(rule, sale('2026-10-09T03:00:00Z')), []);
});

test('a datetime late yesterday has expired', () => {
  assert.deepEqual(brief(run(rule, sale('2026-10-08T23:59:59Z'))), [{ variant: 'TEE-M', surface: 'jsonld' }]);
});

test('a stated price that no longer matches the datum is silent (price.mismatch reports it)', () => {
  assert.deepEqual(run(rule, sale('2026-07-01', '35.00')), []);
});

test('an end date with no price on the same surface is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
      variant('jsonld', { sku: 'TEE-M', url: URL }, { priceValidUntil: until('jsonld', '2026-07-01') }),
    ]),
    [],
  );
});

test('a date that cannot be parsed is silent', () => {
  assert.deepEqual(run(rule, sale('soon')), []);
  assert.deepEqual(run(rule, sale('2026-02-30')), []);
});

test('an end date with no datum for the price is silent', () => {
  assert.deepEqual(
    run(rule, [
      variant('jsonld', { sku: 'TEE-M', url: URL }, { price: price('jsonld', '39.00'), priceValidUntil: until('jsonld', '2026-07-01') }),
    ]),
    [],
  );
});

test('an ACP sale still offered at the datum price after the end of its window is reported, the end read as an instant', () => {
  // The ACP collector keeps a timed window's end as a UTC instant, since its sale dates schedule nothing.
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('acp', { aliases: ['TEE-M'], url: URL }, { price: price('acp', '39.00'), priceValidUntil: until('acp', '2026-10-07T23:59:59.000Z') }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-M', surface: 'acp' }]);
});

test('an ACP sale whose window ends later today is silent', () => {
  const findings = run(rule, [
    variant('checkout', { variantId: '101', sku: 'TEE-M', url: URL }, { price: price('checkout', '39.00') }),
    variant('acp', { aliases: ['TEE-M'], url: URL }, { price: price('acp', '39.00'), priceValidUntil: until('acp', '2026-10-09T23:59:59.000Z') }),
  ]);
  assert.deepEqual(findings, []);
});
