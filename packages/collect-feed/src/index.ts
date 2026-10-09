import { type CollectContext, type CollectIssue, type CollectResult, type Fetched, FetchRefused, type Observation, type Sighting } from '@regmark/core';
import { type DateText, readDate } from './dates.ts';
import { type FeedItem } from './item.ts';
import { mapItem } from './map.ts';
import { readTsv } from './tsv.ts';
import { readXml } from './xml.ts';

export type FeedOptions = {
  /** Currency to assume when a price in the feed carries none. */
  defaultCurrency?: string | null;
  /**
   * Which surface the feed is. 'feed' (the default) is a Google Merchant
   * format feed; 'acp' is an Agentic Commerce Protocol product feed.
   * SKELETON: 'acp' is implemented in the ACP feed work.
   */
  surface?: 'feed' | 'acp';
  /**
   * The Last-Modified header of the response the feed came in, as sent.
   * collectFeed fills it in. It dates the feed only when the document itself
   * gives no time it was generated.
   */
  lastModified?: string;
};

/**
 * When the feed says it was generated: the first of its own timestamps that
 * reads as a date, else the Last-Modified header. Undefined when neither
 * does; a feed with no readable timestamp is not given one.
 */
function generatedAt(
  dates: readonly DateText[],
  lastModified: string | undefined,
  feedUrl: string,
  fetchedAt: string,
): Omit<Observation<string>, 'surface'> | undefined {
  // HTTP dates are RFC 822 dates in GMT, so one reader serves both.
  const candidates = lastModified?.trim() ? [...dates, { text: lastModified, path: 'header(last-modified)', syntax: 'rfc822' as const }] : dates;
  for (const candidate of candidates) {
    const value = readDate(candidate);
    if (value) return { value, raw: candidate.text, locator: `${feedUrl}#${candidate.path}`, fetchedAt };
  }
  return undefined;
}

/** Pure. Parses a Google Merchant Center format feed: RSS 2.0, Atom, or tab-separated text. */
export function parseFeed(
  body: string,
  feedUrl: string,
  fetchedAt: string,
  now: Date,
  options: FeedOptions = {},
): CollectResult {
  // A leading tab is an empty TSV column, so preserve it until parsing.
  const text = body.replace(/^\uFEFF/, '');
  const detected = text.trimStart();
  const parseError = (message: string): CollectResult => ({
    sightings: [],
    issues: [{ surface: 'feed', code: 'parse-error', message, locator: feedUrl }],
  });

  let items: FeedItem[];
  // Tab-separated text has nowhere to write a build time; only the header can date it.
  let dates: DateText[] = [];
  if (detected === '') return parseError('feed is empty');
  if (detected.startsWith('<')) {
    const read = readXml(detected);
    if ('error' in read) return parseError(read.error);
    items = read.items;
    dates = read.dates;
  } else {
    try {
      items = readTsv(text);
    } catch (err) {
      return parseError(err instanceof Error ? err.message : String(err));
    }
  }

  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [];
  const ctx = { feedUrl, fetchedAt, now, defaultCurrency: options.defaultCurrency ?? null };
  // One timestamp for the whole file, carried on every item so that whichever
  // items survive the sample, the time the feed was generated survives with them.
  const stamp = generatedAt(dates, options.lastModified, feedUrl, fetchedAt);
  items.forEach((item, index) => {
    const mapped = mapItem(item, index + 1, ctx);
    if (mapped.sighting) {
      if (stamp) mapped.sighting.generatedAt = { ...stamp, surface: mapped.sighting.surface };
      sightings.push(mapped.sighting);
    }
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
  return parseFeed(res.body, res.url, res.fetchedAt, ctx.now(), { ...options, lastModified: res.headers['last-modified'] });
}
