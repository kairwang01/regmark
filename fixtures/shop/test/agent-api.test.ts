import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildShop } from '../src/shop.ts';
import { createAgentApi, UCP_VERSION } from '../src/agent-api.ts';
import type { AgentApi, AgentResponse } from '../src/agent-api.ts';

const NOW = new Date('2026-10-09T00:00:00Z');
const ORIGIN = 'http://shop.test';
const AGENT = 'profile="https://agent.example/profile.json"';

type Json = Record<string, any>;

function call(api: AgentApi, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): AgentResponse {
  const res = api.handle({ method, path, headers, body, origin: ORIGIN });
  if (!res) throw new Error(`no response for ${method} ${path}`);
  return res;
}

const lookup = (api: AgentApi, ids: string[]) => call(api, 'POST', '/ucp/v1/catalog/lookup', { ids }, { 'ucp-agent': AGENT });

/** Opens an MCP session and returns a function that sends one JSON-RPC request on it. */
function mcp(api: AgentApi): (method: string, params?: unknown) => AgentResponse {
  const init = call(api, 'POST', '/api/mcp', { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  const session = init.headers['mcp-session-id']!;
  let id = 1;
  return (method, params) => call(api, 'POST', '/api/mcp', { jsonrpc: '2.0', id: id++, method, params }, { 'mcp-session-id': session });
}

const meta = { 'ucp-agent': { profile: 'https://agent.example/profile.json' } };

describe('agent API: the UCP business profile', () => {
  it('declares the REST shopping service and the catalogue capabilities, cacheable as the spec asks', () => {
    const res = call(createAgentApi(buildShop('clean', NOW)), 'GET', '/.well-known/ucp');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'public, max-age=60');
    const ucp = (res.json as Json).ucp;
    assert.equal(ucp.version, UCP_VERSION);
    assert.deepEqual(ucp.services['dev.ucp.shopping'].map((s: Json) => [s.version, s.transport, s.endpoint]), [[UCP_VERSION, 'rest', `${ORIGIN}/ucp/v1`]]);
    assert.deepEqual(Object.keys(ucp.capabilities).sort(), ['dev.ucp.shopping.catalog.lookup', 'dev.ucp.shopping.catalog.search']);
  });

  it('answers only the paths it owns', () => {
    assert.equal(createAgentApi(buildShop('clean', NOW)).handle({ method: 'GET', path: '/api/other', headers: {}, body: undefined, origin: ORIGIN }), null);
  });
});

describe('agent API: the UCP catalogue', () => {
  it('looks variants up by id and SKU exactly, a product by handle as featured, and lists the rest as not found', () => {
    const res = lookup(createAgentApi(buildShop('clean', NOW)), ['101', 'BEANIE-NVY', 'enamel-mug', 'nope']);
    assert.equal(res.status, 200);
    const body = res.json as Json;
    assert.deepEqual(body.products.map((p: Json) => [p.handle, p.variants.map((v: Json) => [v.sku, v.inputs])]), [
      ['classic-tee', [['TEE-BLU-S', [{ id: '101', match: 'exact' }]]]],
      ['wool-beanie', [['BEANIE-NVY', [{ id: 'BEANIE-NVY', match: 'exact' }]]]],
      ['enamel-mug', [['MUG-WHT', [{ id: 'enamel-mug', match: 'featured' }]]]],
    ]);
    assert.deepEqual(body.messages, [{ type: 'info', code: 'not_found', content: 'nope' }]);
  });

  it('states prices in minor units, the list price of a sale, stock and the GTIN', () => {
    const body = lookup(createAgentApi(buildShop('clean', NOW)), ['101', '302']).json as Json;
    const [tee, beanie] = body.products.map((p: Json) => p.variants[0]);
    assert.deepEqual(tee.price, { amount: 3900, currency: 'USD' });
    assert.deepEqual(tee.list_price, { amount: 4500, currency: 'USD' });
    assert.deepEqual(tee.options, [{ name: 'Size', label: 'S' }]);
    assert.deepEqual(tee.barcodes[0].type, 'GTIN');
    assert.deepEqual(beanie.availability, { available: false, status: 'out_of_stock' });
  });

  it('searches titles and returns every variant the catalogue lists', () => {
    const res = call(createAgentApi(buildShop('clean', NOW)), 'POST', '/ucp/v1/catalog/search', { query: 'trail socks' }, { 'ucp-agent': AGENT });
    const body = res.json as Json;
    assert.deepEqual(body.products.map((p: Json) => p.variants.length), [3]);
    assert.deepEqual(body.pagination, { has_next_page: false });
  });

  it('refuses a request without an agent profile, and more than ten ids', () => {
    const api = createAgentApi(buildShop('clean', NOW));
    const noAgent = call(api, 'POST', '/ucp/v1/catalog/lookup', { ids: ['101'] });
    assert.deepEqual([noAgent.status, (noAgent.json as Json).code], [400, 'invalid_profile_url']);
    const many = lookup(api, Array.from({ length: 11 }, (_, i) => String(i)));
    assert.deepEqual([many.status, (many.json as Json).code], [400, 'request_too_large']);
  });

  it('misprint: D32 states a stale price for SOCK-M, and D34 leaves the medium and large tees out', () => {
    const api = createAgentApi(buildShop('misprint', NOW));
    const socks = lookup(api, ['402']).json as Json;
    assert.deepEqual(socks.products[0].variants[0].price, { amount: 1100, currency: 'USD' });
    const tees = lookup(api, ['101', '102', '103']).json as Json;
    assert.deepEqual(tees.products[0].variants.map((v: Json) => v.sku), ['TEE-BLU-S']);
    assert.deepEqual(tees.messages.map((m: Json) => m.content), ['102', '103']);
  });
});

describe('agent API: the storefront MCP server', () => {
  it('answers initialize with a session, then lists catalogue tools and a cart tool', () => {
    const api = createAgentApi(buildShop('clean', NOW));
    const init = call(api, 'POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    assert.equal((init.json as Json).result.protocolVersion, '2025-11-25');
    assert.match(init.headers['mcp-session-id']!, /^[0-9a-f]{16}$/);
    const send = mcp(api);
    const notified = call(api, 'POST', '/api/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': init.headers['mcp-session-id']! });
    assert.deepEqual([notified.status, notified.json], [202, undefined]);
    const tools = (send('tools/list').json as Json).result.tools.map((t: Json) => t.name);
    assert.deepEqual(tools, ['search_catalog', 'lookup_catalog', 'create_cart']);
    assert.deepEqual(api.rpcCalls(), ['initialize', 'initialize', 'notifications/initialized', 'tools/list']);
  });

  it('refuses a request outside a session', () => {
    const res = call(createAgentApi(buildShop('clean', NOW)), 'POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(res.status, 400);
  });

  it('answers lookup_catalog with the payload in structuredContent and as text', () => {
    const send = mcp(createAgentApi(buildShop('clean', NOW)));
    const result = (send('tools/call', { name: 'lookup_catalog', arguments: { meta, catalog: { ids: ['302'] } } }).json as Json).result;
    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.deepEqual(result.structuredContent.products[0].variants[0].availability, { available: false, status: 'out_of_stock' });
  });

  it('misprint: D33 tells agents the sold-out navy beanie is available', () => {
    const send = mcp(createAgentApi(buildShop('misprint', NOW)));
    const result = (send('tools/call', { name: 'lookup_catalog', arguments: { meta, catalog: { ids: ['302'] } } }).json as Json).result;
    assert.deepEqual(result.structuredContent.products[0].variants[0].availability, { available: true, status: 'in_stock' });
  });

  it('refuses a tool call without an agent profile, makes no cart, and does not know other methods', () => {
    const send = mcp(createAgentApi(buildShop('clean', NOW)));
    const noMeta = send('tools/call', { name: 'lookup_catalog', arguments: { catalog: { ids: ['101'] } } });
    assert.deepEqual([noMeta.status, (noMeta.json as Json).error.code, (noMeta.json as Json).error.data.code], [422, -32001, 'invalid_profile_url']);
    const cart = (send('tools/call', { name: 'create_cart', arguments: { meta, cart: {} } }).json as Json).result;
    assert.equal(cart.isError, true);
    assert.equal((send('resources/list').json as Json).error.code, -32601);
  });
});
