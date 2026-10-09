// The endpoints a shopping agent calls directly, as much of them as the
// fixture imitates: a UCP business profile at /.well-known/ucp with a REST
// catalogue (lookup and search), and a storefront MCP server at /api/mcp
// whose catalogue tools answer with the same UCP objects.
//
// A pure request handler, like store-api.ts: no sockets, no clock. The UCP
// catalogue answers from what the shop's `ucp` statements SAY, the MCP
// server from its `mcp` statements; either may disagree with the checkout on
// purpose. The shapes follow UCP 2026-08-25 (ucp.dev) and MCP 2025-06-18.

import { randomBytes } from 'node:crypto';
import type { ProductSays, Shop, VariantSays } from './shop.ts';
import { minor } from './store-api.ts';

export type AgentRequest = { method: string; path: string; headers: Record<string, string>; body: unknown; origin: string };
/** `json` undefined means an empty body, as a 202 for a notification has. */
export type AgentResponse = { status: number; headers: Record<string, string>; json?: unknown };
export type AgentApi = {
  /** Returns null when the path is not one of the agent endpoints. */
  handle(req: AgentRequest): AgentResponse | null;
  /** "initialize", "tools/list", "tools/call lookup_catalog" and so on, for every JSON-RPC request received. */
  rpcCalls(): string[];
};

export const UCP_VERSION = '2026-08-25';
export const AGENT_PATHS: ReadonlySet<string> = new Set(['/.well-known/ucp', '/ucp/v1/catalog/lookup', '/ucp/v1/catalog/search', '/api/mcp']);

const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const LOOKUP_MAX = 10;

type Source = 'ucp' | 'mcp';
type Outcome = { status: number; json?: unknown; headers?: Record<string, string> };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function profile(origin: string) {
  const spec = `https://ucp.dev/${UCP_VERSION}/specification`;
  const schemas = `https://ucp.dev/${UCP_VERSION}/schemas/shopping`;
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        'dev.ucp.shopping': [
          { version: UCP_VERSION, spec: `${spec}/overview`, transport: 'rest', endpoint: `${origin}/ucp/v1`, schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/rest.openapi.json` },
        ],
      },
      capabilities: {
        'dev.ucp.shopping.catalog.search': [{ version: UCP_VERSION, spec: `${spec}/shopping/catalog/search`, schema: `${schemas}/catalog_search.json` }],
        'dev.ucp.shopping.catalog.lookup': [{ version: UCP_VERSION, spec: `${spec}/shopping/catalog/lookup`, schema: `${schemas}/catalog_lookup.json` }],
      },
      payment_handlers: {},
    },
  };
}

const envelope = (capability: 'search' | 'lookup') => ({
  version: UCP_VERSION,
  capabilities: { [`dev.ucp.shopping.catalog.${capability}`]: [{ version: UCP_VERSION }] },
});

/** A UCP price: whole minor units and the currency, which the surface may leave out. */
function price(amount: string, currency: string | null) {
  return currency === null ? { amount: Number(minor(amount)) } : { amount: Number(minor(amount)), currency };
}

function variantTitle(p: ProductSays, v: VariantSays): string {
  const labels = Object.values(v.options);
  return labels.length ? labels.join(' / ') : p.title;
}

function catalogueVariant(p: ProductSays, v: VariantSays): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: String(v.wooId),
    sku: v.sku,
    title: variantTitle(p, v),
    description: { plain: variantTitle(p, v) },
    price: price(v.price, v.currency),
    availability: { available: v.stock === 'in_stock', status: v.stock },
  };
  if (v.listPrice !== null) out.list_price = price(v.listPrice, v.currency);
  const options = Object.entries(v.options);
  if (options.length) out.options = options.map(([name, label]) => ({ name, label }));
  if (v.gtin !== null) out.barcodes = [{ type: 'GTIN', value: v.gtin }];
  return out;
}

/** A product as the catalogue states it, with the variants given (all of them, or the ones a lookup matched). */
function catalogueProduct(p: ProductSays, all: VariantSays[], variants: Record<string, unknown>[], origin: string): Record<string, unknown> {
  const amounts = all.map((v) => Number(minor(v.price)));
  const currency = all[0]?.currency ?? null;
  const bound = (amount: number) => (currency === null ? { amount } : { amount, currency });
  const names = [...new Set(all.flatMap((v) => Object.keys(v.options)))];
  const out: Record<string, unknown> = {
    id: String(p.wooId),
    handle: p.slug,
    title: p.title,
    description: { plain: p.title },
    url: `${origin}/product/${p.slug}/`,
    price_range: { min: bound(Math.min(...amounts)), max: bound(Math.max(...amounts)) },
    variants,
  };
  if (names.length) out.options = names.map((name) => ({ name, values: [...new Set(all.map((v) => v.options[name]).filter((x): x is string => !!x))].map((label) => ({ label })) }));
  return out;
}

type Hit = { product: ProductSays; index: number; match: 'exact' | 'featured' };

/** An id resolves to a variant id or SKU exactly, else to a product id or handle, whose first variant is featured. */
function resolve(shop: Shop, source: Source, id: string): Hit | null {
  for (const product of shop.products) {
    const index = product[source].findIndex((v) => String(v.wooId) === id || v.sku === id);
    if (index >= 0) return { product, index, match: 'exact' };
  }
  for (const product of shop.products) {
    if (product[source].length > 0 && (String(product.wooId) === id || product.slug === id)) return { product, index: 0, match: 'featured' };
  }
  return null;
}

function lookup(shop: Shop, source: Source, origin: string, ids: string[]): Record<string, unknown> {
  const matched = new Map<ProductSays, Map<number, { id: string; match: string }[]>>();
  const notFound: string[] = [];
  for (const id of [...new Set(ids)]) {
    const hit = resolve(shop, source, id);
    if (!hit) {
      notFound.push(id);
      continue;
    }
    if (!matched.has(hit.product)) matched.set(hit.product, new Map());
    const inputs = matched.get(hit.product)!;
    if (!inputs.has(hit.index)) inputs.set(hit.index, []);
    inputs.get(hit.index)!.push({ id, match: hit.match });
  }
  const products = [...matched].map(([p, inputs]) => {
    const variants = [...inputs.keys()].sort((a, b) => a - b).map((i) => ({ ...catalogueVariant(p, p[source][i]!), inputs: inputs.get(i) }));
    return catalogueProduct(p, p[source], variants, origin);
  });
  const out: Record<string, unknown> = { ucp: envelope('lookup'), products };
  if (notFound.length) out.messages = notFound.map((id) => ({ type: 'info', code: 'not_found', content: id }));
  return out;
}

function search(shop: Shop, source: Source, origin: string, query: string, limit: number): Record<string, unknown> {
  const words = query.toLowerCase();
  const products = shop.products
    .filter((p) => p[source].length > 0 && p.title.toLowerCase().includes(words))
    .slice(0, limit)
    .map((p) => catalogueProduct(p, p[source], p[source].map((v) => catalogueVariant(p, v)), origin));
  return { ucp: envelope('search'), products, pagination: { has_next_page: false } };
}

type Question = { ok: true; kind: 'lookup'; ids: string[] } | { ok: true; kind: 'search'; query: string; limit: number } | { ok: false; reason: string; tooLarge?: boolean };

/** Reads a lookup or search request the way the schemas define it. */
function question(kind: 'lookup' | 'search', body: unknown): Question {
  if (!isRecord(body)) return { ok: false, reason: 'the request is not an object' };
  if (kind === 'lookup') {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return { ok: false, reason: 'ids must be a list of strings' };
    if (ids.length > LOOKUP_MAX) return { ok: false, reason: `at most ${LOOKUP_MAX} ids`, tooLarge: true };
    return { ok: true, kind, ids };
  }
  if (typeof body.query !== 'string' || body.query.trim() === '') return { ok: false, reason: 'query must be a non-empty string' };
  const asked = isRecord(body.pagination) ? body.pagination.limit : undefined;
  const limit = typeof asked === 'number' && Number.isInteger(asked) && asked > 0 ? Math.min(asked, 50) : 10;
  return { ok: true, kind, query: body.query, limit };
}

function answer(shop: Shop, source: Source, origin: string, q: Question & { ok: true }): Record<string, unknown> {
  return q.kind === 'lookup' ? lookup(shop, source, origin, q.ids) : search(shop, source, origin, q.query, q.limit);
}

const PROFILE_HEADER = /^profile="https:\/\/[^"\s]+"$/;

function restRoute(shop: Shop, req: AgentRequest): Outcome {
  if (req.method !== 'POST') return { status: 405, json: { code: 'method_not_allowed', content: 'POST only' } };
  if (!PROFILE_HEADER.test(req.headers['ucp-agent'] ?? '')) {
    return { status: 400, json: { code: 'invalid_profile_url', content: 'UCP-Agent must name the agent profile', continue_url: `${req.origin}/` } };
  }
  const q = question(req.path.endsWith('/lookup') ? 'lookup' : 'search', req.body);
  if (!q.ok) return { status: 400, json: { code: q.tooLarge ? 'request_too_large' : 'invalid_request', content: q.reason } };
  return { status: 200, json: answer(shop, 'ucp', req.origin, q) };
}

const META_SCHEMA = {
  type: 'object',
  required: ['ucp-agent'],
  properties: { 'ucp-agent': { type: 'object', required: ['profile'], properties: { profile: { type: 'string', format: 'uri' } } } },
};

/** The tools the fixture lists. create_cart is there so a test can show the collector never calls it. */
const TOOLS = [
  {
    name: 'search_catalog',
    description: 'Search the shop catalogue.',
    inputSchema: {
      type: 'object',
      required: ['meta', 'catalog'],
      properties: {
        meta: META_SCHEMA,
        catalog: { type: 'object', properties: { query: { type: 'string' }, pagination: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } } } } },
      },
    },
  },
  {
    name: 'lookup_catalog',
    description: 'Look products or variants up by id or SKU. At most 10 ids.',
    inputSchema: {
      type: 'object',
      required: ['meta', 'catalog'],
      properties: {
        meta: META_SCHEMA,
        catalog: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: LOOKUP_MAX } } },
      },
    },
  },
  {
    name: 'create_cart',
    description: 'Create a cart.',
    inputSchema: { type: 'object', required: ['meta', 'cart'], properties: { meta: META_SCHEMA, cart: { type: 'object' } } },
  },
];

export function createAgentApi(shop: Shop): AgentApi {
  const sessions = new Set<string>();
  const calls: string[] = [];

  function mcpRoute(req: AgentRequest): Outcome {
    if (req.method !== 'POST') return { status: 405, json: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } } };
    const body = req.body;
    if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return { status: 400, json: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } } };
    }
    const id = body.id;
    const params = isRecord(body.params) ? body.params : {};
    calls.push(body.method === 'tools/call' ? `tools/call ${String(params.name)}` : body.method);
    const reply = (result: unknown): Outcome => ({ status: 200, json: { jsonrpc: '2.0', id, result } });
    const error = (code: number, message: string, data?: unknown, status = 200): Outcome => ({
      status,
      json: { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } },
    });

    if (body.method === 'initialize') {
      const asked = params.protocolVersion;
      const version = typeof asked === 'string' && MCP_VERSIONS.includes(asked) ? asked : '2025-06-18';
      const session = randomBytes(8).toString('hex');
      sessions.add(session);
      const result = { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fixture-shop', version: '1.0.0' } };
      return { status: 200, headers: { 'mcp-session-id': session }, json: { jsonrpc: '2.0', id, result } };
    }
    // Streamable HTTP: after initialize, every request names the session it belongs to.
    if (!sessions.has(req.headers['mcp-session-id'] ?? '')) {
      return { status: 400, json: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bad Request: no valid session' } } };
    }
    if (id === undefined) return { status: 202 };
    if (body.method === 'tools/list') return reply({ tools: TOOLS });
    if (body.method !== 'tools/call') return error(-32601, 'Method not found', body.method);

    const args = isRecord(params.arguments) ? params.arguments : {};
    const meta = isRecord(args.meta) ? args.meta['ucp-agent'] : undefined;
    if (!isRecord(meta) || typeof meta.profile !== 'string' || !meta.profile.startsWith('https://')) {
      return error(-32001, 'UCP discovery failed', { code: 'invalid_profile_url', content: 'Missing profile uri', continue_url: `${req.origin}/` }, 422);
    }
    const toolResult = (payload: Record<string, unknown>) => reply({ structuredContent: payload, content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false });
    const toolError = (text: string) => reply({ content: [{ type: 'text', text }], isError: true });
    if (params.name === 'lookup_catalog' || params.name === 'search_catalog') {
      const q = question(params.name === 'lookup_catalog' ? 'lookup' : 'search', args.catalog);
      if (!q.ok) return toolError(`Invalid arguments: ${q.reason}`);
      return toolResult(answer(shop, 'mcp', req.origin, q));
    }
    if (params.name === 'create_cart') return toolError('The fixture shop does not make carts here.');
    return error(-32602, 'Invalid params', `Tool not found: ${String(params.name)}`);
  }

  return {
    rpcCalls: () => [...calls],
    handle(req) {
      if (!AGENT_PATHS.has(req.path)) return null;
      let out: Outcome;
      if (req.path === '/.well-known/ucp') {
        out = req.method === 'GET' || req.method === 'HEAD' ? { status: 200, headers: { 'cache-control': 'public, max-age=60' }, json: profile(req.origin) } : { status: 405, json: { code: 'method_not_allowed' } };
      } else if (req.path === '/api/mcp') {
        out = mcpRoute(req);
      } else {
        out = restRoute(shop, req);
      }
      return { status: out.status, headers: out.headers ?? {}, ...(out.json === undefined ? {} : { json: out.json }) };
    },
  };
}
