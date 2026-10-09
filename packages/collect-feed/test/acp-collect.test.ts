// collectFeed with surface 'acp': every issue and every timestamp is the acp
// surface's, and the feed is fetched as a file that may be gzipped.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type CollectContext, type Fetched, type Fetcher, FetchRefused, type RequestOptions } from '@regmark/core';
import { collectFeed } from '../src/index.ts';
import { ACP_URL, FETCHED_AT, jsonl, MUG, NOW, rss } from './support.ts';

/** A fetcher that answers every get with one canned result, or throws, and remembers the options it was given. */
function fakeFetcher(answer: Fetched | Error, seen: RequestOptions[] = []): Fetcher {
  return {
    async get(_url, options) {
      seen.push(options ?? {});
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

const contextWith = (fetcher: Fetcher): CollectContext => ({ store: new URL('https://shop.example'), fetcher, now: () => NOW, log: () => {} });

function response(overrides: Partial<Fetched> = {}): Fetched {
  return {
    url: 'https://shop.example/feeds/acp.jsonl.gz',
    status: 200,
    headers: { 'content-type': 'application/gzip' },
    body: jsonl(MUG),
    fetchedAt: FETCHED_AT,
    ...overrides,
  };
}

const acp = (fetcher: Fetcher) => collectFeed(contextWith(fetcher), ACP_URL, { surface: 'acp' });

describe('collectFeed for an ACP feed', () => {
  it('asks for a gzip file to be unpacked, and reads the body on the acp surface at the final URL', async () => {
    const seen: RequestOptions[] = [];
    const result = await acp(fakeFetcher(response(), seen));
    assert.deepStrictEqual(seen, [{ gzipFile: true }]);
    assert.deepStrictEqual(result.issues, []);
    assert.equal(result.sightings[0]?.surface, 'acp');
    assert.equal(result.sightings[0]?.price?.locator, 'https://shop.example/feeds/acp.jsonl.gz#item[id="MUG-350-BLUE"]/price');
  });

  it('asks the same for a Google feed, which may also be published as a .gz file', async () => {
    const seen: RequestOptions[] = [];
    const body = rss('<item><g:id>A-1</g:id><link>https://shop.example/p/a</link></item>');
    await collectFeed(contextWith(fakeFetcher(response({ body }), seen)), ACP_URL);
    assert.deepStrictEqual(seen, [{ gzipFile: true }]);
  });

  it('dates every item by the Last-Modified header, on the acp surface', async () => {
    const result = await acp(fakeFetcher(response({ body: jsonl(MUG, { ...MUG, item_id: 'MUG-2' }), headers: { 'last-modified': 'Tue, 06 Oct 2026 23:15:00 GMT' } })));
    const stamp = {
      value: '2026-10-06T23:15:00.000Z',
      raw: 'Tue, 06 Oct 2026 23:15:00 GMT',
      locator: 'https://shop.example/feeds/acp.jsonl.gz#header(last-modified)',
      fetchedAt: FETCHED_AT,
      surface: 'acp',
    };
    assert.deepStrictEqual(result.sightings.map((s) => s.generatedAt), [stamp, stamp]);
  });

  it('gives no timestamp without the header: no ACP format has a place for one', async () => {
    const result = await acp(fakeFetcher(response()));
    assert.ok(result.sightings.every((s) => s.generatedAt === undefined));
  });

  it('reports a robots refusal, an HTTP error and a fetch failure on the acp surface', async () => {
    const robots = await acp(fakeFetcher(new FetchRefused('robots', ACP_URL)));
    assert.deepStrictEqual(robots.issues.map((i) => [i.surface, i.code]), [['acp', 'robots-disallowed']]);
    const missing = await acp(fakeFetcher(response({ status: 404, body: 'Not found' })));
    assert.deepStrictEqual(missing.issues, [{ surface: 'acp', code: 'fetch-failed', message: 'HTTP 404', locator: ACP_URL }]);
    const broken = await acp(fakeFetcher(new FetchRefused('network', ACP_URL, 'gzip: unexpected end of file')));
    assert.deepStrictEqual(broken.issues.map((i) => [i.surface, i.code]), [['acp', 'fetch-failed']]);
    assert.deepStrictEqual([...robots.sightings, ...missing.sightings, ...broken.sightings], []);
  });

  it('reports a body it cannot read as a parse-error on the acp surface', async () => {
    const result = await acp(fakeFetcher(response({ body: '<rss></rss>' })));
    assert.deepStrictEqual(result.issues.map((i) => [i.surface, i.code, i.locator]), [['acp', 'parse-error', 'https://shop.example/feeds/acp.jsonl.gz']]);
  });
});
