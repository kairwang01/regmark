import { defineRule } from '@regmark/core';
import type { Finding } from '@regmark/core';
import { isReal } from './real.ts';

export default defineRule({
  id: 'identity.unmatched',
  severity: 'warn',
  summary: 'Something a surface lists cannot be tied to anything the shop sells.',
  help: 'A feed or a page still lists something the shop no longer sells, or lists it under an identifier nothing else uses. Remove the stale entry, or give every surface the same SKU or GTIN for it.',
  needsAny: ['platform', 'checkout'],
  check(product) {
    const real = product.variants.filter(isReal);
    if (real.length === 0) {
      // A page headline price is a statement about the product itself, so the page vouches for it.
      if (product.productLevel.some((s) => s.surface === 'page')) return [];
      const finding: Finding = {
        rule: 'identity.unmatched',
        severity: 'warn',
        message: `listed by ${product.surfaces.join(', ')}, but the shop does not sell it`,
        product: product.key,
      };
      if (product.surfaces.length === 1) finding.surface = product.surfaces[0];
      return [finding];
    }
    return product.variants
      .filter((v) => !isReal(v))
      .map((v): Finding => {
        const finding: Finding = {
          rule: 'identity.unmatched',
          severity: 'warn',
          message: `listed by ${v.surfaces.join(', ')}, but the shop does not sell it`,
          product: product.key,
          variant: v.key,
        };
        if (v.surfaces.length === 1) finding.surface = v.surfaces[0];
        return finding;
      });
  },
});
