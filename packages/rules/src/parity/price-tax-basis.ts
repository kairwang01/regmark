// Two surfaces state prices exactly one tax rate apart.

import { defineRule, formatMoney, moneyEvidence } from '@regmark/core';
import type { Finding, Money, Observation } from '@regmark/core';
import { datumVerb, isChecked } from './checked.ts';
import { pageDatum, statedBySurface } from './page-datum.ts';
import { taxRateBetween } from './tax.ts';

const compatible = (a: Money, b: Money) => a.currency === null || b.currency === null || a.currency === b.currency;

export default defineRule({
  id: 'price.tax-basis',
  severity: 'warn',
  summary: 'Two surfaces state prices exactly one tax rate apart: one includes tax and the other does not.',
  help: 'One surface includes tax and the other does not. Decide which one the shop publishes and make the feed, the structured data and the page agree. A shop that shows tax-free prices to visitors abroad will see this whenever it is crawled from abroad.',
  check(product, ctx) {
    const findings: Finding[] = [];
    const report = (actual: Observation<Money>, expected: Observation<Money>, rate: number, variant?: string) => {
      findings.push({
        rule: 'price.tax-basis',
        severity: 'warn',
        message: `${actual.surface} says ${formatMoney(actual.value)}, ${expected.surface} ${datumVerb(expected.surface)} ${formatMoney(expected.value)}: ${rate}% apart, as a price with and without tax would be`,
        product: product.key,
        ...(variant ? { variant } : {}),
        surface: actual.surface,
        expected: moneyEvidence(expected),
        actual: moneyEvidence(actual),
      });
    };

    for (const offer of product.variants) {
      const d = ctx.pick(offer.price);
      if (!d) continue;
      const seen = new Set<string>();
      for (const o of offer.price) {
        if (!isChecked(o.surface, d.surface) || seen.has(o.surface) || !compatible(o.value, d.value)) continue;
        const rate = taxRateBetween(o.value, d.value);
        if (rate === null) continue;
        seen.add(o.surface);
        report(o, d, rate, offer.key);
      }
    }

    // A product-level price is a tax question when it matches no variant
    // outright but sits one tax rate from at least one of them.
    for (const s of product.productLevel) {
      const sp = s.price;
      if (!sp) continue;
      const candidates = product.variants.flatMap((v) => {
        const d = ctx.pick(v.price);
        return d && isChecked(s.surface, d.surface) && compatible(sp.value, d.value) ? [d] : [];
      });
      if (candidates.some((d) => d.value.units === sp.value.units)) continue;
      for (const d of candidates) {
        const rate = taxRateBetween(sp.value, d.value);
        if (rate === null) continue;
        report(sp, d, rate);
        break;
      }
    }

    const page = pageDatum(product, ctx, 'price');
    if (page) {
      for (const [, stated] of statedBySurface(product, 'price')) {
        const comparable = stated.filter((o) => compatible(o.value, page.value));
        if (comparable.some((o) => o.value.units === page.value.units)) continue;
        for (const o of comparable) {
          const rate = taxRateBetween(o.value, page.value);
          if (rate === null) continue;
          report(o, page, rate);
          break;
        }
      }
    }

    return findings;
  },
});
