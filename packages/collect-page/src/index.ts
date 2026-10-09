// Reading a product page. One fetch, then four independent readings of the
// same HTML: what a person sees, the JSON-LD, the microdata and the Open
// Graph tags. They are kept apart on purpose, because the point of the tool
// is to notice when they disagree.

import { FetchRefused } from '@regmark/core';
import type { CollectContext, CollectIssue, CollectResult, Sighting } from '@regmark/core';
import { extractJsonLd } from './jsonld.ts';
import { extractMicrodata } from './microdata.ts';
import { extractOpenGraph } from './opengraph.ts';
import { extractText } from './text.ts';
import type { TextOptions } from './text.ts';
import { extractVisible } from './visible.ts';
import { documentOf } from './document.ts';
import type { VisibleOptions } from './visible.ts';

export { extractJsonLd } from './jsonld.ts';
export { extractMicrodata } from './microdata.ts';
export { extractOpenGraph } from './opengraph.ts';
export { extractText } from './text.ts';
export { extractVisible } from './visible.ts';
export type { TextOptions } from './text.ts';
export type { VisibleOptions } from './visible.ts';
export { collectViews } from './views.ts';
export type { ClientProfile } from './views.ts';

export type PageOptions = VisibleOptions & TextOptions;

/** Everything one page says, from HTML already in hand. Pure. */
export function extractPage(html: string, pageUrl: string, fetchedAt: string, options: PageOptions = {}): CollectResult {
  // All extractors only read the DOM. Parse once instead of building five
  // independent trees for each product page.
  const document = documentOf(html);
  const jsonld = extractJsonLd(document, pageUrl, fetchedAt);
  const microdata = extractMicrodata(document, pageUrl, fetchedAt);
  const opengraph = extractOpenGraph(document, pageUrl, fetchedAt);

  // A bare "$" on the page means whatever the page's own structured data
  // says it means, when all of it agrees on one currency.
  const stated = new Set<string>();
  for (const s of [...jsonld.sightings, ...microdata.sightings, ...opengraph.sightings]) {
    if (s.price?.value.currency) stated.add(s.price.value.currency);
  }
  const currency = options.currency ?? (stated.size === 1 ? [...stated][0]! : null);
  const visible = extractVisible(document, pageUrl, fetchedAt, { ...options, currency });

  const sightings: Sighting[] = [...visible.sightings, ...jsonld.sightings, ...microdata.sightings, ...opengraph.sightings];
  const text = extractText(document, pageUrl, options);
  if (text.length > 0) {
    // Text belongs to the page as a whole. It rides on the visible sighting,
    // or on one made for the purpose when the page showed no price.
    const carrier = visible.sightings[0];
    if (carrier) carrier.text = text;
    else sightings.unshift({ surface: 'page', scope: 'product', ids: { url: pageUrl }, text });
  }
  return { sightings, issues: [...visible.issues, ...jsonld.issues, ...microdata.issues, ...opengraph.issues] };
}

/**
 * Fetch each URL and read it. A page that cannot be fetched becomes an issue,
 * never an exception: one dead link must not end an audit.
 */
export async function collectPages(ctx: CollectContext, urls: readonly string[], options: PageOptions = {}): Promise<CollectResult> {
  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [];
  for (const url of urls) {
    try {
      const res = await ctx.fetcher.get(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
      if (res.status === 404 || res.status === 410) {
        issues.push({ surface: 'page', code: 'not-found', message: `HTTP ${res.status}`, locator: url });
        continue;
      }
      if (res.status < 200 || res.status > 299) {
        issues.push({ surface: 'page', code: 'fetch-failed', message: `HTTP ${res.status}`, locator: url });
        continue;
      }
      // Sightings are keyed by the URL that was asked for, so they join with
      // what the feed and the storefront API call the same product.
      const page = extractPage(res.body, url, res.fetchedAt, options);
      sightings.push(...page.sightings);
      issues.push(...page.issues);
    } catch (err) {
      const refused = err instanceof FetchRefused;
      issues.push({
        surface: 'page',
        code: refused && err.code === 'robots' ? 'robots-disallowed' : 'fetch-failed',
        message: (err as Error).message,
        locator: url,
      });
      ctx.log('warn', `page not read: ${url}`);
    }
  }
  return { sightings, issues };
}
