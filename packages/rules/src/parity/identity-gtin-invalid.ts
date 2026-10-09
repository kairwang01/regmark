import { defineRule, gtinKey, isValidGtin, normalizeGtin } from '@regmark/core';
import type { Finding, OfferGraph, Surface } from '@regmark/core';

// Per graph: surface and GTIN key mapped to the offers that state it. Built once,
// because a duplicate can only be seen by looking across every product.
const indexes = new WeakMap<OfferGraph, Map<string, Set<string>>>();

function gtinIndex(graph: OfferGraph): Map<string, Set<string>> {
  const cached = indexes.get(graph);
  if (cached) return cached;
  const index = new Map<string, Set<string>>();
  for (const product of graph.products) {
    for (const offer of product.variants) {
      const who = `${product.key}\u0000${offer.key}`;
      for (const s of offer.sightings) {
        const digits = normalizeGtin(s.ids.gtin);
        if (digits === null) continue;
        const k = `${s.surface}|${gtinKey(digits)}`;
        if (!index.has(k)) index.set(k, new Set());
        index.get(k)!.add(who);
      }
    }
  }
  indexes.set(graph, index);
  return index;
}

type Problem = { kind: 'invalid' | 'duplicate'; surface: Surface; raw: string; locator: string };

export default defineRule({
  id: 'identity.gtin-invalid',
  severity: 'warn',
  summary: 'A GTIN that fails its check digit, has an impossible length, or is given to two different variants.',
  check(product, ctx) {
    const index = gtinIndex(ctx.graph);
    return product.variants.flatMap((offer): Finding[] => {
      const who = `${product.key}\u0000${offer.key}`;
      // One finding per surface; an invalid GTIN is the more serious report, so it wins over a duplicate.
      const bySurface = new Map<Surface, Problem>();
      for (const s of offer.sightings) {
        if (!s.ids.gtin) continue;
        const digits = normalizeGtin(s.ids.gtin);
        let kind: Problem['kind'] | null = null;
        if (digits === null || !isValidGtin(digits)) kind = 'invalid';
        else if ([...(index.get(`${s.surface}|${gtinKey(digits)}`) ?? [])].some((w) => w !== who)) kind = 'duplicate';
        if (!kind) continue;
        const prior = bySurface.get(s.surface);
        if (prior && (prior.kind === 'invalid' || kind === 'duplicate')) continue;
        bySurface.set(s.surface, {
          kind,
          surface: s.surface,
          raw: s.ids.gtin,
          locator: s.ids.url ?? product.url ?? '',
        });
      }
      return [...bySurface.values()].map((p): Finding => ({
        rule: 'identity.gtin-invalid',
        severity: 'warn',
        message:
          p.kind === 'invalid'
            ? `${p.surface} gives GTIN ${p.raw}, which fails its check digit or has the wrong length`
            : `${p.surface} gives GTIN ${p.raw} to more than one variant`,
        product: product.key,
        variant: offer.key,
        surface: p.surface,
        actual: { surface: p.surface, value: p.raw, raw: p.raw, locator: p.locator },
      }));
    });
  },
});
