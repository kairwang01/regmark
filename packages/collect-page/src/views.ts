// The cloaking check's collector: the same product pages fetched again, once
// per client profile, as the shop's verified owner, so that a page which
// answers a shopping agent differently from a browser can be noticed.
//
// It judges nothing. Every sighting it returns carries `via` (the profile
// name); the graph keeps those apart from the offer facts and the
// content.cloaking rule compares them.

import type { CollectContext, CollectIssue, CollectResult, Sighting } from '@regmark/core';
import { extractPage } from './index.ts';
import type { PageOptions } from './index.ts';

/** A client to pose as: a name for reports and the User-Agent it sends. */
export type ClientProfile = { name: string; userAgent: string };

/**
 * Fetch each page once per profile and read it the way collectPages does.
 *
 * The profiles for one page are fetched one after another, before the next
 * page, so the views that get compared are as close together in time as the
 * pacing allows: a price that changed between two reads must not look like a
 * page that lies.
 *
 * Posing as another client is an owner read (see RequestOptions.asOwner), so
 * the fetcher refuses it until ownership has been verified. That refusal,
 * like every other failure, becomes an issue that names the profile.
 */
export async function collectViews(
  ctx: CollectContext,
  urls: readonly string[],
  profiles: readonly ClientProfile[],
  options: PageOptions = {},
): Promise<CollectResult> {
  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [];
  for (const url of urls) {
    for (const profile of profiles) {
      try {
        const res = await ctx.fetcher.get(url, {
          asOwner: true,
          headers: { 'user-agent': profile.userAgent, accept: 'text/html,application/xhtml+xml' },
        });
        // An owner read does not follow a redirect off the page's origin, so
        // the redirect itself comes back: this client was sent elsewhere.
        if (res.status >= 300 && res.status < 400 && res.headers['location']) {
          issues.push({ surface: 'page', code: 'view-redirected', message: `as ${profile.name}: redirected to ${res.headers['location']}`, locator: url });
          continue;
        }
        if (res.status < 200 || res.status > 299) {
          issues.push({ surface: 'page', code: 'view-failed', message: `as ${profile.name}: HTTP ${res.status}`, locator: url });
          continue;
        }
        // The fetcher drops caller headers when a redirect leaves the origin,
        // so whatever answered there was not asked as this client. Reading it
        // as this client's view would be a guess.
        if (new URL(res.url).origin !== new URL(url).origin) {
          issues.push({ surface: 'page', code: 'view-redirected', message: `as ${profile.name}: answered from ${res.url}`, locator: url });
          continue;
        }
        // Each statement keeps the URL it names, exactly as in the ordinary
        // read, so the graph hands it to the same product: the page's own
        // offers to this product, and a related product's card to that
        // product, never to this one. The extractors' own issues are left
        // out: the ordinary read reports them once, and repeating them per
        // profile would count one broken script tag several times.
        const page = extractPage(res.body, url, res.fetchedAt, options);
        for (const s of page.sightings) sightings.push({ ...s, via: profile.name });
      } catch (err) {
        issues.push({ surface: 'page', code: 'view-failed', message: `as ${profile.name}: ${(err as Error).message}`, locator: url });
        ctx.log('warn', `page not read as ${profile.name}: ${url}`);
      }
    }
  }
  return { sightings, issues };
}
