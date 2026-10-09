import { defineRule } from '@regmark/core';
import type { Finding, Surface } from '@regmark/core';
import { isReal } from './real.ts';

// The Google feed is left out on purpose: merchants often drop variants from
// a Merchant Center feed deliberately. An ACP feed is not exempt. It is the
// list an agent sells from, so a variant missing from it cannot be bought
// through the agent at all; the spec asks for a row per variant and has its
// own way to hold one back (is_eligible_search=false, a row the collector
// still counts as listed); and OpenAI keeps serving a record that drops out
// of the feed for up to 14 days, so leaving a sold-out variant out keeps its
// last in-stock record live.
const CONSIDERED: readonly Surface[] = ['jsonld', 'microdata', 'ucp', 'acp', 'mcp'];

export default defineRule({
  id: 'variant.missing',
  severity: 'error',
  summary: "A surface lists some of a product's variants and leaves others out.",
  help: 'The structured data describes only the default variant. Emit one Offer per variant, as a ProductGroup with hasVariant or as an offers array, each with its own sku, price and availability. In an agent feed, send one row per variant, out of stock or not, and hold a variant back with is_eligible_search=false rather than by leaving it out.',
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
