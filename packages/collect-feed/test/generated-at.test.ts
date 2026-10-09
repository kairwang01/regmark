import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CollectContext, Fetched, Fetcher, Sighting } from '@regmark/core';
import { collectFeed, parseFeed } from '../src/index.ts';
import { FEED_URL, FETCHED_AT, GOOGLE_NS, NOW, rss } from './support.ts';

const ITEMS = `
<item><g:id>A-1</g:id><title>Cup</title><link>https://shop.example/p/cup</link><g:price>4.00 USD</g:price></item>
<item><g:id>A-2</g:id><title>Bowl</title><link>https://shop.example/p/bowl</link><g:price>9.00 USD</g:price></item>`;

/** An RSS feed whose channel carries the given elements before its items. */
function rssWith(channel: string): string {
  return rss(`${channel}\n${ITEMS}`);
}

function atomWith(head: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" ${GOOGLE_NS}>
  <title>Shop</title>
  ${head}
  <entry>
    <g:id>MUG-1</g:id><title>Mug</title><link href="https://shop.example/p/mug"/><g:price>12.00 USD</g:price>
    <updated>2026-10-08T09:00:00Z</updated>
  </entry>
</feed>`;
}

const TSV = 'id\ttitle\tlink\tprice\nA-1\tCup\thttps://shop.example/p/cup\t4.00 USD\n';

const stamps = (sightings: Sighting[]) => sightings.map((s) => s.generatedAt);

describe('when the feed was generated', () => {
  it('reads the RSS lastBuildDate onto every item, with the exact text and where it was', () => {
    const result = parseFeed(rssWith('<lastBuildDate>Wed, 30 Sep 2026 08:00:00 GMT</lastBuildDate>'), FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.issues, []);
    const expected = {
      value: '2026-09-30T08:00:00.000Z',
      raw: 'Wed, 30 Sep 2026 08:00:00 GMT',
      locator: `${FEED_URL}#/rss/channel/lastBuildDate`,
      fetchedAt: FETCHED_AT,
      surface: 'feed',
    };
    assert.deepStrictEqual(stamps(result.sightings), [expected, expected]);
  });

  it('converts an offset to UTC and keeps the text as written', () => {
    const result = parseFeed(rssWith('<lastBuildDate>Wed, 30 Sep 2026 10:00:00 +0200</lastBuildDate>'), FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings[0]?.generatedAt?.value, '2026-09-30T08:00:00.000Z');
    assert.equal(result.sightings[0]?.generatedAt?.raw, 'Wed, 30 Sep 2026 10:00:00 +0200');
  });

  it('prefers lastBuildDate to pubDate, even when pubDate is later', () => {
    const channel = '<pubDate>Thu, 08 Oct 2026 08:00:00 GMT</pubDate><lastBuildDate>Wed, 30 Sep 2026 08:00:00 GMT</lastBuildDate>';
    const result = parseFeed(rssWith(channel), FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings[0]?.generatedAt?.value, '2026-09-30T08:00:00.000Z');
  });

  it('falls back to the channel pubDate when there is no lastBuildDate', () => {
    const result = parseFeed(rssWith('<pubDate>Thu, 08 Oct 2026 06:30:00 GMT</pubDate>'), FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings[0]?.generatedAt?.value, '2026-10-08T06:30:00.000Z');
    assert.equal(result.sightings[0]?.generatedAt?.locator, `${FEED_URL}#/rss/channel/pubDate`);
  });

  it('falls back to pubDate when lastBuildDate is not a date', () => {
    const channel = '<lastBuildDate>yesterday</lastBuildDate><pubDate>Thu, 08 Oct 2026 06:30:00 GMT</pubDate>';
    const result = parseFeed(rssWith(channel), FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings[0]?.generatedAt?.locator, `${FEED_URL}#/rss/channel/pubDate`);
    assert.deepStrictEqual(result.issues, []);
  });

  it('does not read an item pubDate as the time the feed was generated', () => {
    const body = rss(`<item><g:id>A-1</g:id><title>Cup</title><link>https://shop.example/p/cup</link><g:price>4.00 USD</g:price>
      <pubDate>Wed, 30 Sep 2026 08:00:00 GMT</pubDate></item>`);
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings.length, 1);
    assert.equal('generatedAt' in result.sightings[0]!, false);
  });

  it('reads the Atom feed-level updated, not an entry updated', () => {
    const result = parseFeed(atomWith('<updated>2026-09-30T10:00:00+02:00</updated>'), FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.sightings[0]?.generatedAt, {
      value: '2026-09-30T08:00:00.000Z',
      raw: '2026-09-30T10:00:00+02:00',
      locator: `${FEED_URL}#/feed/updated`,
      fetchedAt: FETCHED_AT,
      surface: 'feed',
    });
  });

  it('gives an Atom feed with only entry-level updated no timestamp', () => {
    const result = parseFeed(atomWith(''), FEED_URL, FETCHED_AT, NOW);
    assert.equal(result.sightings.length, 1);
    assert.equal('generatedAt' in result.sightings[0]!, false);
  });

  it('leaves out a timestamp that is not a date rather than guessing, and reports no issue for it', () => {
    for (const channel of [
      '<lastBuildDate>Wed, 30 Sep 2026 08:00:00</lastBuildDate>',
      '<lastBuildDate>31 Sep 2026 08:00:00 GMT</lastBuildDate>',
      '<lastBuildDate>2026-09-30T08:00:00Z</lastBuildDate>',
      '<lastBuildDate></lastBuildDate>',
    ]) {
      const result = parseFeed(rssWith(channel), FEED_URL, FETCHED_AT, NOW);
      assert.equal(result.sightings.length, 2, channel);
      assert.ok(result.sightings.every((s) => !('generatedAt' in s)), channel);
      assert.deepStrictEqual(result.issues, [], channel);
    }
    const atom = parseFeed(atomWith('<updated>2026-09-30T08:00:00</updated>'), FEED_URL, FETCHED_AT, NOW);
    assert.equal('generatedAt' in atom.sightings[0]!, false);
  });

  it('gives no timestamp when the feed states none and no header was passed', () => {
    for (const body of [rss(ITEMS), TSV]) {
      const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
      assert.ok(result.sightings.length > 0);
      assert.ok(result.sightings.every((s) => !('generatedAt' in s)));
    }
  });

  it('falls back to Last-Modified for a tab-separated feed, which has nowhere to write one', () => {
    const result = parseFeed(TSV, FEED_URL, FETCHED_AT, NOW, { lastModified: 'Tue, 06 Oct 2026 23:15:00 GMT' });
    assert.deepStrictEqual(result.sightings[0]?.generatedAt, {
      value: '2026-10-06T23:15:00.000Z',
      raw: 'Tue, 06 Oct 2026 23:15:00 GMT',
      locator: `${FEED_URL}#header(last-modified)`,
      fetchedAt: FETCHED_AT,
      surface: 'feed',
    });
  });

  it('falls back to Last-Modified when the XML gives no readable date', () => {
    const header = { lastModified: 'Tue, 06 Oct 2026 23:15:00 GMT' };
    const plain = parseFeed(rss(ITEMS), FEED_URL, FETCHED_AT, NOW, header);
    assert.equal(plain.sightings[0]?.generatedAt?.locator, `${FEED_URL}#header(last-modified)`);
    const unreadable = parseFeed(rssWith('<lastBuildDate>soon</lastBuildDate>'), FEED_URL, FETCHED_AT, NOW, header);
    assert.equal(unreadable.sightings[0]?.generatedAt?.locator, `${FEED_URL}#header(last-modified)`);
  });

  it('prefers the date the document states to Last-Modified', () => {
    const body = rssWith('<lastBuildDate>Wed, 30 Sep 2026 08:00:00 GMT</lastBuildDate>');
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW, { lastModified: 'Thu, 08 Oct 2026 11:00:00 GMT' });
    assert.equal(result.sightings[0]?.generatedAt?.value, '2026-09-30T08:00:00.000Z');
  });

  it('leaves out a Last-Modified that is not a date, or is blank', () => {
    for (const lastModified of ['0', 'never', '', '   ', '2026-10-06T23:15:00Z']) {
      const result = parseFeed(TSV, FEED_URL, FETCHED_AT, NOW, { lastModified });
      assert.equal('generatedAt' in result.sightings[0]!, false, JSON.stringify(lastModified));
    }
  });

  it('puts no timestamp on a feed that failed to parse, since it has no items', () => {
    const result = parseFeed('<rss><channel><lastBuildDate>Wed, 30 Sep 2026 08:00:00 GMT</lastBuildDate>', FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.sightings, []);
    assert.equal(result.issues[0]?.code, 'parse-error');
  });
});

describe('collectFeed and Last-Modified', () => {
  const fetcherFor = (res: Fetched): Fetcher => ({
    async get() {
      return res;
    },
    async send() {
      throw new Error('send is not used by the feed collector');
    },
    async query() {
      throw new Error('query is not used by the feed collector');
    },
  });
  const contextFor = (res: Fetched): CollectContext => ({ store: new URL('https://shop.example'), fetcher: fetcherFor(res), now: () => NOW, log: () => {} });
  const response = (headers: Record<string, string>, body = rss(ITEMS)): Fetched => ({
    url: 'https://shop.example/feeds/merchant.xml?v=2',
    status: 200,
    headers: { 'content-type': 'application/xml', ...headers },
    body,
    fetchedAt: FETCHED_AT,
  });

  it('dates the feed by the response header, located at the final URL', async () => {
    const result = await collectFeed(contextFor(response({ 'last-modified': 'Tue, 06 Oct 2026 23:15:00 GMT' })), FEED_URL);
    assert.deepStrictEqual(result.sightings[0]?.generatedAt, {
      value: '2026-10-06T23:15:00.000Z',
      raw: 'Tue, 06 Oct 2026 23:15:00 GMT',
      locator: 'https://shop.example/feeds/merchant.xml?v=2#header(last-modified)',
      fetchedAt: FETCHED_AT,
      surface: 'feed',
    });
  });

  it('gives no timestamp when neither the body nor the response has one', async () => {
    const result = await collectFeed(contextFor(response({})), FEED_URL);
    assert.equal(result.sightings.length, 2);
    assert.ok(result.sightings.every((s) => !('generatedAt' in s)));
  });

  it('keeps the options it was given alongside the header', async () => {
    const body = rss('<item><g:id>A-3</g:id><title>Jug</title><link>https://shop.example/p/jug</link><g:price>12</g:price></item>');
    const result = await collectFeed(contextFor(response({ 'last-modified': 'Tue, 06 Oct 2026 23:15:00 GMT' }, body)), FEED_URL, { defaultCurrency: 'CAD' });
    assert.equal(result.sightings[0]?.price?.value.currency, 'CAD');
    assert.equal(result.sightings[0]?.generatedAt?.value, '2026-10-06T23:15:00.000Z');
  });
});
