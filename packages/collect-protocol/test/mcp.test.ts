import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FetchRefused } from '@regmark/core';
import { AGENT_PROFILES, collectMcp, MCP_VERSIONS } from '../src/index.ts';
import type { ProductRef } from '../src/index.ts';
import { eventData } from '../src/jsonrpc.ts';
import { catalogueTool, fakeEndpoint, found, lookupAnswer, MCP, mcpServer, methods, ORIGIN, product, toolCalls, V, variant } from './fake-endpoint.ts';
import type { Call, Reply } from './fake-endpoint.ts';

const TEE: ProductRef = { url: `${ORIGIN}/products/classic-tee`, title: 'Classic Tee', handle: 'classic-tee', variantIds: ['101', '102'] };

/** Finds each asked-for id as its own variant. */
const answerIds = (_name: string, args: Record<string, unknown>) => {
  const ids = (args.catalog as { ids: string[] }).ids;
  return lookupAnswer([product('100', 'classic-tee', ids.map((id) => found(variant(id, `SKU-${id.replace(/\D/g, '')}`, 3900), [id, 'exact'])))]);
};

describe('collectMcp: the conversation', () => {
  it('initializes, sends the notification, lists the tools and looks the variants up, with the session on every later request', async () => {
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ session: 'sess-1', call: answerIds }) });
    const result = await collectMcp(ctx, { products: [TEE] });

    assert.deepEqual(result.issues, []);
    assert.deepEqual(methods(calls), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    assert.deepEqual((calls[0]!.body as { params: unknown }).params, { protocolVersion: MCP_VERSIONS[0], capabilities: {}, clientInfo: { name: 'regmark', version: '0.0.0-dev' } });
    assert.equal(calls[0]!.headers.accept, 'application/json, text/event-stream');
    assert.equal(calls[0]!.headers['mcp-session-id'], undefined);
    for (const later of calls.slice(1)) {
      assert.equal(later.headers['mcp-session-id'], 'sess-1');
      assert.equal(later.headers['mcp-protocol-version'], '2025-06-18');
    }
    assert.equal((calls[1]!.body as Record<string, unknown>).id, undefined, 'a notification has no id');
    const params = (calls[3]!.body as { params: Record<string, unknown> }).params;
    assert.deepEqual(params, { name: 'lookup_catalog', arguments: { meta: { 'ucp-agent': { profile: AGENT_PROFILES[V] } }, catalog: { ids: ['101', '102'] } } });
    assert.deepEqual(result.sightings.map((s) => [s.surface, s.scope, s.ids.sku, s.ids.url]), [
      ['mcp', 'variant', 'SKU-101', TEE.url],
      ['mcp', 'variant', 'SKU-102', TEE.url],
    ]);
    assert.equal(result.sightings[0]!.availability!.locator, `${MCP}#lookup_catalog[id="101"]/result/structuredContent/products/0/variants/0/availability`);
  });

  it('uses the configured endpoint and agent profile', async () => {
    const url = `${ORIGIN}/api/ucp/mcp`;
    const { ctx, calls } = fakeEndpoint({ [url]: mcpServer({ call: answerIds }) });
    await collectMcp(ctx, { url, agentProfile: 'https://agent.example/p.json', products: [TEE] });
    assert.ok(calls.every((c) => c.url === url));
    const [args] = calls.filter((c) => (c.body as Record<string, unknown>).method === 'tools/call').map((c) => (c.body as { params: { arguments: { meta: unknown } } }).params.arguments.meta);
    assert.deepEqual(args, { 'ucp-agent': { profile: 'https://agent.example/p.json' } });
  });

  it('writes Shopify’s gids, asks for sold-out variants when the tool takes filters.available, and maps the gid back', async () => {
    const tools = [catalogueTool('lookup_catalog', { available: true }), catalogueTool('search_catalog', { available: true })];
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ tools, call: answerIds }) });
    const result = await collectMcp(ctx, { platform: 'shopify', products: [TEE] });
    assert.deepEqual(toolCalls(calls), [['lookup_catalog', { ids: ['gid://shopify/ProductVariant/101', 'gid://shopify/ProductVariant/102'], filters: { available: false } }]]);
    assert.deepEqual(result.sightings.map((s) => s.ids.aliases), [['101'], ['102']]);
  });

  it('reads every page of a paged tools/list', async () => {
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ tools: [[catalogueTool('get_product')], [catalogueTool('lookup_catalog')]], call: answerIds }) });
    const result = await collectMcp(ctx, { products: [TEE] });
    assert.deepEqual(methods(calls), ['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'tools/call']);
    assert.deepEqual((calls[3]!.body as { params: unknown }).params, { cursor: '1' });
    assert.equal(result.sightings.length, 2);
  });

  it('reads an answer sent as a server-sent event stream, after a notification on the same stream', async () => {
    const server = mcpServer({ call: answerIds });
    const streamed = (call: Call): Reply => {
      const reply = server(call);
      if ((call.body as Record<string, unknown>).method !== 'tools/call') return reply;
      const progress = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } });
      return { headers: { 'content-type': 'text/event-stream' }, body: `: keep-alive\n\nevent: message\ndata: ${progress}\n\nid: 2\ndata: ${JSON.stringify(reply.body)}\r\n\r\n` };
    };
    const { ctx } = fakeEndpoint({ [MCP]: streamed });
    const result = await collectMcp(ctx, { products: [TEE] });
    assert.deepEqual(result.issues, []);
    assert.equal(result.sightings.length, 2);
  });

  it('resumes a stream the server closed before answering, from the last event id, as MCP 2025-11-25 allows', async () => {
    const server = mcpServer({ session: 'sess-1', call: answerIds });
    let pending: Reply | undefined;
    const polled = (call: Call): Reply => {
      if (call.method === 'GET') {
        assert.equal(call.headers['last-event-id'], 'ev-1');
        assert.equal(call.headers.accept, 'text/event-stream');
        assert.equal(call.headers['mcp-session-id'], 'sess-1');
        return { headers: { 'content-type': 'text/event-stream' }, body: `id: ev-2\ndata: ${JSON.stringify(pending!.body)}\n\n` };
      }
      const reply = server(call);
      if ((call.body as Record<string, unknown>).method !== 'tools/call') return reply;
      pending = reply;
      // A priming event with an id and no data, then the connection closes.
      return { headers: { 'content-type': 'text/event-stream' }, body: 'id: ev-1\nretry: 5\ndata: \n\n' };
    };
    const { ctx, calls } = fakeEndpoint({ [MCP]: polled });
    const result = await collectMcp(ctx, { products: [TEE] });
    assert.deepEqual(result.issues, []);
    assert.equal(result.sightings.length, 2);
    assert.deepEqual(calls.map((c) => c.method), ['POST', 'POST', 'POST', 'POST', 'GET']);
  });

  it('gives up on a stream that never answers after a few resumes', async () => {
    const server = mcpServer({ call: answerIds });
    const silent = (call: Call): Reply =>
      call.method === 'GET' || (call.body as Record<string, unknown>).method === 'tools/call'
        ? { headers: { 'content-type': 'text/event-stream' }, body: 'id: ev-1\ndata: \n\n' }
        : server(call);
    const { ctx, calls } = fakeEndpoint({ [MCP]: silent });
    const result = await collectMcp(ctx, { products: [TEE] });
    assert.equal(calls.filter((c) => c.method === 'GET').length, 3);
    assert.deepEqual(result.issues.map((i) => i.code), ['parse-error']);
  });

  it('reads a tool result that carries the payload only as JSON text', async () => {
    const payload = answerIds('lookup_catalog', { catalog: { ids: ['101'] } });
    const { ctx } = fakeEndpoint({ [MCP]: mcpServer({ raw: true, call: () => ({ content: [{ type: 'image', data: '' }, { type: 'text', text: JSON.stringify(payload) }] }) }) });
    const result = await collectMcp(ctx, { products: [{ ...TEE, variantIds: ['101'] }] });
    assert.equal(result.sightings[0]!.price!.locator, `${MCP}#lookup_catalog[id="101"]/result/content/1/text/products/0/variants/0/price`);
  });

  it('does not send back a session id that is not visible ASCII', async () => {
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ session: 'a b', call: answerIds }) });
    await collectMcp(ctx, { products: [TEE] });
    assert.ok(calls.every((c) => c.headers['mcp-session-id'] === undefined));
  });
});

describe('collectMcp: only catalogue reads are ever called', () => {
  it('calls lookup_catalog and never the cart and checkout tools listed beside it', async () => {
    const tools = ['create_cart', 'update_cart', 'create_checkout', 'complete_checkout', 'get_order', 'lookup_catalog', 'get_product'].map((name) => catalogueTool(name));
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ tools, call: answerIds }) });
    await collectMcp(ctx, { products: [TEE] });
    assert.deepEqual(toolCalls(calls).map(([name]) => name), ['lookup_catalog']);
  });

  it('does not call a catalogue tool that declares it changes things', async () => {
    for (const annotations of [{ readOnlyHint: false }, { destructiveHint: true }]) {
      const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ tools: [catalogueTool('lookup_catalog', { annotations })] }) });
      const result = await collectMcp(ctx, { products: [TEE] });
      assert.deepEqual(toolCalls(calls), []);
      assert.deepEqual(result.issues.map((i) => i.code), ['not-supported']);
    }
  });

  it('reads a server that offers no catalogue tool as not supported, naming what it does offer', async () => {
    // What Shopify's /api/mcp lists since it moved its catalogue tools to /api/ucp/mcp.
    const policies = { name: 'search_shop_policies_and_faqs', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ tools: [policies] }) });
    const result = await collectMcp(ctx, { products: [TEE] });
    assert.deepEqual(toolCalls(calls), []);
    assert.deepEqual(result.issues.map((i) => [i.code, i.message, i.locator]), [
      ['not-supported', 'tools/list: no UCP catalogue tool (lookup_catalog or search_catalog); it lists search_shop_policies_and_faqs', MCP],
    ]);
  });

  it('does not call a tool that has a catalogue tool’s name but not UCP’s input shape', async () => {
    const legacy = { name: 'search_catalog', inputSchema: { type: 'object', properties: { query: { type: 'string' }, context: { type: 'string' } } } };
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ tools: [legacy, { name: 'get_product_details' }] }) });
    const result = await collectMcp(ctx, { products: [TEE] });
    assert.deepEqual(toolCalls(calls), []);
    assert.deepEqual(result.issues.map((i) => i.code), ['not-supported']);
  });

  it('searches by title with search_catalog when that is the only catalogue tool and no variant ids are known', async () => {
    const ref: ProductRef = { url: `${ORIGIN}/products/classic-tee`, title: 'Classic Tee', handle: 'classic-tee', skus: ['TEE-S'] };
    const { ctx, calls } = fakeEndpoint({ [MCP]: mcpServer({ tools: [catalogueTool('search_catalog')], call: () => lookupAnswer([product('1', 'classic-tee', [variant('11', 'TEE-S', 3900)])]) }) });
    const result = await collectMcp(ctx, { products: [ref] });
    assert.deepEqual(toolCalls(calls), [['search_catalog', { query: 'Classic Tee', pagination: { limit: 10 } }]]);
    assert.deepEqual(result.sightings.map((s) => s.ids.sku), ['TEE-S']);
  });
});

describe('collectMcp: failures are issues, never exceptions', () => {
  const failsWith = async (route: Parameters<typeof fakeEndpoint>[0][string]) => {
    const { ctx, calls } = fakeEndpoint({ [MCP]: route });
    const result = await collectMcp(ctx, { products: [TEE] });
    assert.deepEqual(result.sightings, []);
    return { issues: result.issues.map((i) => [i.code, i.message]), calls };
  };

  it('a server that speaks only an MCP version this client does not', async () => {
    const { issues, calls } = await failsWith(mcpServer({ version: '2024-11-05' }));
    assert.deepEqual(issues, [['version-unsupported', 'initialize: the server speaks MCP 2024-11-05; Regmark speaks 2025-11-25, 2025-06-18, 2025-03-26']]);
    assert.equal(calls.length, 1, 'nothing follows a failed handshake');
  });

  it('no MCP server at the endpoint, a server error, a refusal by robots.txt', async () => {
    assert.deepEqual((await failsWith({ status: 404, body: '<html>Not found</html>' })).issues, [['not-found', 'initialize: HTTP 404']]);
    assert.deepEqual((await failsWith({ status: 500, body: 'oops' })).issues, [['fetch-failed', 'initialize: HTTP 500']]);
    assert.deepEqual((await failsWith({ throws: new FetchRefused('robots', MCP) })).issues, [['robots-disallowed', `initialize: robots: ${MCP}`]]);
  });

  it('a server that does not know initialize, and one that answers with something that is not JSON-RPC', async () => {
    const unknown = (call: Call): Reply => ({ body: { jsonrpc: '2.0', id: (call.body as { id: number }).id, error: { code: -32601, message: 'Method not found' } } });
    assert.deepEqual((await failsWith(unknown)).issues, [['not-supported', 'initialize: JSON-RPC error -32601 Method not found']]);
    assert.deepEqual((await failsWith({ body: { jsonrpc: '2.0', id: 99, result: {} } })).issues, [['parse-error', 'initialize: the response holds no JSON-RPC answer to the request']]);
    assert.deepEqual((await failsWith({ body: '{"jsonrpc":' })).issues, [['parse-error', 'initialize: the response holds no JSON-RPC answer to the request']]);
  });

  it('a notification the server refuses', async () => {
    const server = mcpServer();
    const refuses = (call: Call): Reply => ((call.body as Record<string, unknown>).method === 'notifications/initialized' ? { status: 400, body: 'no' } : server(call));
    assert.deepEqual((await failsWith(refuses)).issues, [['fetch-failed', 'notifications/initialized: HTTP 400']]);
  });

  it('a profile the shop cannot fetch, and a version it does not speak, as UCP reports them in JSON-RPC errors', async () => {
    const cases: [string, string, string][] = [
      ['profile_unreachable', 'fetch-failed', 'lookup_catalog: JSON-RPC error -32001 UCP discovery failed (profile_unreachable: Unable to fetch agent profile)'],
      ['version_unsupported', 'version-unsupported', 'lookup_catalog: JSON-RPC error -32001 UCP discovery failed (version_unsupported: Unable to fetch agent profile)'],
    ];
    for (const [ucpCode, code, message] of cases) {
      const server = mcpServer();
      const rejects = (call: Call): Reply => {
        const body = call.body as { id: number; method: string };
        if (body.method !== 'tools/call') return server(call);
        return { status: 422, body: { jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'UCP discovery failed', data: { code: ucpCode, content: 'Unable to fetch agent profile' } } } };
      };
      assert.deepEqual((await failsWith(rejects)).issues, [[code, message]]);
    }
  });

  it('a tool that reports an error, and a tool result with nothing to read', async () => {
    const tooMany = mcpServer({ raw: true, call: () => ({ content: [{ type: 'text', text: 'Invalid arguments: array size at /catalog/ids is greater than: 10' }], isError: true }) });
    assert.deepEqual((await failsWith(tooMany)).issues, [['fetch-failed', 'lookup_catalog: the tool reported an error: Invalid arguments: array size at /catalog/ids is greater than: 10']]);
    const empty = mcpServer({ raw: true, call: () => ({ content: [{ type: 'text', text: 'Here are your products!' }] }) });
    assert.deepEqual((await failsWith(empty)).issues, [['parse-error', 'lookup_catalog: the tool result carries no JSON object']]);
    const notObject = mcpServer({ raw: true, call: () => 'products' });
    assert.deepEqual((await failsWith(notObject)).issues, [['parse-error', 'lookup_catalog: the tool result is not an object']]);
  });

  it('a tools/list answer without a tools list', async () => {
    const server = mcpServer();
    const odd = (call: Call): Reply => {
      const body = call.body as { id: number; method: string };
      return body.method === 'tools/list' ? { body: { jsonrpc: '2.0', id: body.id, result: { tool: [] } } } : server(call);
    };
    assert.deepEqual((await failsWith(odd)).issues, [['parse-error', 'tools/list: the answer has no tools list']]);
  });

  it('asks nothing at all for an empty sample', async () => {
    const { ctx, calls } = fakeEndpoint({});
    assert.deepEqual(await collectMcp(ctx, { products: [] }), { sightings: [], issues: [] });
    assert.deepEqual(calls, []);
  });
});

describe('eventData', () => {
  it('reads the data of each event, joining multi-line data, across LF and CRLF, skipping comments and fields', () => {
    assert.deepEqual(eventData(': ping\n\nevent: message\ndata: {"a":1}\n\ndata: line one\ndata: line two\r\n\r\nid: 7\nretry: 10\n\ndata:{"b":2}'), ['{"a":1}', 'line one\nline two', '{"b":2}']);
    assert.deepEqual(eventData(''), []);
  });
});
