// The cloaking check's collector: the same product pages fetched again, once
// per client profile, as the shop's verified owner, so that a page which
// answers a shopping agent differently from a browser can be noticed.
//
// It judges nothing. Every sighting it returns carries `via` (the profile
// name); the graph keeps those apart from the offer facts and the
// content.cloaking rule compares them.
//
// SKELETON: implemented in the cloaking work. Until then it reads nothing.

import type { CollectContext, CollectResult } from '@regmark/core';
import type { PageOptions } from './index.ts';

/** A client to pose as: a name for reports and the User-Agent it sends. */
export type ClientProfile = { name: string; userAgent: string };

export async function collectViews(
  _ctx: CollectContext,
  _urls: readonly string[],
  _profiles: readonly ClientProfile[],
  _options: PageOptions = {},
): Promise<CollectResult> {
  return { sightings: [], issues: [] };
}
