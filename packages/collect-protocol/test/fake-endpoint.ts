// In-memory agent endpoints for the protocol collector tests. Answers are
// keyed by exact URL, and every request is recorded, with its headers and
// body, so that tests can assert on exactly what was asked.

import type { CollectContext, Fetched, Fetcher, RequestOptions } from '@regmark/core';

export const ORIGIN = 'https://shop.example';
export const FETCHED_AT = '2026-10-09T12:00:00.000Z';
export const PROFILE_URL = `${ORIGIN}/.well-known/ucp`;
export const REST = `${ORIGIN}/ucp/v1`;
export const MCP = `${ORIGIN}/api/mcp`;

export type Call = { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: unknown };
/** An object body is sent as JSON; a string as it is. */
export type Reply = { status?: number; headers?: Record<string, string>; body?: unknown; throws?: Error };
export type Route = Reply | ((call: Call) => Reply);

export type Fake = { ctx: CollectContext; calls: Call[]; logs: string[] };

/** Unknown URLs answer 404. A write fails the test: these collectors only read and ask. */
export function fakeEndpoint(routes: Record<string, Route>): Fake {
  const calls: Call[] = [];
  const logs: string[] = [];
  const answer = (call: Call): Fetched => {
    calls.push(call);
    const route = Object.hasOwn(routes, call.url) ? routes[call.url]! : { status: 404, body: 'not found' };
    const reply = typeof route === 'function' ? route(call) : route;
    if (reply.throws) throw reply.throws;
    const text = typeof reply.body === 'string' ? reply.body : reply.body === undefined ? '' : JSON.stringify(reply.body);
    const headers = { 'content-type': typeof reply.body === 'string' ? 'text/plain' : 'application/json', ...reply.headers };
    return { url: call.url, status: reply.status ?? 200, headers, body: text, fetchedAt: FETCHED_AT };
  };
  const fetcher: Fetcher = {
    async get(url: string, options?: RequestOptions): Promise<Fetched> {
      return answer({ method: 'GET', url, headers: { ...options?.headers } });
    },
    async send(): Promise<Fetched> {
      throw new Error('a protocol collector must never write');
    },
    async query(url: string, json: unknown, options?: RequestOptions): Promise<Fetched> {
      return answer({ method: 'POST', url, headers: { ...options?.headers }, body: structuredClone(json) });
    },
  };
  const ctx: CollectContext = {
    store: new URL(ORIGIN),
    fetcher,
    now: () => new Date(FETCHED_AT),
    log: (_level, message) => {
      logs.push(message);
    },
  };
  return { ctx, calls, logs };
}

// ── UCP shapes, as the 2026-08-25 schemas define them ───────────────────

export const V = '2026-08-25';

export function businessProfile(options: {
  version?: string;
  services?: Record<string, unknown>[];
  capabilities?: Record<string, unknown>;
  supported?: Record<string, string>;
} = {}): Record<string, unknown> {
  const version = options.version ?? V;
  const ucp: Record<string, unknown> = {
    version,
    services: { 'dev.ucp.shopping': options.services ?? [{ version, transport: 'rest', endpoint: REST, spec: 'https://ucp.dev/specification/overview' }] },
    capabilities: options.capabilities ?? {
      'dev.ucp.shopping.catalog.lookup': [{ version }],
      'dev.ucp.shopping.catalog.search': [{ version }],
    },
    payment_handlers: {},
  };
  if (options.supported) ucp.supported_versions = options.supported;
  return { ucp };
}

export const usd = (amount: number) => ({ amount, currency: 'USD' });

/** A catalogue variant. `inputs` is added by the caller for lookup answers. */
export function variant(id: string, sku: string, amount: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, sku, title: sku, description: { plain: sku }, price: usd(amount), availability: { available: true }, ...extra };
}

export function product(id: string, handle: string, variants: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    handle,
    title: handle,
    description: { plain: handle },
    url: `${ORIGIN}/products/${handle}`,
    price_range: { min: usd(0), max: usd(0) },
    variants,
    ...extra,
  };
}

/** The variant as a lookup answers it: with the ids that found it. */
export const found = (v: Record<string, unknown>, ...inputs: [string, 'exact' | 'featured'][]) => ({ ...v, inputs: inputs.map(([id, match]) => ({ id, match })) });

export const lookupAnswer = (products: unknown[], extra: Record<string, unknown> = {}) => ({ ucp: { version: V }, products, ...extra });

// ── MCP ─────────────────────────────────────────────────────────────────

const META = { type: 'object', properties: { 'ucp-agent': { type: 'object', properties: { profile: { type: 'string' } } } } };

/** A UCP catalogue tool as Shopify's server lists it; `available` adds Shopify's filters.available. */
export function catalogueTool(name: string, options: { available?: boolean; annotations?: Record<string, unknown> } = {}): Record<string, unknown> {
  const catalog: Record<string, unknown> = { type: 'object', properties: { ids: { type: 'array' }, query: { type: 'string' } } };
  if (options.available) (catalog.properties as Record<string, unknown>).filters = { type: 'object', properties: { available: { type: 'boolean', default: true } } };
  const tool: Record<string, unknown> = { name, description: name, inputSchema: { type: 'object', required: ['meta', 'catalog'], properties: { meta: META, catalog } } };
  if (options.annotations) tool.annotations = options.annotations;
  return tool;
}

export type McpServer = {
  version?: string;
  session?: string;
  tools?: Record<string, unknown>[] | Record<string, unknown>[][];
  /** Answers a tools/call with a UCP payload, or with a full result object when `raw` is set. */
  call?: (name: string, args: Record<string, unknown>) => unknown;
  raw?: boolean;
};

/** A JSON-RPC server that speaks the MCP lifecycle: initialize, the notification, tools/list (paged when given pages), tools/call. */
export function mcpServer(server: McpServer = {}): (call: Call) => Reply {
  return (call) => {
    const body = call.body as Record<string, unknown>;
    const id = body.id;
    const params = (body.params ?? {}) as Record<string, unknown>;
    const reply = (result: unknown, headers: Record<string, string> = {}): Reply => ({ headers, body: { jsonrpc: '2.0', id, result } });
    switch (body.method) {
      case 'initialize':
        return reply(
          { protocolVersion: server.version ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } },
          server.session ? { 'mcp-session-id': server.session } : {},
        );
      case 'notifications/initialized':
        return { status: 202, body: '' };
      case 'tools/list': {
        const tools = server.tools ?? [catalogueTool('lookup_catalog'), catalogueTool('search_catalog')];
        if (!Array.isArray(tools[0])) return reply({ tools });
        const pages = tools as Record<string, unknown>[][];
        const page = typeof params.cursor === 'string' ? Number(params.cursor) : 0;
        return reply(page + 1 < pages.length ? { tools: pages[page], nextCursor: String(page + 1) } : { tools: pages[page] });
      }
      case 'tools/call': {
        const out = server.call?.(String(params.name), params.arguments as Record<string, unknown>) ?? lookupAnswer([]);
        if (server.raw) return reply(out);
        return reply({ structuredContent: out, content: [{ type: 'text', text: JSON.stringify(out) }], isError: false });
      }
      default:
        return { body: { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } } };
    }
  };
}

/** The tools/call requests in a call log, as [tool, catalog request]. */
export const toolCalls = (calls: Call[]): [string, unknown][] =>
  calls
    .filter((c) => (c.body as Record<string, unknown> | undefined)?.method === 'tools/call')
    .map((c) => {
      const params = (c.body as { params: { name: string; arguments: { catalog: unknown } } }).params;
      return [params.name, params.arguments.catalog];
    });

/** The JSON-RPC methods in a call log, in order. */
export const methods = (calls: Call[]): string[] => calls.map((c) => String((c.body as Record<string, unknown> | undefined)?.method ?? `${c.method} ${c.url}`));
