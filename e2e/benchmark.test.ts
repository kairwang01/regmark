// The benchmark: the tool measured against two shops whose defects are known
// in advance.
//
// The misprinted shop has a fixed list of defects, each naming the findings it
// should produce. Recall is how many of those the tool reports. Anything it
// reports that is not on the list is a false alarm, and the clean shop, which
// has no defects, must produce no findings at all.
//
// These are the release gates from the roadmap: recall of at least 90 percent,
// zero false alarms on the clean shop, and no cart left behind by the probe.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { OWNERSHIP_TOKEN, startShop } from '../fixtures/shop/src/index.ts';
import type { ExpectedFinding, RunningShop } from '../fixtures/shop/src/index.ts';
import { runAudit } from '../packages/cli/src/index.ts';
import type { AuditConfig } from '../packages/cli/src/index.ts';
import type { AuditResult, Finding } from '../packages/core/src/index.ts';

const NOW = new Date('2026-10-09T12:00:00.000Z');

let misprint: RunningShop;
let clean: RunningShop;

before(async () => {
  [misprint, clean] = await Promise.all([startShop({ mode: 'misprint', now: NOW }), startShop({ mode: 'clean', now: NOW })]);
});
after(async () => {
  await Promise.all([misprint?.close(), clean?.close()]);
});

const config = (origin: string, extra: Partial<AuditConfig> = {}): AuditConfig => ({
  store: origin,
  feed: '/feeds/google.xml',
  platform: 'woocommerce',
  checkout: { shipTo: { country: 'US', postcode: '94103' } },
  ownershipToken: OWNERSHIP_TOKEN,
  sample: 50,
  fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
  ...extra,
});

const audit = (shop: RunningShop, extra: Partial<AuditConfig> = {}): Promise<AuditResult> => runAudit(config(shop.origin, extra), { now: () => NOW });

const matches = (f: Finding, e: ExpectedFinding): boolean =>
  f.rule === e.rule && f.product.endsWith(`/product/${e.product}`) && (f.variant ?? null) === (e.variant ?? null) && (f.surface ?? null) === (e.surface ?? null);

const show = (f: Finding): string => `${f.rule}  ${f.product.split('/').pop()}  ${f.variant ?? '-'}  ${f.surface ?? '-'}  ${f.message}`;

test('misprinted shop: every seeded defect is found and nothing else is reported', async (t) => {
  const result = await audit(misprint);
  const expected = misprint.shop.expected;
  const missed = expected.filter((e) => !result.findings.some((f) => matches(f, e)));
  const extra = result.findings.filter((f) => !expected.some((e) => matches(f, e)));
  const recall = (expected.length - missed.length) / expected.length;

  t.diagnostic(`recall ${expected.length - missed.length}/${expected.length} (${(recall * 100).toFixed(1)}%), false alarms ${extra.length}, issues ${result.issues.length}`);
  for (const e of missed) t.diagnostic(`MISSED ${e.defect} ${e.rule} ${e.product} ${e.variant ?? '-'} ${e.surface ?? '-'}`);
  for (const f of extra) t.diagnostic(`EXTRA  ${show(f)}`);
  for (const i of result.issues) t.diagnostic(`ISSUE  ${i.surface} ${i.code} ${i.message}`);

  assert.ok(recall >= 0.9, `recall ${(recall * 100).toFixed(1)}% is under the 90% gate`);
  assert.deepEqual(extra.map(show), [], 'the tool reported findings that are not seeded defects');
  assert.equal(result.ok, false);
  assert.deepEqual(result.surfaces.sort(), ['checkout', 'feed', 'jsonld', 'opengraph', 'page', 'platform']);
  assert.equal(result.counts.variants, 20, '19 real variants plus the feed-only scarf');
  // The only thing that may get in the way of reading this shop is the page it no longer has.
  assert.deepEqual(result.issues.map((i) => `${i.surface} ${i.code}`), ['page not-found']);
});

test('clean shop: no findings of any severity, and no collection issues', async (t) => {
  const result = await audit(clean);
  for (const f of result.findings) t.diagnostic(`FALSE ALARM ${show(f)}`);
  for (const i of result.issues) t.diagnostic(`ISSUE ${i.surface} ${i.code} ${i.message}`);
  assert.deepEqual(result.findings.map(show), []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.products, 10);
  assert.equal(result.counts.variants, 19);
  assert.ok(result.rules.every((r) => r.skipped === undefined), 'every rule ran');
});

test('the checkout probe leaves no cart with anything in it', () => {
  for (const shop of [misprint, clean]) {
    const left = shop.carts().filter((c) => c.items.length > 0);
    assert.deepEqual(left, [], `${shop.shop.mode} shop still has carts with items`);
    assert.ok(shop.carts().length >= 1, 'the probe did open a cart');
  }
});

test('without an ownership token the probe does not write, and the checkout rules are skipped', async () => {
  const before = clean.requests.filter((r) => r.startsWith('POST') || r.startsWith('DELETE')).length;
  const result = await audit(clean, { ownershipToken: undefined });
  const after = clean.requests.filter((r) => r.startsWith('POST') || r.startsWith('DELETE')).length;
  assert.equal(after, before, 'no state-changing request reached the shop');
  assert.deepEqual(result.issues.map((i) => i.code), ['ownership-not-verified']);
  assert.ok(!result.surfaces.includes('checkout'));
  assert.deepEqual(result.rules.filter((r) => r.skipped).map((r) => r.id).sort(), ['shipping.mismatch', 'shipping.undisclosed', 'variant.unpurchasable']);
  assert.deepEqual(result.findings, []);
});

test('read-only audit (no platform, no checkout) of the misprinted shop finds what can be seen from outside', async (t) => {
  const result = await audit(misprint, { platform: undefined, checkout: undefined });
  t.diagnostic(`read-only: ${result.findings.length} findings: ${[...new Set(result.findings.map((f) => f.rule))].sort().join(', ')}`);
  const writes = misprint.requests.filter((r) => r.includes('/wp-json/')).length;
  assert.ok(writes > 0, 'earlier tests used the API');
  // With the page as the only datum, the stale og: price and the content defects are still visible.
  const rules = new Set(result.findings.map((f) => f.rule));
  for (const id of ['content.hidden-text', 'content.instruction-like', 'content.invisible-chars', 'identity.gtin-invalid']) assert.ok(rules.has(id), `${id} should not need a backend`);
  assert.ok(result.findings.some((f) => f.rule === 'price.mismatch' && f.surface === 'opengraph'), 'the og price disagrees with the visible price');
});

test('read-only audit of the clean shop reports nothing', async (t) => {
  const result = await audit(clean, { platform: undefined, checkout: undefined });
  for (const f of result.findings) t.diagnostic(`FALSE ALARM ${show(f)}`);
  assert.deepEqual(result.findings.map(show), []);
  assert.deepEqual(result.issues, []);
});
