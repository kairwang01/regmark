import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type CollectContext, type Fetched, type Fetcher, FetchRefused } from '@regmark/core';
import { collectFeed } from '../src/index.ts';
import { FEED_URL, FETCHED_AT, NOW, rss } from './support.ts';

const BODY = rss(`<item>
  <g:id>A-1</g:id><title>Cup</title><link>https://shop.example/p/cup</link><g:price>4.00 USD</g:price>
</item>`);

/** A fetcher that answers every get with one canned result or throws one error. */
function fakeFetcher(answer: Fetched | Error): Fetcher {
  return {
    async get() {
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async send() {
      throw new Error('send is not used by the feed collector');
    },
    async query() {
      throw new Error('query is not used by the feed collector');
    },
  };
}

function contextWith(fetcher: Fetcher): CollectContext {
  return { store: new URL('https://shop.example'), fetcher, now: () => NOW, log: () => {} };
}

function response(overrides: Partial<Fetched> = {}): Fetched {
  return {
    url: 'https://shop.example/feeds/merchant.xml?v=2',
    status: 200,
    headers: { 'content-type': 'application/xml' },
    body: BODY,
    fetchedAt: FETCHED_AT,
    ...overrides,
  };
}

describe('collectFeed', () => {
  it('parses the fetched body, using the final URL and fetch time from the response', async () => {
    const result = await collectFeed(contextWith(fakeFetcher(response())), FEED_URL);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings[0]?.price, {
      value: { units: 40000, currency: 'USD' },
      raw: '4.00 USD',
      surface: 'feed',
      locator: 'https://shop.example/feeds/merchant.xml?v=2#item[id="A-1"]/price',
      fetchedAt: FETCHED_AT,
    });
    assert.equal(result.sightings.length, 1);
  });

  it('reports a robots refusal as robots-disallowed', async () => {
    const refusal = new FetchRefused('robots', FEED_URL);
    const result = await collectFeed(contextWith(fakeFetcher(refusal)), FEED_URL);
    assert.deepStrictEqual(result, {
      sightings: [],
      issues: [{ surface: 'feed', code: 'robots-disallowed', message: refusal.message, locator: FEED_URL }],
    });
  });

  it('reports any other refusal as fetch-failed', async () => {
    const refusal = new FetchRefused('foreign-host', FEED_URL);
    const result = await collectFeed(contextWith(fakeFetcher(refusal)), FEED_URL);
    assert.deepStrictEqual(result, {
      sightings: [],
      issues: [{ surface: 'feed', code: 'fetch-failed', message: refusal.message, locator: FEED_URL }],
    });
  });

  it('reports an error that is not a refusal as fetch-failed', async () => {
    const result = await collectFeed(contextWith(fakeFetcher(new Error('socket hang up'))), FEED_URL);
    assert.deepStrictEqual(result.sightings, []);
    assert.deepStrictEqual(result.issues, [
      { surface: 'feed', code: 'fetch-failed', message: 'socket hang up', locator: FEED_URL },
    ]);
  });

  it('reports HTTP 404 as fetch-failed and parses nothing', async () => {
    const result = await collectFeed(contextWith(fakeFetcher(response({ status: 404, body: 'Not found' }))), FEED_URL);
    assert.deepStrictEqual(result.sightings, []);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0]?.code, 'fetch-failed');
    assert.equal(result.issues[0]?.message, 'HTTP 404');
  });

  it('passes defaultCurrency through to parsing', async () => {
    const body = rss(`<item><g:id>A-2</g:id><title>Bowl</title><link>https://shop.example/p/bowl</link><g:price>12</g:price></item>`);
    const result = await collectFeed(contextWith(fakeFetcher(response({ body }))), FEED_URL, { defaultCurrency: 'CAD' });
    assert.equal(result.sightings[0]?.price?.value.currency, 'CAD');
    assert.equal(
      result.sightings[0]?.price?.locator,
      `https://shop.example/feeds/merchant.xml?v=2#item[id="A-2"]/price`,
    );
  });
});
