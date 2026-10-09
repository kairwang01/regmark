import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { FetchRefused } from '@regmark/core';
import { AGENT_PROFILES, collectUcp } from '../src/index.ts';
import type { ProductRef } from '../src/index.ts';
import { businessProfile, fakeEndpoint, found, lookupAnswer, mcpServer, methods, ORIGIN, product, PROFILE_URL, REST, toolCalls, V, variant } from './fake-endpoint.ts';
import type { Call } from './fake-endpoint.ts';

const TEE: ProductRef = { url: `${ORIGIN}/products/classic-tee`, title: 'Classic Tee', handle: 'classic-tee', variantIds: ['101', '102'] };
const LOOKUP = `${REST}/catalog/lookup`;

/** A REST lookup that finds every asked-for id as its own variant of one product. */
const echo = (call: Call) => {
  const ids = (call.body as { ids: string[] }).ids;
  return { body: lookupAnswer([product('100', 'classic-tee', ids.map((id) => found(variant(id, `SKU-${id}`, 3900), [id, 'exact'])))]) };
};

describe('collectUcp: discovery and the REST binding', () => {
  it('reads the business profile, then looks the sampled variants up with the headers UCP requires', async () => {
    const { ctx, calls } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile() }, [LOOKUP]: echo });
    const result = await collectUcp(ctx, { products: [TEE] });

    assert.deepEqual(result.issues, []);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [`GET ${PROFILE_URL}`, `POST ${LOOKUP}`]);
    assert.equal(calls[0]!.headers.accept, 'application/json');
    const post = calls[1]!;
    assert.deepEqual(post.body, { ids: ['101', '102'] });
    assert.equal(post.headers['ucp-agent'], `profile="${AGENT_PROFILES[V]}"`);
    assert.match(post.headers['request-id']!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(post.headers['content-digest'], `sha-256=:${createHash('sha256').update(JSON.stringify(post.body)).digest('base64')}:`);
    assert.deepEqual(result.sightings.map((s) => [s.surface, s.scope, s.ids.sku, s.ids.url, s.ids.aliases]), [
      ['ucp', 'variant', 'SKU-101', TEE.url, ['101']],
      ['ucp', 'variant', 'SKU-102', TEE.url, ['102']],
    ]);
    assert.equal(result.sightings[0]!.price!.locator, `${LOOKUP}#lookup_catalog[id="101"]/products/0/variants/0/price`);
  });

  it('reads the profile at the configured URL, and sends the configured agent profile', async () => {
    const custom = 'https://cdn.shop.example/agents/ucp.json';
    const { ctx, calls } = fakeEndpoint({ [custom]: { body: businessProfile() }, [LOOKUP]: echo });
    await collectUcp(ctx, { url: custom, agentProfile: 'https://agent.example/profile.json', products: [TEE] });
    assert.equal(calls[0]!.url, custom);
    assert.equal(calls[1]!.headers['ucp-agent'], 'profile="https://agent.example/profile.json"');
  });

  it('prefers REST when the profile offers REST and MCP', async () => {
    const services = [
      { version: V, transport: 'mcp', endpoint: `${ORIGIN}/ucp/mcp` },
      { version: V, transport: 'rest', endpoint: `${REST}/` },
    ];
    const { ctx, calls } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ services }) }, [LOOKUP]: echo });
    await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(calls.map((c) => c.url), [PROFILE_URL, LOOKUP]);
  });

  it('asks Shopify for its gids, and for sold-out variants too when the profile declares Shopify’s catalogue extension', async () => {
    const capabilities = { 'dev.ucp.shopping.catalog.lookup': [{ version: V }], 'dev.shopify.catalog': [{ version: V, extends: ['dev.ucp.shopping.catalog.lookup'] }] };
    const { ctx, calls } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ capabilities }) }, [LOOKUP]: { body: lookupAnswer([]) } });
    await collectUcp(ctx, { platform: 'shopify', products: [TEE] });
    assert.deepEqual(calls[1]!.body, { ids: ['gid://shopify/ProductVariant/101', 'gid://shopify/ProductVariant/102'], filters: { available: false } });
  });

  it('asks nothing at all for an empty sample', async () => {
    const { ctx, calls } = fakeEndpoint({});
    assert.deepEqual(await collectUcp(ctx, { products: [] }), { sightings: [], issues: [] });
    assert.deepEqual(calls, []);
  });
});

describe('collectUcp: the MCP binding', () => {
  it('calls lookup_catalog on the MCP endpoint with the agent profile in meta, without an MCP handshake', async () => {
    const endpoint = `${ORIGIN}/api/ucp/mcp`;
    const services = [{ version: V, transport: 'mcp', endpoint }, { version: V, transport: 'embedded' }];
    const server = mcpServer({
      call: (_name, args) => {
        const ids = (args.catalog as { ids: string[] }).ids;
        return lookupAnswer([product('gid://shopify/Product/1', 'tee', ids.map((id) => found(variant(id, `S${id.slice(-3)}`, 3900), [id, 'exact'])))]);
      },
    });
    const { ctx, calls } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ services }) }, [endpoint]: server });
    const result = await collectUcp(ctx, { platform: 'shopify', products: [TEE] });

    assert.deepEqual(methods(calls), [`GET ${PROFILE_URL}`, 'tools/call']);
    const params = (calls[1]!.body as { params: Record<string, unknown> }).params;
    assert.deepEqual(params, {
      name: 'lookup_catalog',
      arguments: { meta: { 'ucp-agent': { profile: AGENT_PROFILES[V] } }, catalog: { ids: ['gid://shopify/ProductVariant/101', 'gid://shopify/ProductVariant/102'] } },
    });
    assert.deepEqual(result.sightings.map((s) => [s.ids.sku, s.ids.aliases]), [['S101', ['101']], ['S102', ['102']]]);
    assert.equal(result.sightings[0]!.price!.locator, `${endpoint}#lookup_catalog[id="gid://shopify/ProductVariant/101"]/result/structuredContent/products/0/variants/0/price`);
  });

  it('explains how to read a Shopify endpoint on the myshopify.com host the run may not contact', async () => {
    const endpoint = 'https://shop-example.myshopify.com/api/ucp/mcp';
    const refused = new FetchRefused('foreign-host', endpoint);
    const { ctx } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ services: [{ version: V, transport: 'mcp', endpoint }] }) }, [endpoint]: { throws: refused } });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(result.issues.map((i) => [i.code, i.message]), [
      ['fetch-failed', `lookup_catalog: foreign-host: ${endpoint}; the profile names an endpoint on shop-example.myshopify.com. Shopify serves the same profile there: set ucp.url to https://shop-example.myshopify.com/.well-known/ucp to read it`],
    ]);
  });
});

describe('collectUcp: versions', () => {
  it('reads the profile of an older version the shop still offers, when its current one is too new', async () => {
    const leaf = `${ORIGIN}/.well-known/ucp/2026-08-25`;
    const { ctx, calls } = fakeEndpoint({
      [PROFILE_URL]: { body: businessProfile({ version: '2027-03-01', supported: { '2026-08-25': leaf } }) },
      [leaf]: { body: businessProfile() },
      [LOOKUP]: echo,
    });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(calls.map((c) => c.url), [PROFILE_URL, leaf, LOOKUP]);
    assert.equal(result.sightings.length, 2);
  });

  it('speaks 2026-04-08 with the agent profile for that version', async () => {
    const { ctx, calls } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ version: '2026-04-08' }) }, [LOOKUP]: echo });
    await collectUcp(ctx, { products: [TEE] });
    assert.equal(calls[1]!.headers['ucp-agent'], `profile="${AGENT_PROFILES['2026-04-08']}"`);
  });

  it('reports a shop that offers only versions it does not read, and asks nothing more', async () => {
    const { ctx, calls } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ version: '2026-01-23', supported: { '2026-01-11': `${ORIGIN}/old`, '<b>': 'x' } }) } });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.equal(calls.length, 1);
    assert.deepEqual(result.issues.map((i) => [i.code, i.message]), [['version-unsupported', 'the shop offers UCP 2026-01-23, 2026-01-11; Regmark reads 2026-08-25 and 2026-04-08']]);
  });

  it('names a few of the versions a profile offers, however many it lists', async () => {
    const supported = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`${1000 + i}-01-01`, `${ORIGIN}/old/${i}`]));
    const { ctx } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ version: '2027-01-01', supported }) } });
    const [only] = (await collectUcp(ctx, { products: [TEE] })).issues;
    assert.equal(only?.code, 'version-unsupported');
    assert.ok(only!.message.length < 200, only!.message);
    assert.match(only!.message, /^the shop offers UCP 2027-01-01, [\d-]+(, [\d-]+){4}, …; Regmark reads/);
  });

  it('refuses an older profile that says it is another version than the one it is listed under', async () => {
    const leaf = `${ORIGIN}/.well-known/ucp/2026-08-25`;
    const { ctx } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ version: '2027-03-01', supported: { '2026-08-25': leaf } }) }, [leaf]: { body: businessProfile({ version: '2027-03-01' }) } });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(result.issues.map((i) => [i.code, i.message]), [['parse-error', 'the profile for 2026-08-25 says it is 2027-03-01']]);
  });

  it('ignores services and capabilities declared for another version', async () => {
    const services = [{ version: '2026-04-08', transport: 'rest', endpoint: REST }];
    const { ctx } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ services }) } });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(result.issues.map((i) => i.code), ['not-supported']);

    const capabilities = { 'dev.ucp.shopping.catalog.lookup': [{ version: '2026-04-08' }], 'dev.ucp.shopping.checkout': [{ version: V }] };
    const second = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ capabilities }) } });
    const again = await collectUcp(second.ctx, { products: [TEE] });
    assert.deepEqual(again.issues.map((i) => [i.code, i.message]), [['not-supported', 'the profile declares no catalogue capability (dev.ucp.shopping.catalog.lookup or dev.ucp.shopping.catalog.search) for 2026-08-25']]);
    assert.equal(second.calls.length, 1, 'nothing is asked of a shop without a catalogue');
  });

  it('reports a profile whose only shopping service is embedded, A2A or has no usable endpoint', async () => {
    const services = [{ version: V, transport: 'embedded' }, { version: V, transport: 'a2a', endpoint: `${ORIGIN}/agent.json` }, { version: V, transport: 'rest', endpoint: 'ftp://x' }, { version: V, transport: 'rest', endpoint: 'not a url' }];
    const { ctx } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile({ services }) } });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(result.issues.map((i) => [i.code, i.message]), [['not-supported', 'the profile offers no REST or MCP endpoint for dev.ucp.shopping 2026-08-25']]);
  });
});

describe('collectUcp: failures are issues, never exceptions', () => {
  const profileFails = async (reply: Parameters<typeof fakeEndpoint>[0][string]) => {
    const { ctx } = fakeEndpoint({ [PROFILE_URL]: reply });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(result.sightings, []);
    return result.issues.map((i) => [i.code, i.message, i.locator]);
  };

  it('a shop without a profile', async () => {
    assert.deepEqual(await profileFails({ status: 404, body: 'nope' }), [['not-found', 'business profile: HTTP 404; the shop publishes no UCP profile here', PROFILE_URL]]);
  });

  it('a server error, a robots.txt refusal and a network failure', async () => {
    assert.deepEqual(await profileFails({ status: 503 }), [['fetch-failed', 'business profile: HTTP 503', PROFILE_URL]]);
    assert.deepEqual(await profileFails({ throws: new FetchRefused('robots', PROFILE_URL) }), [['robots-disallowed', `business profile: robots: ${PROFILE_URL}`, PROFILE_URL]]);
    assert.deepEqual(await profileFails({ throws: new FetchRefused('network', PROFILE_URL, 'ECONNRESET') }), [['fetch-failed', `business profile: network: ${PROFILE_URL} (ECONNRESET)`, PROFILE_URL]]);
  });

  it('a profile that is not JSON, or not a UCP profile', async () => {
    assert.deepEqual(await profileFails({ body: '<html>hi</html>' }), [['parse-error', 'business profile: not a UCP profile (no ucp.version)', PROFILE_URL]]);
    assert.deepEqual(await profileFails({ body: { ucp: { version: 20260825 } } }), [['parse-error', 'business profile: not a UCP profile (no ucp.version)', PROFILE_URL]]);
    assert.deepEqual(await profileFails({ body: [businessProfile()] }), [['parse-error', 'business profile: not a UCP profile (no ucp.version)', PROFILE_URL]]);
  });

  it('a REST error with UCP’s own code, and one without', async () => {
    const cases: [unknown, number, string, string][] = [
      [{ code: 'version_unsupported', content: 'we speak 2027' }, 422, 'version-unsupported', 'lookup_catalog: HTTP 422 version_unsupported: we speak 2027'],
      [{ code: 'profile_unreachable', content: 'could not fetch' }, 424, 'fetch-failed', 'lookup_catalog: HTTP 424 profile_unreachable: could not fetch'],
      ['Service Unavailable', 503, 'fetch-failed', 'lookup_catalog: HTTP 503'],
      [undefined, 404, 'not-found', 'lookup_catalog: HTTP 404'],
      [undefined, 301, 'fetch-failed', 'lookup_catalog: HTTP 301 (a redirect, which Regmark does not follow for a query)'],
    ];
    for (const [body, status, code, message] of cases) {
      const { ctx } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile() }, [LOOKUP]: { status, body } });
      const result = await collectUcp(ctx, { products: [TEE] });
      assert.deepEqual(result.issues.map((i) => [i.code, i.message, i.locator]), [[code, message, LOOKUP]]);
    }
  });

  it('a lookup answer that is not a JSON object', async () => {
    const { ctx } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile() }, [LOOKUP]: { body: '[1,2]' } });
    const result = await collectUcp(ctx, { products: [TEE] });
    assert.deepEqual(result.issues.map((i) => [i.code, i.message]), [['parse-error', 'lookup_catalog: the answer is not a JSON object']]);
  });

  it('never writes: every request is a GET or a query', async () => {
    const known = (call: Call) => echo({ ...call, body: { ids: (call.body as { ids: string[] }).ids.filter((id) => /^\d+$/.test(id)) } });
    const { ctx, calls } = fakeEndpoint({ [PROFILE_URL]: { body: businessProfile() }, [LOOKUP]: known, [`${REST}/catalog/search`]: { body: lookupAnswer([]) } });
    await collectUcp(ctx, { products: [TEE, { url: `${ORIGIN}/products/other`, title: 'Other', skus: ['O-1'] }] });
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [`GET ${PROFILE_URL}`, `POST ${LOOKUP}`, `POST ${REST}/catalog/search`]);
    assert.deepEqual(toolCalls(calls), []);
  });
});
