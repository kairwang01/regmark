import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, defineRule, isBuyable, moneyEvidence, pickDatum, runRules, sameMoney } from '../src/index.ts';
import { price, sighting } from './helpers.ts';

const priceMismatch = defineRule({
  id: 'price.mismatch',
  severity: 'error',
  summary: 'price differs from the datum',
  check(product, ctx) {
    return product.variants.flatMap((v) => {
      const key = ctx.pick(v.price);
      if (!key) return [];
      return v.price
        .filter((o) => o !== key && !sameMoney(o.value, key.value))
        .map((o) => ({ rule: 'x', severity: 'info' as const, message: 'differs', product: product.key, variant: v.key, surface: o.surface, expected: moneyEvidence(key), actual: moneyEvidence(o) }));
    });
  },
});

const graph = buildGraph([
  sighting('jsonld', { sku: 'TEE', url: 'https://shop.example/p/tee' }, { price: price('jsonld', '35.00') }),
  sighting('feed', { sku: 'TEE', url: 'https://shop.example/p/tee' }, { price: price('feed', '39.00') }),
  sighting('checkout', { sku: 'TEE', variantId: '1' }, { price: price('checkout', '39.00') }),
]);

test('pickDatum() follows the order given, not the order observed', () => {
  const v = graph.products[0]!.variants[0]!;
  assert.equal(pickDatum(v.price, ['checkout', 'platform', 'page'])!.surface, 'checkout');
  assert.equal(pickDatum(v.price, ['platform', 'feed'])!.surface, 'feed');
  assert.equal(pickDatum(v.price, ['platform', 'page']), undefined);
});

test('runRules() stamps the rule id and severity, and an error rule fails on its first finding', () => {
  const r = runRules(graph, [priceMismatch], { datum: ['checkout', 'platform', 'page'] });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0]!.rule, 'price.mismatch');
  assert.equal(r.findings[0]!.severity, 'error');
  assert.equal(r.findings[0]!.surface, 'jsonld');
  assert.equal(r.findings[0]!.expected!.value, '39.00 USD');
  assert.equal(r.findings[0]!.actual!.value, '35.00 USD');
  assert.equal(r.ok, false);
  assert.deepEqual(r.rules[0], { id: 'price.mismatch', severity: 'error', summary: 'price differs from the datum', budget: 0, findings: 1, passed: false });
});

test('a budget lets a known count through and no more', () => {
  assert.equal(runRules(graph, [priceMismatch], { datum: ['checkout'], budget: { 'price.mismatch': 1 } }).ok, true);
  assert.equal(runRules(graph, [priceMismatch], { datum: ['checkout'], budget: { 'price.mismatch': 0 } }).ok, false);
});

test('warn and info rules never fail the run by default', () => {
  const warn = defineRule({ ...priceMismatch, id: 'w', severity: 'warn' });
  const r = runRules(graph, [warn], { datum: ['checkout'] });
  assert.equal(r.findings.length, 1);
  assert.equal(r.ok, true);
  assert.equal(r.rules[0]!.budget, null);
});

test('a rule is skipped, and says why, when a surface it needs was not collected', () => {
  const needsUcp = defineRule({ ...priceMismatch, id: 'n', needsAll: ['checkout', 'ucp'] });
  const needsAny = defineRule({ ...priceMismatch, id: 'a', needsAny: ['ucp', 'acp'] });
  const r = runRules(graph, [needsUcp, needsAny], { datum: ['checkout'] });
  assert.equal(r.findings.length, 0);
  assert.equal(r.rules[0]!.skipped, 'needs ucp');
  assert.equal(r.rules[1]!.skipped, 'needs one of ucp, acp');
  assert.equal(r.ok, true);
});

test('isBuyable() treats unknown as no statement', () => {
  assert.equal(isBuyable('in_stock'), true);
  assert.equal(isBuyable('preorder'), true);
  assert.equal(isBuyable('out_of_stock'), false);
  assert.equal(isBuyable('discontinued'), false);
  assert.equal(isBuyable('unknown'), null);
});
