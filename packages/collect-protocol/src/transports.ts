// How a catalogue question travels. UCP binds the same two read-only
// operations to two transports:
//
//   REST  POST <endpoint>/catalog/lookup or /catalog/search, the request as
//         the JSON body, the agent profile in a UCP-Agent header
//   MCP   a JSON-RPC tools/call of lookup_catalog or search_catalog, the
//         request under arguments.catalog, the profile under arguments.meta
//
// Both answer with the same UCP payload. Neither creates anything on the shop.

import { createHash, randomUUID } from 'node:crypto';
import type { CollectContext, Fetched, Surface } from '@regmark/core';
import type { Ask, Operation } from './catalog.ts';
import { rpc, toolPayload } from './jsonrpc.ts';
import type { RpcSession } from './jsonrpc.ts';
import { clip, isOk, isRecord, parseJson, refusalIssue, statusIssue } from './util.ts';

const REST_PATH: Readonly<Record<Operation, string>> = {
  lookup_catalog: '/catalog/lookup',
  search_catalog: '/catalog/search',
};

/** RFC 8941 string: the profile URL in quotes, with quotes and backslashes escaped. */
const profileHeader = (profile: string): string => `profile="${profile.replace(/[\\"]/g, '\\$&')}"`;

/**
 * The REST binding. The headers are the ones UCP's OpenAPI marks required
 * for a catalogue call: UCP-Agent and Request-Id. Content-Digest (RFC 9530)
 * is sent too, as the spec asks for a request with a body; it is computed
 * over the same serialisation the fetcher sends.
 */
export function restAsk(ctx: CollectContext, surface: Surface, endpoint: string, agentProfile: string): Ask {
  const base = endpoint.replace(/\/+$/, '');
  return async (operation, request) => {
    const url = `${base}${REST_PATH[operation]}`;
    const headers = {
      'ucp-agent': profileHeader(agentProfile),
      'request-id': randomUUID(),
      'content-digest': `sha-256=:${createHash('sha256').update(JSON.stringify(request)).digest('base64')}:`,
    };
    let res: Fetched;
    try {
      res = await ctx.fetcher.query(url, request, { headers });
    } catch (err) {
      return { ok: false, issue: refusalIssue(surface, err, url, operation) };
    }
    const parsed = parseJson(res.body);
    const body = parsed && isRecord(parsed.value) ? parsed.value : undefined;
    if (!isOk(res.status)) {
      // A protocol error carries UCP's own code: version_unsupported,
      // profile_unreachable and the like. It says more than the status.
      const code = typeof body?.code === 'string' ? body.code : undefined;
      if (code === undefined) return { ok: false, issue: statusIssue(surface, res.status, url, operation) };
      const content = typeof body?.content === 'string' ? `: ${clip(body.content)}` : '';
      return {
        ok: false,
        issue: { surface, code: code === 'version_unsupported' ? 'version-unsupported' : 'fetch-failed', message: `${operation}: HTTP ${res.status} ${clip(code, 60)}${content}`, locator: url },
      };
    }
    if (!body) return { ok: false, issue: { surface, code: 'parse-error', message: `${operation}: the answer is not a JSON object`, locator: url } };
    return { ok: true, payload: body, url, pointer: '', fetchedAt: res.fetchedAt };
  };
}

/** The MCP binding: one tools/call per question, on a session the caller has set up. */
export function toolAsk(ctx: CollectContext, session: RpcSession, agentProfile: string): Ask {
  return async (operation, request) => {
    const params = { name: operation, arguments: { meta: { 'ucp-agent': { profile: agentProfile } }, catalog: request } };
    const outcome = await rpc(ctx, session, 'tools/call', params, operation);
    if (!outcome.ok) return outcome;
    const tool = toolPayload(session, operation, outcome.result);
    if (!tool.ok) return tool;
    return { ok: true, payload: tool.payload, url: session.url, pointer: tool.pointer, fetchedAt: outcome.fetched.fetchedAt };
  };
}
