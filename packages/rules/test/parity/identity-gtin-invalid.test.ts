import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/identity-gtin-invalid.ts';
import { brief, run, variant } from '../helpers.ts';

// 4006381333931 has a valid check digit; 4006381333932 does not.
const VALID = '4006381333931';
const BAD = '4006381333932';
const UPC_A = '036000291452';
const URL = 'https://shop.example/product/belt/';

test('a GTIN-13 with a wrong check digit on jsonld fires, while a correct one on feed does not', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'BELT-34', variantId: '902', productId: '900', url: URL }),
    variant('jsonld', { sku: 'BELT-34', gtin: BAD, url: URL }),
    variant('feed', { sku: 'BELT-34', gtin: VALID, url: URL }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'BELT-34', surface: 'jsonld' }]);
  assert.equal(findings[0]!.actual!.value, BAD);
  assert.equal(findings[0]!.actual!.locator, URL);
});

test('a five-digit GTIN fires', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'CAP-1', variantId: '5', productId: '4', url: URL }),
    variant('feed', { sku: 'CAP-1', gtin: '12345', url: URL }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'CAP-1', surface: 'feed' }]);
});

test('a valid UPC-A is silent', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'CAP-1', variantId: '5', productId: '4', url: URL }),
    variant('feed', { sku: 'CAP-1', gtin: UPC_A, url: URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('the same valid GTIN on two variants in the feed fires for both', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'CAP-RED', variantId: '51', productId: '50', url: URL }),
    variant('platform', { sku: 'CAP-BLK', variantId: '52', productId: '50', url: URL }),
    variant('feed', { aliases: ['CAP-RED'], gtin: VALID, url: URL }),
    variant('feed', { aliases: ['CAP-BLK'], gtin: VALID, url: URL }),
  ]);
  assert.deepEqual(brief(findings), [
    { variant: 'CAP-BLK', surface: 'feed' },
    { variant: 'CAP-RED', surface: 'feed' },
  ]);
});

test('the same GTIN on feed and on jsonld for the same variant is silent', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'CAP-1', variantId: '5', productId: '4', url: URL }),
    variant('feed', { sku: 'CAP-1', gtin: VALID, url: URL }),
    variant('jsonld', { sku: 'CAP-1', gtin: VALID, url: URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('the same GTIN on feed for one variant and on jsonld for another is silent, because surfaces differ', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'CAP-RED', variantId: '51', productId: '50', url: URL }),
    variant('platform', { sku: 'CAP-BLK', variantId: '52', productId: '50', url: URL }),
    variant('feed', { aliases: ['CAP-RED'], gtin: VALID, url: URL }),
    variant('jsonld', { aliases: ['CAP-BLK'], gtin: VALID, url: URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('the same GTIN on two variants of two different products fires for both', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'TEE-A', variantId: '1', productId: '10', url: 'https://shop.example/product/a/' }),
    variant('feed', { sku: 'TEE-A', gtin: VALID, url: 'https://shop.example/product/a/' }),
    variant('platform', { sku: 'TEE-B', variantId: '2', productId: '20', url: 'https://shop.example/product/b/' }),
    variant('feed', { sku: 'TEE-B', gtin: VALID, url: 'https://shop.example/product/b/' }),
  ]);
  assert.deepEqual(brief(findings), [
    { variant: 'TEE-A', surface: 'feed' },
    { variant: 'TEE-B', surface: 'feed' },
  ]);
  assert.deepEqual(findings.map((f) => f.product).sort(), ['shop.example/product/a', 'shop.example/product/b']);
});

test('an invalid GTIN that is also duplicated is reported once per variant, as invalid', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'CAP-RED', variantId: '51', productId: '50', url: URL }),
    variant('platform', { sku: 'CAP-BLK', variantId: '52', productId: '50', url: URL }),
    variant('feed', { aliases: ['CAP-RED'], gtin: BAD, url: URL }),
    variant('feed', { aliases: ['CAP-BLK'], gtin: BAD, url: URL }),
  ]);
  assert.deepEqual(brief(findings), [
    { variant: 'CAP-BLK', surface: 'feed' },
    { variant: 'CAP-RED', surface: 'feed' },
  ]);
  assert.ok(findings.every((f) => f.message.includes('fails its check digit')));
});
