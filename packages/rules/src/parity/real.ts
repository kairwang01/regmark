import type { Offer } from '@regmark/core';

/**
 * A variant the shop actually sells. Only a backend that takes orders says so;
 * a feed or a page can list anything, including what has been discontinued.
 */
export function isReal(offer: Offer): boolean {
  return offer.surfaces.includes('platform') || offer.surfaces.includes('checkout');
}
