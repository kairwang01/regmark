// A buyer cannot learn the shipping cost before checkout.

import { defineRule, evidence } from '@regmark/core';
import type { Finding } from '@regmark/core';
import { shippingText } from './checked.ts';

const ID = 'shipping.undisclosed';

export default defineRule({
  id: ID,
  severity: 'warn',
  summary: 'A buyer cannot learn the shipping cost before checkout.',
  help: 'Add shippingDetails to the structured data, or shipping to the feed, so that a buyer, or an agent buying for one, can know the full cost before reaching the cart.',
  needsAll: ['checkout'],
  check(product) {
    const findings: Finding[] = [];

    for (const offer of product.variants) {
      const d = offer.shipping.find((o) => o.surface === 'checkout' && o.value.cost !== null);
      const cost = d?.value.cost;
      if (!d || !cost || cost.units <= 0) continue;
      // Any other surface that states a shipping cost, whether it agrees or not,
      // tells the buyer something before checkout. Whether it is right is
      // shipping.mismatch's question.
      if (offer.shipping.some((o) =>
        o.surface !== 'checkout' &&
        (o.value.cost !== null || o.value.free) &&
        (!o.value.country || !d.value.country || o.value.country.toUpperCase() === d.value.country.toUpperCase()),
      )) continue;
      findings.push({
        rule: ID,
        severity: 'warn',
        message: `checkout charges ${shippingText(d.value)} for shipping; no other surface states a cost`,
        product: product.key,
        variant: offer.key,
        actual: evidence(d, shippingText(d.value)),
      });
    }

    return findings;
  },
});
