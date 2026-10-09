import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ConfigError, runAudit } from '../src/audit.ts';
import type { AuditConfig } from '../src/audit.ts';

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
    [{ sample: Number.MAX_SAFE_INTEGER + 1 }, /sample must be a whole number/],
    [{ budget: [] }, /budget must be an object/],
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

test('malformed cloaking profiles are rejected before any network request', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end(''); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const store = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cases: Array<[unknown, RegExp]> = [
    ['yes', /cloaking must be an object/],
    [{ profiles: { agent: 'ChatGPT-User/1.0' } }, /unknown cloaking field "profiles"/],
    [{ userAgents: [] }, /cloaking.userAgents must be an object/],
    [{ userAgents: {} }, /must name at least one client/],
    [{ userAgents: { Agent: 'ChatGPT-User/1.0' } }, /short lower-case name/],
    [{ userAgents: { 'agent one': 'ChatGPT-User/1.0' } }, /short lower-case name/],
    [{ userAgents: { agent: '' } }, /cloaking.userAgents.agent must be a non-empty string/],
    [{ userAgents: { agent: 42 } }, /cloaking.userAgents.agent must be a non-empty string/],
    // A header injection through a User-Agent would let a config file send any header it liked.
    [{ userAgents: { agent: 'ChatGPT-User/1.0\r\nx-forwarded-for: 10.0.0.1' } }, /printable ASCII/],
  ];
  try {
    for (const [cloaking, message] of cases) {
      await assert.rejects(runAudit({ store, platform: 'auto', fetch: { allowPrivateNetwork: true, minIntervalMs: 0 }, cloaking } as AuditConfig), (err: unknown) => {
        assert.ok(err instanceof ConfigError, String(err));
        assert.match(err.message, message);
        return true;
      });
    }
    assert.equal(requests, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
