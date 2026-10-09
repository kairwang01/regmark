import { type CollectContext, type CollectIssue, type CollectResult, type Fetched, FetchRefused, type Observation, type Sighting } from '@regmark/core';
import { parseAcp } from './acp/index.ts';
import { type DateText, readDate } from './dates.ts';
import { type FeedItem } from './item.ts';
import { type MapContext, mapItem } from './map.ts';
import { readTsv } from './tsv.ts';
import { readXml } from './xml.ts';

export type FeedOptions = {
  /** Currency to assume when a price in the feed carries none. */
  defaultCurrency?: string | null;
  /**
   * Which surface the feed is, and so which format it is read in. 'feed' (the
   * default) is a Google Merchant feed: RSS 2.0, Atom or tab-separated text.
   * 'acp' is an Agentic Commerce Protocol product feed: OpenAI's file-upload
   * format as JSON Lines, CSV or TSV, or the protocol's Product and Variant
   * model as products.jsonl or a {"products": [...]} document.
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

type Parsed = { sightings: Sighting[]; issues: CollectIssue[]; dates: DateText[] } | { error: string };

/** A Google Merchant feed: RSS 2.0 or Atom, else tab-separated text. */
function parseGoogle(text: string, ctx: MapContext): Parsed {
  let items: FeedItem[];
  // Tab-separated text has nowhere to write a build time; only the header can date it.
  let dates: DateText[] = [];
  const detected = text.trimStart();
  if (detected.startsWith('<')) {
    const read = readXml(detected);
    if ('error' in read) return read;
    items = read.items;
    dates = read.dates;
  } else {
    try {
      items = readTsv(text);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [];
  items.forEach((item, index) => {
    const mapped = mapItem(item, index + 1, ctx);
    if (mapped.sighting) sightings.push(mapped.sighting);
    issues.push(...mapped.issues);
  });
  return { sightings, issues, dates };
}

/**
 * Pure. Parses a product feed in the format of its surface: a Google Merchant
 * Center feed, or an Agentic Commerce Protocol feed (see FeedOptions.surface).
 */
export function parseFeed(
  body: string,
  feedUrl: string,
  fetchedAt: string,
  now: Date,
  options: FeedOptions = {},
): CollectResult {
  const surface = options.surface ?? 'feed';
  // A leading tab is an empty TSV column, so preserve it until parsing.
  const text = body.replace(/^\uFEFF/, '');
  const parseError = (message: string): CollectResult => ({
    sightings: [],
    issues: [{ surface, code: 'parse-error', message, locator: feedUrl }],
  });
  if (text.trim() === '') return parseError('feed is empty');

  const ctx: MapContext = { feedUrl, fetchedAt, now, defaultCurrency: options.defaultCurrency ?? null };
  let parsed: Parsed;
  if (surface === 'acp') {
    const acp = parseAcp(text, ctx);
    // No ACP format has a place for the time the file was generated; only
    // the response header can date one.
    parsed = 'error' in acp ? acp : { ...acp, dates: [] };
  } else {
    parsed = parseGoogle(text, ctx);
  }
  if ('error' in parsed) return parseError(parsed.error);

  // One timestamp for the whole file, carried on every item so that whichever
  // items survive the sample, the time the feed was generated survives with them.
  const stamp = generatedAt(parsed.dates, options.lastModified, feedUrl, fetchedAt);
  if (stamp) for (const s of parsed.sightings) s.generatedAt = { ...stamp, surface: s.surface };
  return { sightings: parsed.sightings, issues: parsed.issues };
}

/**
 * Fetches the feed through ctx.fetcher and parses it. A feed published as a
 * gzip file, as feeds for agents usually are, is unpacked first.
 */
export async function collectFeed(ctx: CollectContext, feedUrl: string, options: FeedOptions = {}): Promise<CollectResult> {
  const surface = options.surface ?? 'feed';
  const fetchFailed = (message: string): CollectResult => ({
    sightings: [],
    issues: [{ surface, code: 'fetch-failed', message, locator: feedUrl }],
  });

  let res: Fetched;
  try {
    res = await ctx.fetcher.get(feedUrl, { gzipFile: true });
  } catch (err) {
    if (err instanceof FetchRefused) {
      const code = err.code === 'robots' ? 'robots-disallowed' : 'fetch-failed';
      return { sightings: [], issues: [{ surface, code, message: err.message, locator: feedUrl }] };
    }
    return fetchFailed(err instanceof Error ? err.message : String(err));
  }
  if (res.status < 200 || res.status > 299) return fetchFailed(`HTTP ${res.status}`);
  return parseFeed(res.body, res.url, res.fetchedAt, ctx.now(), { ...options, lastModified: res.headers['last-modified'] });
}
