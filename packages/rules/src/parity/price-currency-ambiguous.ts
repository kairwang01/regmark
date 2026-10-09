// A machine-readable price with no currency, or in a currency other than the
// one the shop charges in.

import { defineRule, formatMoney, moneyEvidence } from '@regmark/core';
import type { Finding } from '@regmark/core';
import { datumVerb, isChecked, MACHINE_SURFACES } from './checked.ts';

const ID = 'price.currency-ambiguous';

export default defineRule({
  id: ID,
  severity: 'error',
  summary: 'A machine-readable price with no currency, or with a different currency from the one the shop charges in.',
  help: 'Put priceCurrency on every Offer, next to the price itself. When a multi-currency plugin converts prices in the browser, the structured data and meta tags keep the base currency: have the plugin rewrite them too, or serve one currency per URL.',
  check(product, ctx) {
    const findings: Finding[] = [];

    for (const offer of product.variants) {
      const d = ctx.pick(offer.price);
      const datumCurrency = d?.value.currency ?? null;
      if (!d || datumCurrency === null) continue;
      const reported = new Set<string>();
      for (const o of offer.price) {
        // page is exempt: a shopper reading "$39" has context a parser lacks.
        if (!MACHINE_SURFACES.has(o.surface) || !isChecked(o.surface, d.surface) || reported.has(o.surface)) continue;
        if (o.value.currency === datumCurrency) continue;
        reported.add(o.surface);
        const message =
          o.value.currency === null
            ? `${o.surface} gives ${formatMoney(o.value)} with no currency`
            : `${o.surface} says ${formatMoney(o.value)}, ${d.surface} ${datumVerb(d.surface)} in ${datumCurrency}`;
        findings.push({
          rule: ID,
          severity: 'error',
          message,
          product: product.key,
          variant: offer.key,
          surface: o.surface,
          expected: moneyEvidence(d),
          actual: moneyEvidence(o),
        });
      }
    }

    for (const s of product.productLevel) {
      const sp = s.price;
      if (!sp || !MACHINE_SURFACES.has(s.surface)) continue;
      const known = product.variants.flatMap((v) => {
        const d = ctx.pick(v.price);
        return d && d.value.currency !== null ? [d] : [];
      });
      const first = known[0];
      if (!first || first.value.currency === null) continue;
      const currency = sp.value.currency;
      if (currency !== null && known.some((d) => d.value.currency === currency)) continue;
      const message =
        currency === null
          ? `${s.surface} gives ${formatMoney(sp.value)} with no currency`
          : `${s.surface} says ${formatMoney(sp.value)}, but the variants charge in ${first.value.currency}`;
      findings.push({
        rule: ID,
        severity: 'error',
        message,
        product: product.key,
        surface: s.surface,
        expected: moneyEvidence(first),
        actual: moneyEvidence(sp),
      });
    }

    return findings;
  },
});
