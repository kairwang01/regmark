// The fallback for a run that read no backend.
//
// With a storefront API or a checkout probe, every variant has its own datum.
// Without them the only thing left to believe is what a person sees on the
// page, and a page states one price and one stock status for the product as a
// whole. So the comparison changes shape: a machine-readable surface agrees
// with the page if ANY of the values it states for this product equals the
// page's. It disagrees only when none does.

import type { Observation, ProductNode, RuleContext, Sighting, Surface } from '@regmark/core';
import { MACHINE_SURFACES } from './checked.ts';

type Fact = 'price' | 'availability';

/** The page's own statement of `fact`, but only when no variant has a datum for it. */
export function pageDatum<K extends Fact>(product: ProductNode, ctx: RuleContext, fact: K): NonNullable<Sighting[K]> | undefined {
  if (!ctx.datum.includes('page')) return undefined;
  if (product.variants.some((v) => ctx.pick(v[fact] as readonly Observation<unknown>[]) !== undefined)) return undefined;
  for (const s of product.productLevel) {
    if (s.surface === 'page' && s[fact] !== undefined) return s[fact] as NonNullable<Sighting[K]>;
  }
  return undefined;
}

/** Everything each machine-readable surface states about `fact` for this product, variant-level and product-level alike. */
export function statedBySurface<K extends Fact>(product: ProductNode, fact: K): Map<Surface, NonNullable<Sighting[K]>[]> {
  const out = new Map<Surface, NonNullable<Sighting[K]>[]>();
  const add = (o: NonNullable<Sighting[K]>) => {
    if (!MACHINE_SURFACES.has(o.surface)) return;
    if (!out.has(o.surface)) out.set(o.surface, []);
    out.get(o.surface)!.push(o);
  };
  for (const v of product.variants) for (const o of v[fact]) add(o as NonNullable<Sighting[K]>);
  for (const s of product.productLevel) if (s[fact] !== undefined) add(s[fact] as NonNullable<Sighting[K]>);
  return out;
}
