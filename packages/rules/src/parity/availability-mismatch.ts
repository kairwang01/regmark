// A surface says an item can be bought when it cannot, or the reverse.

import { defineRule, evidence, isBuyable } from '@regmark/core';
import type { Finding } from '@regmark/core';
import { datumVerb, isChecked } from './checked.ts';
import { pageDatum, statedBySurface } from './page-datum.ts';

const ID = 'availability.mismatch';

export default defineRule({
  id: ID,
  severity: 'error',
  summary: 'A surface says an item can be bought when it cannot, or the reverse.',
  check(product, ctx) {
    const findings: Finding[] = [];

    for (const offer of product.variants) {
      const d = ctx.pick(offer.availability);
      if (!d) continue;
      const datumBuyable = isBuyable(d.value);
      if (datumBuyable === null) continue;
      const reported = new Set<string>();
      for (const o of offer.availability) {
        if (!isChecked(o.surface, d.surface) || reported.has(o.surface)) continue;
        const buyable = isBuyable(o.value);
        if (buyable === null || buyable === datumBuyable) continue;
        reported.add(o.surface);
        findings.push({
          rule: ID,
          severity: 'error',
          message: `${o.surface} says ${o.value}, ${d.surface} ${datumVerb(d.surface)} ${d.value}`,
          product: product.key,
          variant: offer.key,
          surface: o.surface,
          expected: evidence(d, d.value),
          actual: evidence(o, o.value),
        });
      }
    }

    for (const s of product.productLevel) {
      const sa = s.availability;
      if (!sa) continue;
      const sightingBuyable = isBuyable(sa.value);
      if (sightingBuyable === null) continue;
      const datumBuyable: boolean[] = [];
      for (const v of product.variants) {
        const d = ctx.pick(v.availability);
        if (!d || !isChecked(s.surface, d.surface)) continue;
        const b = isBuyable(d.value);
        if (b !== null) datumBuyable.push(b);
      }
      if (datumBuyable.length === 0 || datumBuyable.includes(sightingBuyable)) continue;
      findings.push({
        rule: ID,
        severity: 'error',
        message: sightingBuyable
          ? `${s.surface} says the product can be bought, but no variant can`
          : `${s.surface} says the product cannot be bought, but every variant can`,
        product: product.key,
        surface: s.surface,
        actual: evidence(sa, sa.value),
      });
    }

    // No backend was read: hold each machine-readable surface to what the
    // page shows. See page-datum.ts for why this is an any-match.
    const page = pageDatum(product, ctx, 'availability');
    const pageBuyable = page ? isBuyable(page.value) : null;
    if (page && pageBuyable !== null) {
      for (const [surface, stated] of statedBySurface(product, 'availability')) {
        const known = stated.filter((o) => isBuyable(o.value) !== null);
        const first = known[0];
        if (!first || known.some((o) => isBuyable(o.value) === pageBuyable)) continue;
        findings.push({
          rule: ID,
          severity: 'error',
          message: `${surface} says ${first.value}, the page shows ${page.value}`,
          product: product.key,
          surface,
          expected: evidence(page, page.value),
          actual: evidence(first, first.value),
        });
      }
    }

    return findings;
  },
});
