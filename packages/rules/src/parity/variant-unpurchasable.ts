import { defineRule, evidence, isBuyable } from '@regmark/core';
import type { Finding } from '@regmark/core';

export default defineRule({
  id: 'variant.unpurchasable',
  severity: 'error',
  summary: 'Everything says the variant can be bought, and the cart refuses it.',
  help: 'Something the storefront does not show is blocking the sale: a minimum quantity, a purchasable flag, a region or shipping restriction, a required option. Lift it, or stop advertising the variant as available.',
  needsAll: ['checkout'],
  check(product) {
    const findings: Finding[] = [];
    for (const offer of product.variants) {
      const refusal = offer.purchasable.find((o) => o.surface === 'checkout' && o.value === false);
      if (!refusal) continue;
      // A storefront that already says "out of stock" agrees with the cart; that is not this rule's case.
      const platform = offer.availability.find((o) => o.surface === 'platform');
      if (platform && isBuyable(platform.value) !== true) continue;
      const saying = offer.availability.find((o) => o.surface !== 'checkout' && isBuyable(o.value) === true);
      if (!saying) continue;
      findings.push({
        rule: 'variant.unpurchasable',
        severity: 'error',
        message: `the cart refuses it, though ${saying.surface} says it can be bought`,
        product: product.key,
        variant: offer.key,
        actual: evidence(refusal, `refused: ${refusal.raw}`),
      });
    }
    return findings;
  },
});
