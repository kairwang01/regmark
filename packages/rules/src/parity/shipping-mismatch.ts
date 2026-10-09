// A surface states a shipping cost that the checkout does not charge.

import { defineRule, evidence, sameMoney } from '@regmark/core';
import type { Finding } from '@regmark/core';
import { isChecked, shippingText } from './checked.ts';

const ID = 'shipping.mismatch';

export default defineRule({
  id: ID,
  severity: 'error',
  summary: 'A surface states a shipping cost the checkout does not charge.',
  needsAll: ['checkout'],
  check(product, ctx) {
    const findings: Finding[] = [];

    for (const offer of product.variants) {
      const d = offer.shipping.find((o) => o.surface === 'checkout' && o.value.cost !== null);
      const dc = d?.value.cost;
      if (!d || !dc) continue;
      const reported = new Set<string>();
      for (const o of offer.shipping) {
        if (!isChecked(o.surface, d.surface) || reported.has(o.surface)) continue;
        if (o.value.conditional === true) continue;
        const oc = o.value.country;
        const dcountry = d.value.country;
        if (oc && dcountry && oc.toUpperCase() !== dcountry.toUpperCase()) continue;
        const wrong =
          o.value.cost !== null ? !sameMoney(o.value.cost, dc) : o.value.free === true && dc.units > 0;
        if (!wrong) continue;
        reported.add(o.surface);
        findings.push({
          rule: ID,
          severity: 'error',
          message: `${o.surface} says shipping is ${shippingText(o.value)}, checkout charges ${shippingText(d.value)}`,
          product: product.key,
          variant: offer.key,
          surface: o.surface,
          expected: evidence(d, shippingText(d.value)),
          actual: evidence(o, shippingText(o.value)),
        });
      }
    }

    return findings;
  },
});
