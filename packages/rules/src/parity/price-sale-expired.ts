// A surface says the price stopped applying on a date already past, yet still
// states that price.

import { defineRule, evidence, formatMoney, sameMoney } from '@regmark/core';
import type { Finding } from '@regmark/core';
import { isChecked } from './checked.ts';

const ID = 'price.sale-expired';
const DAY_MS = 86_400_000;
const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * The instant at which a stated end date has passed, or null when the text is
 * not a date. A bare date runs to the end of its day, so a sale that ends
 * today has not expired.
 */
function endInstant(raw: string): number | null {
  const text = raw.trim();
  const bare = BARE_DATE.exec(text);
  if (bare) {
    const y = Number(bare[1]);
    const m = Number(bare[2]);
    const d = Number(bare[3]);
    const start = Date.UTC(y, m - 1, d);
    // Date.UTC rolls 2026-02-30 over into March; reject that instead.
    const back = new Date(start);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
    return start + DAY_MS - 1;
  }
  // Without an offset, Date.parse would read the time in the machine's zone,
  // and the answer would depend on where the check runs. Read it as UTC.
  const ms = ZONELESS_DATETIME.test(text) ? Date.parse(`${text}Z`) : Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

export default defineRule({
  id: ID,
  severity: 'warn',
  summary: 'A surface says the price stopped applying on a date already past, yet it is still the price.',
  check(product, ctx) {
    const findings: Finding[] = [];
    const now = ctx.now;
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    for (const offer of product.variants) {
      const d = ctx.pick(offer.price);
      if (!d) continue;
      const reported = new Set<string>();
      for (const u of offer.priceValidUntil) {
        if (!isChecked(u.surface, d.surface) || reported.has(u.surface)) continue;
        const end = endInstant(u.value);
        if (end === null || end >= startOfToday) continue;
        const p = offer.price.find((o) => o.surface === u.surface);
        // A stated price that no longer matches the datum is price.mismatch's finding.
        if (!p || !sameMoney(p.value, d.value)) continue;
        reported.add(u.surface);
        findings.push({
          rule: ID,
          severity: 'warn',
          message: `${u.surface} says ${formatMoney(p.value)} applies until ${u.value}, which has passed`,
          product: product.key,
          variant: offer.key,
          surface: u.surface,
          actual: evidence(u, u.value),
        });
      }
    }

    return findings;
  },
});
