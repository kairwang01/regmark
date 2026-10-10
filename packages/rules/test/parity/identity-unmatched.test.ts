import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/parity/identity-unmatched.ts';
import { brief, run, runFull, variant, whole } from '../helpers.ts';

const SHOP_URL = 'https://shop.example/product/mug/';
const OLD_URL = 'https://shop.example/product/old/';
const CAP_URL = 'https://shop.example/product/tee/';
const mugPlatform = () => variant('platform', { sku: 'MUG-1', variantId: '1', productId: '10', url: SHOP_URL });

test('a feed-only product, while platform was collected for others, is reported once for the product', () => {
  const findings = run(rule, [mugPlatform(), variant('feed', { sku: 'OLD-9', url: OLD_URL })]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'feed' }]);
  assert.equal(findings[0]!.product, 'shop.example/product/old');
});

test('the same feed-only product also seen on a page headline is silent', () => {
  const findings = run(rule, [
    mugPlatform(),
    variant('feed', { sku: 'OLD-9', url: OLD_URL }),
    whole('page', OLD_URL, { title: 'Old thing' }),
  ]);
  assert.deepEqual(findings, []);
});

test('an extra feed-only variant of a real product is reported for that variant', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'TEE-S', variantId: '21', productId: '20', url: CAP_URL }),
    variant('platform', { sku: 'TEE-M', variantId: '22', productId: '20', url: CAP_URL }),
    // The feed names a real variant too, so its extra one is a variant it
    // invented, not a product-level statement.
    variant('feed', { sku: 'TEE-S', url: CAP_URL }),
    variant('feed', { sku: 'TEE-XL', url: CAP_URL }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-XL', surface: 'feed' }]);
});

test('a surface whose only offer matches no real variant is describing the product, and is not reported', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'TEE-S', variantId: '21', productId: '20', url: CAP_URL }),
    variant('platform', { sku: 'TEE-M', variantId: '22', productId: '20', url: CAP_URL }),
    variant('jsonld', { sku: 'TEE', url: CAP_URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('an extra variant seen on feed and jsonld names no single surface', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'TEE-S', variantId: '21', productId: '20', url: CAP_URL }),
    variant('platform', { sku: 'TEE-M', variantId: '22', productId: '20', url: CAP_URL }),
    variant('feed', { sku: 'TEE-S', url: CAP_URL }),
    variant('feed', { sku: 'TEE-XL', url: CAP_URL }),
    variant('jsonld', { sku: 'TEE-M', url: CAP_URL }),
    variant('jsonld', { sku: 'TEE-XL', url: CAP_URL }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'TEE-XL', surface: undefined }]);
});

test('a product whose variants are all real is silent', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'TEE-S', variantId: '21', productId: '20', url: CAP_URL }),
    variant('platform', { sku: 'TEE-M', variantId: '22', productId: '20', url: CAP_URL }),
    variant('jsonld', { sku: 'TEE-S', url: CAP_URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('skipped when neither platform nor checkout was collected', () => {
  const r = runFull(rule, [variant('feed', { sku: 'OLD-9', url: OLD_URL }), variant('jsonld', { sku: 'OLD-9', url: OLD_URL })]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.rules[0]!.skipped, 'needs one of platform, checkout');
});

test('a feed row held back from buyers vouches for nothing, so a product only it lists is not reported', () => {
  const findings = run(rule, [mugPlatform(), variant('acp', { aliases: ['OLD-9'], url: OLD_URL }, { withheld: true })]);
  assert.deepEqual(findings, []);
});

test('a held-back row for a variant the shop dropped is not reported either', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'TEE-S', variantId: '21', productId: '20', url: CAP_URL }),
    variant('acp', { aliases: ['TEE-S'], url: CAP_URL }),
    variant('acp', { aliases: ['TEE-XL'], url: CAP_URL }, { withheld: true }),
  ]);
  assert.deepEqual(findings, []);
});

test('a product listed by a held-back row and by an offered one names only the surface that offers it', () => {
  const findings = run(rule, [
    mugPlatform(),
    variant('acp', { aliases: ['OLD-9'], url: OLD_URL }, { withheld: true }),
    variant('feed', { sku: 'OLD-9', url: OLD_URL }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: undefined, surface: 'feed' }]);
  assert.match(findings[0]!.message, /^listed by feed,/);
});

test('an incomplete backend catalogue cannot prove that an unmatched variant is absent', () => {
  const findings = run(rule, [
    variant('platform', { sku: 'TEE-S', variantId: '21', productId: '20', url: CAP_URL }),
    whole('platform', CAP_URL, { incompleteVariants: true }),
    variant('feed', { sku: 'TEE-S', url: CAP_URL }),
    variant('feed', { sku: 'TEE-M', url: CAP_URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('when all variants failed to load, the incomplete parent still prevents an absence claim', () => {
  const findings = run(rule, [
    mugPlatform(),
    whole('platform', CAP_URL, { incompleteVariants: true }),
    variant('feed', { sku: 'TEE-S', url: CAP_URL }),
  ]);
  assert.deepEqual(findings, []);
});

test('incomplete coverage is local to its product, and does not hide other stale variants or products', () => {
  const findings = run(rule, [
    whole('platform', CAP_URL, { incompleteVariants: true }),
    variant('feed', { sku: 'TEE-M', url: CAP_URL }),
    mugPlatform(),
    variant('feed', { sku: 'MUG-1', url: SHOP_URL }),
    variant('feed', { sku: 'MUG-STALE', url: SHOP_URL }),
    variant('feed', { sku: 'OLD-9', url: OLD_URL }),
  ]);
  assert.deepEqual(findings.map((f) => [f.product, f.variant]), [
    ['shop.example/product/mug', 'MUG-STALE'],
    ['shop.example/product/old', undefined],
  ]);
});

test('incomplete coverage on a feed is not evidence of an incomplete backend', () => {
  const findings = run(rule, [
    mugPlatform(),
    variant('feed', { sku: 'MUG-1', url: SHOP_URL }),
    variant('feed', { sku: 'MUG-STALE', url: SHOP_URL }),
    whole('feed', SHOP_URL, { incompleteVariants: true }),
  ]);
  assert.deepEqual(brief(findings), [{ variant: 'MUG-STALE', surface: 'feed' }]);
});
