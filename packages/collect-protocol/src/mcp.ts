// A shop's storefront MCP server: the tools a shopping agent calls to search
// the catalogue, asked about the sampled products only. Read-only: no cart
// tool is called.
//
// SKELETON: implemented in the protocol collectors work.

import type { CollectContext, CollectResult } from '@regmark/core';
import type { EndpointOptions } from './refs.ts';

export async function collectMcp(_ctx: CollectContext, options: EndpointOptions): Promise<CollectResult> {
  if (options.products.length === 0) return { sightings: [], issues: [] };
  return { sightings: [], issues: [{ surface: 'mcp', code: 'not-built', message: 'the MCP collector is not built yet' }] };
}
