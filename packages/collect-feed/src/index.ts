import { type CollectContext, type CollectIssue, type CollectResult, type Fetched, FetchRefused, type Sighting } from '@regmark/core';
import { type FeedItem } from './item.ts';
import { mapItem } from './map.ts';
import { readTsv } from './tsv.ts';
import { readXml } from './xml.ts';

export type FeedOptions = {
  /** Currency to assume when a price in the feed carries none. */
  defaultCurrency?: string | null;
};

/** Pure. Parses a Google Merchant Center format feed: RSS 2.0, Atom, or tab-separated text. */
export function parseFeed(
  body: string,
  feedUrl: string,
  fetchedAt: string,
  now: Date,
  options: FeedOptions = {},
): CollectResult {
  const text = body.replace(/^\uFEFF/, '').trimStart();
  const parseError = (message: string): CollectResult => ({
    sightings: [],
    issues: [{ surface: 'feed', code: 'parse-error', message, locator: feedUrl }],
  });

  let items: FeedItem[];
  if (text === '') return parseError('feed is empty');
  if (text.startsWith('<')) {
    const read = readXml(text);
    if ('error' in read) return parseError(read.error);
    items = read.items;
  } else {
    items = readTsv(text);
  }

  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [];
  const ctx = { feedUrl, fetchedAt, now, defaultCurrency: options.defaultCurrency ?? null };
  items.forEach((item, index) => {
    const mapped = mapItem(item, index + 1, ctx);
    if (mapped.sighting) sightings.push(mapped.sighting);
    issues.push(...mapped.issues);
  });
  return { sightings, issues };
}

/** Fetches the feed through ctx.fetcher and parses it. */
export async function collectFeed(ctx: CollectContext, feedUrl: string, options: FeedOptions = {}): Promise<CollectResult> {
  const fetchFailed = (message: string): CollectResult => ({
    sightings: [],
    issues: [{ surface: 'feed', code: 'fetch-failed', message, locator: feedUrl }],
  });

  let res: Fetched;
  try {
    res = await ctx.fetcher.get(feedUrl);
  } catch (err) {
    if (err instanceof FetchRefused) {
      const code = err.code === 'robots' ? 'robots-disallowed' : 'fetch-failed';
      return { sightings: [], issues: [{ surface: 'feed', code, message: err.message, locator: feedUrl }] };
    }
    return fetchFailed(err instanceof Error ? err.message : String(err));
  }
  if (res.status < 200 || res.status > 299) return fetchFailed(`HTTP ${res.status}`);
  return parseFeed(res.body, res.url, res.fetchedAt, ctx.now(), options);
}
