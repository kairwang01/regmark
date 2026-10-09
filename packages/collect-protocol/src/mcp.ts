// A shop's storefront MCP server: the tools a shopping agent calls to read
// the catalogue, asked about the sampled products only.
//
// The conversation is the one MCP prescribes for its Streamable HTTP
// transport: initialize, the initialized notification, tools/list, then
// tools/call. Only two tools are ever called, UCP's catalogue reads
// lookup_catalog and search_catalog, and only when the server lists them with
// UCP's input shape. A cart, checkout or order tool is never called, whatever
// the server lists.
//
// Shopify removed the catalogue tools of its first storefront MCP server
// (search_shop_catalog, get_product_details) in 2026; they now live on its
// UCP endpoint, /api/ucp/mcp. Their old shapes are no longer published, so
// they are not read: a server that offers only those is reported as having
// no catalogue tool.

import type { CollectContext, CollectResult } from '@regmark/core';
import { readCatalogue } from './catalog.ts';
import type { Operation } from './catalog.ts';
import { notify, rpc, rpcSession } from './jsonrpc.ts';
import type { RpcSession } from './jsonrpc.ts';
import type { EndpointOptions } from './refs.ts';
import { toolAsk } from './transports.ts';
import { AGENT_PROFILES } from './ucp.ts';
import { clip, isRecord, issue } from './util.ts';

/** The MCP protocol revisions this client speaks, newest first. All three carry tools over Streamable HTTP. */
export const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

/** Where a shop's storefront MCP server answers, by the convention Shopify set. */
export const MCP_PATH = '/api/mcp';

/** The only tools this collector calls. Both read the catalogue and change nothing. */
export const CATALOGUE_TOOLS: readonly Operation[] = ['lookup_catalog', 'search_catalog'];

const CLIENT = { name: 'regmark', version: '0.1.0' };

/** tools/list may be paged. A catalogue server has a handful of tools; this many pages is plenty. */
const MAX_TOOL_PAGES = 5;

/** A session id is visible ASCII; anything else is not sent back. */
const SESSION_ID = /^[\x21-\x7e]{1,512}$/;

export async function collectMcp(ctx: CollectContext, options: EndpointOptions): Promise<CollectResult> {
  if (options.products.length === 0) return { sightings: [], issues: [] };
  const url = options.url ?? new URL(MCP_PATH, ctx.store).href;
  const session = rpcSession('mcp', url);
  const fail = (code: string, message: string): CollectResult => ({ sightings: [], issues: [issue('mcp', code, message, url)] });

  const init = await rpc(ctx, session, 'initialize', { protocolVersion: MCP_VERSIONS[0], capabilities: {}, clientInfo: CLIENT });
  if (!init.ok) return { sightings: [], issues: [init.issue] };
  const version = isRecord(init.result) ? init.result.protocolVersion : undefined;
  if (typeof version !== 'string' || !(MCP_VERSIONS as readonly string[]).includes(version)) {
    const said = typeof version === 'string' ? clip(version, 40) : 'no version';
    return fail('version-unsupported', `initialize: the server speaks MCP ${said}; Regmark speaks ${MCP_VERSIONS.join(', ')}`);
  }
  // Streamable HTTP: every later request names the version, and the session
  // when the server started one.
  session.headers['mcp-protocol-version'] = version;
  const sessionId = init.fetched.headers['mcp-session-id'];
  if (sessionId !== undefined && SESSION_ID.test(sessionId)) session.headers['mcp-session-id'] = sessionId;
  const ready = await notify(ctx, session, 'notifications/initialized');
  if (!ready.ok) return { sightings: [], issues: [ready.issue] };

  const listed = await listTools(ctx, session);
  if (!listed.ok) return { sightings: [], issues: [listed.issue] };
  const usable = (name: Operation) => listed.tools.find((tool) => tool.name === name && catalogueShaped(tool) && !declaresWrites(tool));
  const lookup = usable('lookup_catalog');
  const search = usable('search_catalog');
  if (!lookup && !search) {
    const names = listed.tools.map((tool) => (typeof tool.name === 'string' ? clip(tool.name, 60) : '?'));
    const shown = names.length ? `; it lists ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}` : '; it lists no tool';
    return fail('not-supported', `tools/list: no UCP catalogue tool (lookup_catalog or search_catalog)${shown}`);
  }

  const ask = toolAsk(ctx, session, options.agentProfile ?? AGENT_PROFILES['2026-08-25']);
  return readCatalogue(ask, {
    surface: 'mcp',
    refs: options.products,
    platform: options.platform,
    lookup: lookup !== undefined,
    search: search !== undefined,
    includeUnavailable: [lookup, search].every((tool) => tool === undefined || takesAvailableFilter(tool)),
  });
}

type Tool = Record<string, unknown>;

async function listTools(ctx: CollectContext, session: RpcSession): Promise<{ ok: true; tools: Tool[] } | { ok: false; issue: ReturnType<typeof issue> }> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const listed = await rpc(ctx, session, 'tools/list', cursor === undefined ? undefined : { cursor });
    if (!listed.ok) return listed;
    const result = isRecord(listed.result) ? listed.result : undefined;
    if (!result || !Array.isArray(result.tools)) return { ok: false, issue: issue('mcp', 'parse-error', 'tools/list: the answer has no tools list', session.url) };
    tools.push(...result.tools.filter(isRecord));
    if (typeof result.nextCursor !== 'string' || result.nextCursor === '') break;
    cursor = result.nextCursor;
  }
  return { ok: true, tools };
}

const schemaProperty = (schema: unknown, name: string): unknown =>
  isRecord(schema) && isRecord(schema.properties) && Object.hasOwn(schema.properties, name) ? schema.properties[name] : undefined;

/** UCP's catalogue tools take the question under `catalog`, beside the agent's `meta`. */
function catalogueShaped(tool: Tool): boolean {
  return isRecord(schemaProperty(tool.inputSchema, 'catalog'));
}

/** MCP lets a tool say it changes things. One that says so is not called, whatever its name. */
function declaresWrites(tool: Tool): boolean {
  return isRecord(tool.annotations) && (tool.annotations.readOnlyHint === false || tool.annotations.destructiveHint === true);
}

/** Whether the tool's input schema has catalog.filters.available, Shopify's switch for sold-out variants. */
function takesAvailableFilter(tool: Tool): boolean {
  const filters = schemaProperty(schemaProperty(tool.inputSchema, 'catalog'), 'filters');
  return schemaProperty(filters, 'available') !== undefined;
}
