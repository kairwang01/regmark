import { defineRule } from '@regmark/core';
import type { Finding, Sighting, Surface } from '@regmark/core';
import { isReal } from './real.ts';

/**
 * The surfaces, in the given order, that offer something in `sightings`. A
 * row held back from buyers is how a feed is told to stop offering a thing,
 * so it does not count: it says the shop no longer sells it.
 */
function offeredBy(surfaces: readonly Surface[], sightings: readonly Sighting[]): Surface[] {
  return surfaces.filter((surface) => sightings.some((s) => s.surface === surface && !s.withheld));
}

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
      const surfaces = offeredBy(product.surfaces, [...product.variants.flatMap((v) => v.sightings), ...product.productLevel]);
      if (surfaces.length === 0) return [];
      const finding: Finding = {
        rule: 'identity.unmatched',
        severity: 'warn',
        message: `listed by ${surfaces.join(', ')}, but the shop does not sell it`,
        product: product.key,
      };
      if (surfaces.length === 1) finding.surface = surfaces[0];
      return [finding];
    }
    return product.variants
      .filter((v) => !isReal(v))
      .flatMap((v): Finding[] => {
        const surfaces = offeredBy(v.surfaces, v.sightings);
        if (surfaces.length === 0) return [];
        const finding: Finding = {
          rule: 'identity.unmatched',
          severity: 'warn',
          message: `listed by ${surfaces.join(', ')}, but the shop does not sell it`,
          product: product.key,
          variant: v.key,
        };
        if (surfaces.length === 1) finding.surface = surfaces[0];
        return [finding];
      });
  },
});
