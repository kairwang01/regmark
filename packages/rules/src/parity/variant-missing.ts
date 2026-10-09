import { defineRule } from '@regmark/core';
import type { Finding, Surface } from '@regmark/core';
import { isReal } from './real.ts';

// Feeds are left out on purpose: merchants often drop variants from a feed deliberately.
const CONSIDERED: readonly Surface[] = ['jsonld', 'microdata', 'ucp', 'acp', 'mcp'];

export default defineRule({
  id: 'variant.missing',
  severity: 'error',
  summary: "A surface lists some of a product's variants and leaves others out.",
  needsAny: ['platform', 'checkout'],
  check(product) {
    const real = product.variants.filter(isReal);
    const findings: Finding[] = [];
    for (const surface of CONSIDERED) {
      const listed = real.filter((v) => v.surfaces.includes(surface));
      // A surface that names none of the variants is not partial; it is just absent.
      if (listed.length === 0 || listed.length === real.length) continue;
      for (const v of real) {
        if (v.surfaces.includes(surface)) continue;
        findings.push({
          rule: 'variant.missing',
          severity: 'error',
          message: `missing from ${surface}, which lists ${listed.length} of ${real.length} variants`,
          product: product.key,
          variant: v.key,
          surface,
        });
      }
    }
    return findings;
  },
});
