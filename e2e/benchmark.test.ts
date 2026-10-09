// The benchmark: the tool measured against two shops whose defects are known
// in advance.
//
// The misprinted shop has a fixed list of defects, each naming the findings it
// should produce. Recall is how many of those the tool reports. Anything it
// reports that is not on the list is a false alarm, and the clean shop, which
// has no defects, must produce no findings at all.
//
// These are the release gates: every seeded defect found, zero false alarms
// on the clean shop, and no cart left behind by the probe.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AGENT_ONLY_REVIEW, AGENT_PATHS, AGENT_TOKENS, OWNERSHIP_TOKEN, startShop } from '../fixtures/shop/src/index.ts';
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
  maxAge: { feed: '24h' },
  acpFeed: '/feeds/acp.jsonl.gz',
  platform: 'woocommerce',
  checkout: { shipTo: { country: 'US', postcode: '94103' } },
  cloaking: true,
  ucp: true,
  mcp: true,
  ownershipToken: OWNERSHIP_TOKEN,
  sample: 50,
  fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
  ...extra,
});

const audit = (shop: RunningShop, extra: Partial<AuditConfig> = {}): Promise<AuditResult> => runAudit(config(shop.origin, extra), { now: () => NOW });

const matches = (f: Finding, e: ExpectedFinding): boolean =>
  f.rule === e.rule && f.product.endsWith(`/product/${e.product}`) && (f.variant ?? null) === (e.variant ?? null) && (f.surface ?? null) === (e.surface ?? null);

const show = (f: Finding): string => `${f.rule}  ${f.product.split('/').pop()}  ${f.variant ?? '-'}  ${f.surface ?? '-'}  ${f.message}`;

/** Whether a request posed as a shopping agent, as the fixture shop decides it. */
const asAgent = (userAgent: string): boolean => AGENT_TOKENS.some((token) => userAgent.includes(token));

/** Requests that change state: every POST, PUT and DELETE except the questions put to the agent endpoints, which only ask. */
const stateChanges = (shop: RunningShop): string[] =>
  shop.requests.filter((r) => /^(POST|PUT|DELETE) /.test(r) && !AGENT_PATHS.has(new URL(r.slice(r.indexOf(' ') + 1), 'http://fixture.invalid').pathname));

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

  // Every seeded defect, not most of them: a rule that stops finding its defect is a regression.
  assert.deepEqual(missed.map((e) => `${e.defect} ${e.rule}`), [], `recall is ${(recall * 100).toFixed(1)}%`);
  assert.deepEqual(extra.map(show), [], 'the tool reported findings that are not seeded defects');
  assert.equal(result.ok, false);
  assert.deepEqual(result.surfaces.sort(), ['acp', 'checkout', 'feed', 'jsonld', 'mcp', 'opengraph', 'page', 'platform', 'ucp']);
  assert.equal(result.counts.variants, 20, '19 real variants plus the feed-only scarf');
  // The only thing that may get in the way of reading this shop is the scarf it no longer has: its
  // page is gone, and neither agent endpoint has it either.
  assert.deepEqual(result.issues.map((i) => `${i.surface} ${i.code} ${i.locator?.slice(misprint.origin.length)}`), [
    'page not-found /product/discontinued-scarf/',
    'ucp not-found /product/discontinued-scarf/',
    'mcp not-found /product/discontinued-scarf/',
  ]);

  // D32 and D33 point into the catalogue answer that said it: the request, the id asked, then a JSON pointer.
  const agentSays = result.findings.filter((f) => f.surface === 'ucp' || f.surface === 'mcp').filter((f) => f.rule !== 'variant.missing');
  assert.deepEqual(agentSays.map((f) => [f.rule, f.actual?.value, f.actual?.locator.slice(misprint.origin.length)]).sort(), [
    ['availability.mismatch', 'in_stock', '/api/mcp#lookup_catalog[id="302"]/result/structuredContent/products/2/variants/1/availability'],
    ['price.mismatch', '11.00 USD', '/ucp/v1/catalog/lookup#lookup_catalog[id="402"]/products/3/variants/1/price'],
  ]);

  // D30: the cap's JSON-LD told the agent profile 19.00 and the browser profile 22.00.
  const cloaked = result.findings.filter((f) => f.rule === 'content.cloaking');
  assert.deepEqual(cloaked.map((f) => [f.message, f.expected?.locator.endsWith(' [via browser]'), f.actual?.locator.endsWith(' [via agent]')]), [
    ['a client identifying as agent was told 19.00 USD in jsonld; a browser 22.00 USD', true, true],
  ]);
  // D31: the review only agents are shown is reported once, from the agent's view of the page.
  const planted = result.findings.filter((f) => f.rule === 'content.instruction-like' && f.product.endsWith('/product/rain-shell'));
  assert.deepEqual(
    planted.map((f) => [f.message, f.actual?.value, f.actual?.locator.slice(misprint.origin.length)]),
    [[
      `text addressed to a language model (addressed-to-model): "${AGENT_ONLY_REVIEW}"`,
      AGENT_ONLY_REVIEW,
      '/product/rain-shell/#css(#reviews .comment-text .description) [via agent]',
    ]],
  );
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

test('without an ownership token the probe does not write, nothing poses as another client, and those rules are skipped', async () => {
  const before = stateChanges(clean).length;
  const seen = clean.userAgents.length;
  const result = await audit(clean, { ownershipToken: undefined });
  const after = stateChanges(clean).length;
  assert.equal(after, before, 'no state-changing request reached the shop');
  assert.deepEqual(clean.userAgents.slice(seen).filter((ua) => !ua.startsWith('Regmark/')), [], 'every request said it was Regmark');
  assert.deepEqual(result.issues.map((i) => `${i.surface} ${i.code}`), ['checkout ownership-not-verified', 'page ownership-not-verified']);
  assert.ok(!result.surfaces.includes('checkout'));
  assert.deepEqual(result.rules.filter((r) => r.skipped).map((r) => r.id).sort(), ['content.cloaking', 'shipping.mismatch', 'shipping.undisclosed', 'variant.unpurchasable']);
  assert.deepEqual(result.findings, []);
});

test('the cloaking check reads each sampled page once as a browser and once as an agent', () => {
  for (const shop of [misprint, clean]) {
    const pages = (pick: (ua: string) => boolean) =>
      shop.requests.filter((r, i) => r.startsWith('GET /product/') && pick(shop.userAgents[i]!)).length;
    const asBrowser = pages((ua) => ua.includes('Chrome/'));
    assert.ok(asBrowser > 0, `${shop.shop.mode}: the browser profile was used`);
    assert.equal(pages(asAgent), asBrowser, `${shop.shop.mode}: one agent read for every browser read`);
  }
});

test('the agent endpoints are only asked questions: catalogue reads, never a cart', () => {
  const reads = new Set(['initialize', 'notifications/initialized', 'tools/list', 'tools/call lookup_catalog', 'tools/call search_catalog']);
  for (const shop of [misprint, clean]) {
    const calls = shop.rpcCalls();
    assert.ok(calls.includes('tools/call lookup_catalog'), `${shop.shop.mode}: the MCP catalogue was read`);
    assert.deepEqual(calls.filter((c) => !reads.has(c)), [], `${shop.shop.mode}: only catalogue tools were called, though the server lists create_cart`);
    const ucp = shop.requests.filter((r) => r.includes('/ucp/') || r.includes('/.well-known/ucp'));
    assert.ok(ucp.length > 0, `${shop.shop.mode}: the UCP catalogue was read`);
    assert.deepEqual(ucp.filter((r) => !/^(GET \/\.well-known\/ucp|POST \/ucp\/v1\/catalog\/(lookup|search))$/.test(r)), []);
  }
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
