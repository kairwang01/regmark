// A surface whose own timestamp says it is older than the refresh interval
// the operator set for it. A feed that happens to be right today but was
// generated nine days ago will be wrong tomorrow; availability.mismatch cannot
// see that, because today the values still agree.
//
// A feed's age is one fact about the whole file, so it is reported once per
// run, not once per product: a stale feed of 400 items is one thing to fix,
// and 400 findings would bury every other report and swamp any budget set for
// this rule. The finding is attached to the first product, in graph order,
// that carries the timestamp, so the same shop always reports it in the same
// place.

import { defineRule, evidence } from '@regmark/core';
import type { Finding, Observation, OfferGraph, ProductNode, Surface } from '@regmark/core';

const ID = 'availability.stale';
const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/** An ISO 8601 instant that names its zone. Without one, Date.parse would read it in the zone of whatever machine runs the audit. */
const ZONED = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

/** One surface's timestamp: the newest any of its sightings carries, and the product the finding goes on. */
type Stamp = { newest: Observation<string>; time: number; owner: ProductNode };

// Per graph, because the newest timestamp and the first product to carry one
// can only be found by looking across every product. Built once, not once per
// product.
const indexes = new WeakMap<OfferGraph, Map<Surface, Stamp>>();

function stampIndex(graph: OfferGraph): Map<Surface, Stamp> {
  const cached = indexes.get(graph);
  if (cached) return cached;
  const index = new Map<Surface, Stamp>();
  for (const product of graph.products) {
    for (const s of [...product.productLevel, ...product.variants.flatMap((v) => v.sightings)]) {
      const stated = s.generatedAt;
      if (!stated || !ZONED.test(stated.value)) continue;
      const time = Date.parse(stated.value);
      if (Number.isNaN(time)) continue;
      const prior = index.get(s.surface);
      if (!prior) index.set(s.surface, { newest: stated, time, owner: product });
      else if (time > prior.time) index.set(s.surface, { ...prior, newest: stated, time });
    }
  }
  indexes.set(graph, index);
  return index;
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * A length of time as people say it, rounded down so an age is never
 * overstated: days from two days up, hours from two hours up, each with the
 * next unit down when there is a remainder. "9 days 4 hours", "24 hours",
 * "90 minutes".
 */
function span(ms: number): string {
  const minutes = Math.floor(ms / MINUTE_MS);
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor(minutes / 60);
  if (days >= 2) {
    const over = hours - days * 24;
    return over > 0 ? `${count(days, 'day')} ${count(over, 'hour')}` : count(days, 'day');
  }
  if (hours >= 2) {
    const over = minutes - hours * 60;
    return over > 0 ? `${count(hours, 'hour')} ${count(over, 'minute')}` : count(hours, 'hour');
  }
  return count(minutes, 'minute');
}

/** The instant as people read it: whole seconds lose their ".000". */
const instantText = (iso: string) => iso.replace(/\.0+(?=(Z|[+-]\d{2}:\d{2})$)/i, '');

/** The surfaces given a maxAge in this run, with the limit for each. */
const limits = (maxAgeMs: Partial<Record<Surface, number>> | undefined): Array<[Surface, number]> =>
  Object.entries(maxAgeMs ?? {}).filter((e): e is [Surface, number] => typeof e[1] === 'number');

export default defineRule({
  id: ID,
  severity: 'warn',
  summary: 'A feed is older than the refresh interval set for it',
  help:
    'The feed file was generated longer ago than the maxAge configured for it, so whatever it says about price and stock is that old. Check the feed exporter or its scheduled job, and make sure the feed URL serves the latest export rather than a cached copy.',
  needsAny: ['feed', 'acp'],
  requires(ctx) {
    const surfaces = limits(ctx.options.maxAgeMs).map(([surface]) => surface);
    if (surfaces.length === 0) return 'needs maxAge, such as --max-age feed=24h';
    // A feed that gives no time it was generated cannot be called fresh.
    // Skipping says so; running and finding nothing would read as a pass.
    const index = stampIndex(ctx.graph);
    if (!surfaces.some((s) => index.has(s))) return `needs ${surfaces.join(' or ')} to state when it was generated`;
    return undefined;
  },
  check(product, ctx) {
    const index = stampIndex(ctx.graph);
    const findings: Finding[] = [];
    for (const [surface, maxAge] of limits(ctx.options.maxAgeMs)) {
      const stamp = index.get(surface);
      if (!stamp || stamp.owner !== product) continue;
      const age = ctx.now.getTime() - stamp.time;
      // A timestamp in the future gives a negative age: whatever it means, it
      // does not show the feed is old.
      if (age <= maxAge) continue;
      findings.push({
        rule: ID,
        severity: 'warn',
        message: `${surface} was generated ${span(age)} before the audit, longer ago than its maxAge of ${span(maxAge)}; every item in it is that old`,
        product: product.key,
        surface,
        actual: evidence(stamp.newest, `generated ${instantText(stamp.newest.value)}, ${span(age)} before the audit`),
      });
    }
    return findings;
  },
});
