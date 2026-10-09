import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, DEFAULT_DATUM, runRules } from '@regmark/core';
import type { Observation, Sighting, Surface } from '@regmark/core';
import rule from '../../src/parity/availability-stale.ts';
import { NOW, obs, price, run, runFull, variant } from '../helpers.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FEED_DAY = { maxAgeMs: { feed: DAY } };

const url = (slug: string) => `https://shop.example/product/${slug}/`;

/** When a surface says it was generated, as the feed collector records it. */
const stamp = (surface: Surface, iso: string, raw = iso): Observation<string> => ({
  ...obs(surface, iso, raw),
  locator: `test://${surface}#/rss/channel/lastBuildDate`,
});

/** A backend variant and the feed's item for it, the feed item carrying `generatedAt`. */
function listed(slug: string, sku: string, generatedAt?: Observation<string>, surface: Surface = 'feed'): Sighting[] {
  return [
    variant('platform', { sku, variantId: sku, productId: slug, url: url(slug) }, { price: price('platform', '10.00') }),
    variant(surface, { aliases: [sku], url: url(slug) }, { price: price(surface, '10.00'), ...(generatedAt ? { generatedAt } : {}) }),
  ];
}

const NINE_DAYS_OLD = stamp('feed', '2026-09-30T08:00:00.000Z', 'Wed, 30 Sep 2026 08:00:00 GMT');

test('a feed generated nine days before the audit, with a maxAge of a day, is reported once with its timestamp as evidence', () => {
  const findings = run(rule, listed('mug', 'MUG-1', NINE_DAYS_OLD), { options: FEED_DAY });
  assert.equal(findings.length, 1);
  const [f] = findings;
  assert.equal(f!.product, 'shop.example/product/mug');
  assert.equal(f!.surface, 'feed');
  assert.equal(f!.variant, undefined, 'the age is the whole feed\'s, not one variant\'s');
  assert.deepEqual(f!.actual, {
    surface: 'feed',
    value: 'generated 2026-09-30T08:00:00Z, 9 days 4 hours before the audit',
    raw: 'Wed, 30 Sep 2026 08:00:00 GMT',
    locator: 'test://feed#/rss/channel/lastBuildDate',
  });
  assert.equal(f!.expected, undefined);
  assert.equal(f!.message, 'feed was generated 9 days 4 hours before the audit, longer ago than its maxAge of 24 hours; every item in it is that old');
});

test('the message names the maximum in days, hours and minutes', () => {
  const message = (maxAge: number, generated = NINE_DAYS_OLD) => run(rule, listed('mug', 'MUG-1', generated), { options: { maxAgeMs: { feed: maxAge } } })[0]?.message;
  assert.match(message(90 * 60_000)!, /maxAge of 90 minutes;/);
  assert.match(message(2 * HOUR + 30 * 60_000)!, /maxAge of 2 hours 30 minutes;/);
  assert.match(message(36 * HOUR)!, /maxAge of 36 hours;/);
  assert.match(message(7 * DAY)!, /maxAge of 7 days;/);
  assert.match(message(DAY, stamp('feed', '2026-10-08T10:30:00.000Z'))!, /generated 25 hours 30 minutes before the audit/);
});

test('a stale feed across several products is one finding, on the first product in graph order', () => {
  const findings = run(
    rule,
    [...listed('scarf', 'SCARF-1', NINE_DAYS_OLD), ...listed('apron', 'APRON-1', NINE_DAYS_OLD), ...listed('mug', 'MUG-1', NINE_DAYS_OLD)],
    { options: FEED_DAY },
  );
  assert.deepEqual(
    findings.map((f) => [f.product, f.surface]),
    [['shop.example/product/apron', 'feed']],
  );
});

test('a product with several stamped variants still gets one finding', () => {
  const sightings = ['S', 'M', 'L'].flatMap((size) => listed('tee', `TEE-${size}`, NINE_DAYS_OLD));
  assert.equal(run(rule, sightings, { options: FEED_DAY }).length, 1);
});

test('the finding goes on the first product that carries a timestamp, not the first with a feed item', () => {
  const findings = run(rule, [...listed('apron', 'APRON-1'), ...listed('mug', 'MUG-1', NINE_DAYS_OLD)], { options: FEED_DAY });
  assert.deepEqual(findings.map((f) => f.product), ['shop.example/product/mug']);
});

test('a feed item no backend variant matches still carries the feed\'s age', () => {
  // A stray feed item becomes its own product with no real variant; it is still part of the feed.
  const stray = variant('feed', { aliases: ['GHOST-1'], url: url('ghost') }, { generatedAt: NINE_DAYS_OLD });
  assert.deepEqual(run(rule, [stray], { options: FEED_DAY }).map((f) => f.product), ['shop.example/product/ghost']);
});

test('the newest timestamp on a surface decides, and is the one shown', () => {
  const older = stamp('feed', '2026-09-20T08:00:00.000Z');
  const newer = stamp('feed', '2026-10-01T08:00:00.000Z');
  const findings = run(rule, [...listed('apron', 'APRON-1', older), ...listed('mug', 'MUG-1', newer)], { options: FEED_DAY });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.product, 'shop.example/product/apron');
  assert.match(findings[0]!.actual!.value, /^generated 2026-10-01T08:00:00Z, 8 days 4 hours before the audit$/);

  const fresh = stamp('feed', '2026-10-09T08:00:00.000Z');
  assert.deepEqual(run(rule, [...listed('apron', 'APRON-1', older), ...listed('mug', 'MUG-1', fresh)], { options: FEED_DAY }), []);
});

test('each surface with a maxAge is judged on its own timestamp', () => {
  const acpOld = stamp('acp', '2026-10-01T12:00:00.000Z');
  const findings = run(rule, [...listed('apron', 'APRON-1', NINE_DAYS_OLD), ...listed('mug', 'MUG-1', acpOld, 'acp')], {
    options: { maxAgeMs: { feed: DAY, acp: 7 * DAY } },
  });
  assert.deepEqual(
    findings.map((f) => [f.product, f.surface]),
    [
      ['shop.example/product/apron', 'feed'],
      ['shop.example/product/mug', 'acp'],
    ],
  );
});

// ── Silent ───────────────────────────────────────────────────────────────

test('a feed generated within its maxAge is silent', () => {
  const recent = stamp('feed', '2026-10-09T06:00:00.000Z');
  assert.deepEqual(run(rule, listed('mug', 'MUG-1', recent), { options: FEED_DAY }), []);
});

test('a feed exactly maxAge old is silent: it is not older than the limit', () => {
  const edge = stamp('feed', new Date(NOW.getTime() - DAY).toISOString());
  assert.deepEqual(run(rule, listed('mug', 'MUG-1', edge), { options: FEED_DAY }), []);
  const past = stamp('feed', new Date(NOW.getTime() - DAY - 1).toISOString());
  assert.equal(run(rule, listed('mug', 'MUG-1', past), { options: FEED_DAY }).length, 1);
});

test('a timestamp in the future is silent', () => {
  const ahead = stamp('feed', '2026-10-20T08:00:00.000Z');
  assert.deepEqual(run(rule, listed('mug', 'MUG-1', ahead), { options: FEED_DAY }), []);
});

test('a stale feed is not reported when only another surface has a maxAge, and the rule says why it did not run', () => {
  const result = runFull(rule, listed('mug', 'MUG-1', NINE_DAYS_OLD), { options: { maxAgeMs: { acp: DAY } } });
  assert.deepEqual(result.findings, []);
  assert.equal(result.rules[0]!.skipped, 'needs acp to state when it was generated');
});

test('a timestamp on a surface without a maxAge is not judged', () => {
  const sightings = [
    ...listed('mug', 'MUG-1', stamp('feed', '2026-10-09T08:00:00.000Z')),
    variant('jsonld', { sku: 'MUG-1', url: url('mug') }, { generatedAt: stamp('jsonld', '2025-01-01T00:00:00.000Z') }),
  ];
  assert.deepEqual(run(rule, sightings, { options: FEED_DAY }), []);
});

test('skipped without a maxAge, however old the feed', () => {
  const ancient = stamp('feed', '2020-01-01T00:00:00.000Z');
  for (const options of [undefined, {}, { maxAgeMs: {} }]) {
    const result = runFull(rule, listed('mug', 'MUG-1', ancient), { options });
    assert.deepEqual(result.findings, []);
    assert.equal(result.rules[0]!.skipped, 'needs maxAge, such as --max-age feed=24h');
  }
});

test('skipped when no feed was read', () => {
  const sightings = [variant('platform', { sku: 'MUG-1', variantId: '1', productId: '1', url: url('mug') }, { price: price('platform', '10.00') })];
  const result = runFull(rule, sightings, { options: FEED_DAY });
  assert.equal(result.rules[0]!.skipped, 'needs one of feed, acp');
});

test('skipped, not passed, when the feed states no time it was generated', () => {
  const result = runFull(rule, [...listed('apron', 'APRON-1'), ...listed('mug', 'MUG-1')], { options: FEED_DAY });
  assert.deepEqual(result.findings, []);
  assert.equal(result.rules[0]!.skipped, 'needs feed to state when it was generated');
});

test('a timestamp without a zone is not read, so it neither fires nor counts as a timestamp', () => {
  const zoneless = stamp('feed', '2026-09-30T08:00:00');
  const result = runFull(rule, listed('mug', 'MUG-1', zoneless), { options: FEED_DAY });
  assert.deepEqual(result.findings, []);
  assert.equal(result.rules[0]!.skipped, 'needs feed to state when it was generated');
  const garbage = stamp('feed', 'not a dateT00:00Z');
  assert.equal(runFull(rule, listed('mug', 'MUG-1', garbage), { options: FEED_DAY }).rules[0]!.skipped, 'needs feed to state when it was generated');
});

test('the same graph judged at two times gives two answers: only the timestamps are cached, not the verdict', () => {
  const graph = buildGraph(listed('mug', 'MUG-1', NINE_DAYS_OLD));
  const late = runRules(graph, [rule], { datum: DEFAULT_DATUM, now: NOW, options: FEED_DAY });
  const early = runRules(graph, [rule], { datum: DEFAULT_DATUM, now: new Date('2026-09-30T20:00:00.000Z'), options: FEED_DAY });
  assert.equal(late.findings.length, 1);
  assert.deepEqual(early.findings, []);
});
