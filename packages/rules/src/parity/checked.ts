// Which statements a parity rule may compare with the datum, and how the
// datum is named in a message. Shared so the six parity rules agree.

import { formatMoney } from '@regmark/core';
import type { ShippingQuote, Surface } from '@regmark/core';

/** Surfaces that state facts about a product in machine-readable form. */
export const MACHINE_SURFACES: ReadonlySet<Surface> = new Set<Surface>([
  'jsonld',
  'microdata',
  'opengraph',
  'feed',
  'ucp',
  'acp',
  'mcp',
]);

/**
 * Whether a statement from `surface` is compared with the datum taken from
 * `datumSurface`. Page text is compared only against a backend datum: the
 * page is what a person reads, so it is not a reference for another page.
 * A surface never checks itself, so a second observation from the datum's own
 * surface is not treated as a confirmation or a contradiction.
 */
export function isChecked(surface: Surface, datumSurface: Surface): boolean {
  if (surface === datumSurface) return false;
  if (MACHINE_SURFACES.has(surface)) return true;
  return surface === 'page' && (datumSurface === 'checkout' || datumSurface === 'platform');
}

/** "checkout charges 39.00 USD" reads better than "checkout says 39.00 USD". */
export const datumVerb = (surface: Surface): string => (surface === 'checkout' ? 'charges' : 'says');

/** A shipping quote as a person reads it. */
export function shippingText(q: ShippingQuote): string {
  if ((q.cost !== null && q.cost.units === 0) || (q.cost === null && q.free)) return 'free';
  return q.cost === null ? 'cost not stated' : formatMoney(q.cost);
}
