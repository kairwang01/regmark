import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ConfigError, runAudit } from '../src/audit.ts';
import type { AuditConfig } from '../src/audit.ts';
import { parseDuration } from '../src/config.ts';

test('malformed nested configuration is rejected before any network request', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end(''); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const store = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ fetch: { hosts: ['elsewhere.example'] } }, /unknown fetch field/],
    [{ fetch: { allowPrivateNetwork: 'false' } }, /must be a boolean/],
    [{ fetch: { respectRobots: 0 } }, /must be a boolean/],
    [{ fetch: { timeoutMs: 0 } }, /fetch.timeoutMs/],
    [{ fetch: { minIntervalMs: 2 ** 31 } }, /fetch.minIntervalMs/],
    [{ fetch: null }, /fetch must be an object/],
    [{ fetch: { userAgent: 'test\r\nx-bypass: true' } }, /printable ASCII/],
    [{ checkout: false }, /checkout must be an object/],
    [{ checkout: { shipTo: { country: 'US', postCode: '94103' } } }, /unknown checkout.shipTo field/],
    [{ strict: 'false' }, /strict must be a boolean/],
    [{ page: { currency: 123 } }, /page.currency/],
    [{ page: { descriptionSelectors: 'p' } }, /list of non-empty strings/],
    [{ pages: ['ftp://shop.example/product'] }, /http or https/],
    [{ feed: 'https://user:password@shop.example/feed' }, /URL credentials/],
    [{ acpFeed: 'sftp://shop.example/products.jsonl.gz' }, /acpFeed must be an http or https URL/],
    [{ acpFeed: 42 }, /acpFeed/],
    [{ sample: Number.MAX_SAFE_INTEGER + 1 }, /sample must be a whole number/],
    [{ budget: [] }, /budget must be an object/],
    [{ feed: '/feed.xml', maxAge: '24h' }, /maxAge must be an object/],
    [{ feed: '/feed.xml', maxAge: { page: '24h' } }, /unknown maxAge field "page"; the fields are feed, acp/],
    [{ feed: '/feed.xml', maxAge: { feed: 'soon' } }, /maxAge\.feed must be a duration such as "90m", "24h" or "7d"; got "soon"/],
    [{ feed: '/feed.xml', maxAge: { feed: 24 } }, /maxAge\.feed must be a duration/],
    [{ feed: '/feed.xml', maxAge: { feed: '0h' } }, /maxAge\.feed must be a duration/],
    [{ feed: '/feed.xml', maxAge: { feed: '1w' } }, /maxAge\.feed must be a duration/],
    [{ maxAge: { feed: '24h' } }, /maxAge\.feed is set, but no feed is read; give --feed or the feed field/],
    [{ feed: '/feed.xml', maxAge: { feed: '24h', acp: '24h' } }, /maxAge\.acp is set, but no acp is read; give --acp-feed or the acpFeed field/],
  ];
  try {
    for (const [invalid, message] of cases) {
      await assert.rejects(runAudit({ store, platform: 'auto', fetch: { allowPrivateNetwork: true, minIntervalMs: 0 }, ...invalid } as AuditConfig), (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, message);
        return true;
      });
    }
    assert.equal(requests, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('a duration is a whole number of minutes, hours or days', () => {
  assert.equal(parseDuration('90m'), 90 * 60_000);
  assert.equal(parseDuration('24h'), 86_400_000);
  assert.equal(parseDuration('7d'), 7 * 86_400_000);
  assert.equal(parseDuration(' 24H '), 86_400_000);
  for (const text of ['0h', '24', 'h', '1.5h', '-1d', '1w', '24 hours', '', '1234567h']) {
    assert.equal(parseDuration(text), undefined, text);
  }
  assert.equal(parseDuration(24), undefined);
  assert.equal(parseDuration(undefined), undefined);
});
