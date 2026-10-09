// A surface states a price that the datum does not back up.

import { defineRule, formatMoney, moneyEvidence, sameMoney } from '@regmark/core';
import type { Finding } from '@regmark/core';
import { datumVerb, isChecked } from './checked.ts';
import { pageDatum, statedBySurface } from './page-datum.ts';
import { taxRateBetween } from './tax.ts';

const ID = 'price.mismatch';

export default defineRule({
  id: ID,
  severity: 'error',
  summary: 'A surface states a price the datum does not back up.',
  help: 'Usually a cache or a schedule. The feed is regenerated less often than prices change, or a theme or SEO plugin builds the structured data from the regular price while a sale is running. Regenerate the feed when prices change, and make the structured data read the same price field the product page displays.',
  check(product, ctx) {
    const findings: Finding[] = [];

    for (const offer of product.variants) {
      const d = ctx.pick(offer.price);
      if (!d) continue;
      const reported = new Set<string>();
      for (const o of offer.price) {
        if (!isChecked(o.surface, d.surface) || reported.has(o.surface)) continue;
        // A different currency is price.currency-ambiguous's finding; comparing
        // the amounts across currencies would only be noise.
        if (o.value.currency !== null && d.value.currency !== null && o.value.currency !== d.value.currency) continue;
        if (sameMoney(o.value, d.value)) continue;
        // Exactly one tax rate apart is price.tax-basis's finding, not a wrong price.
        if (taxRateBetween(o.value, d.value) !== null) continue;
        reported.add(o.surface);
        findings.push({
          rule: ID,
          severity: 'error',
          message: `${o.surface} says ${formatMoney(o.value)}, ${d.surface} ${datumVerb(d.surface)} ${formatMoney(d.value)}`,
          product: product.key,
          variant: offer.key,
          surface: o.surface,
          expected: moneyEvidence(d),
          actual: moneyEvidence(o),
        });
      }
    }

    // A product-level price is wrong only when it agrees with none of the
    // variants it could be describing. Datums that the surface may not be
    // checked against (its own, or page against page) are not candidates.
    for (const s of product.productLevel) {
      const sp = s.price;
      if (!sp) continue;
      const candidates = product.variants.flatMap((v) => {
        const d = ctx.pick(v.price);
        return d ? [d] : [];
      }).filter(
        (d) =>
          isChecked(s.surface, d.surface) &&
          (sp.value.currency === null || d.value.currency === null || d.value.currency === sp.value.currency),
      );
      const first = candidates[0];
      if (!first || candidates.some((d) => sameMoney(sp.value, d.value) || taxRateBetween(sp.value, d.value) !== null)) continue;
      findings.push({
        rule: ID,
        severity: 'error',
        message: `${s.surface} says ${formatMoney(sp.value)}, but no variant charges that`,
        product: product.key,
        surface: s.surface,
        expected: moneyEvidence(first),
        actual: moneyEvidence(sp),
      });
    }

    // No backend was read: hold each machine-readable surface to the price
    // on the page. See page-datum.ts for why this is an any-match.
    const page = pageDatum(product, ctx, 'price');
    if (page) {
      for (const [surface, stated] of statedBySurface(product, 'price')) {
        const comparable = stated.filter((o) => o.value.currency === null || page.value.currency === null || o.value.currency === page.value.currency);
        const first = comparable[0];
        if (!first || comparable.some((o) => sameMoney(o.value, page.value) || taxRateBetween(o.value, page.value) !== null)) continue;
        findings.push({
          rule: ID,
          severity: 'error',
          message: `${surface} says ${formatMoney(first.value)}, the page shows ${formatMoney(page.value)}`,
          product: product.key,
          surface,
          expected: moneyEvidence(page),
          actual: moneyEvidence(first),
        });
      }
    }

    return findings;
  },
});
