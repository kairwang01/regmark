// The Universal Commerce Protocol catalogue: the shop's business profile at
// /.well-known/ucp, and the catalogue capability it declares, read for the
// sampled products only. Read-only: no checkout session is created.
//
// SKELETON: implemented in the protocol collectors work.

import type { CollectContext, CollectResult } from '@regmark/core';
import type { EndpointOptions } from './refs.ts';

export async function collectUcp(_ctx: CollectContext, options: EndpointOptions): Promise<CollectResult> {
  if (options.products.length === 0) return { sightings: [], issues: [] };
  return { sightings: [], issues: [{ surface: 'ucp', code: 'not-built', message: 'the UCP collector is not built yet' }] };
}
