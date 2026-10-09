// The Shopify checkout probe: one unit of each target variant put in a cart
// through the storefront's own cart endpoints, the line price and shipping to
// the probe destination read back, and the cart emptied after every target.
// It changes state on the shop, so it runs only after ownership is verified,
// and every problem is reported, never swallowed.
//
// SKELETON: implemented in the Shopify probe work. Until then it reports that
// it did not run.

import type { CollectContext, CollectIssue, Sighting } from '@regmark/core';

export type ShopifyProbeTarget = { variantId: string; productId?: string; sku?: string; url?: string };
export type ShopifyProbeOptions = { shipTo: { country: string; postcode?: string; state?: string; city?: string } };

export async function probeShopifyCart(
  _ctx: CollectContext,
  targets: readonly ShopifyProbeTarget[],
  _options: ShopifyProbeOptions,
): Promise<{ sightings: Sighting[]; issues: CollectIssue[] }> {
  if (targets.length === 0) return { sightings: [], issues: [] };
  return { sightings: [], issues: [{ surface: 'checkout', code: 'probe-unsupported', message: 'the Shopify checkout probe is not built yet' }] };
}
