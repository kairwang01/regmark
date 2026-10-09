// JSON-RPC 2.0 over HTTP POST, the way MCP's Streamable HTTP transport and
// UCP's MCP binding carry it: one request per POST, answered either with a
// JSON body or with a server-sent event stream that holds the answer. A
// stream is read only until the answer is in it; one the server closes
// before answering is resumed, as MCP 2025-11-25 lets a server ask.
//
// Every request goes through ctx.fetcher.query, which checks robots.txt,
// paces the host and never follows a redirect. Nothing here throws on what
// the server sent; every failure comes back as an outcome with an issue code.

import type { CollectContext, CollectIssue, Fetched, Surface } from '@regmark/core';
import { clip, isOk, isRecord, parseJson, refusalIssue, statusIssue } from './util.ts';

/** One conversation with one endpoint. `headers` grows as the server hands out a session. */
export type RpcSession = {
  surface: Surface;
  url: string;
  headers: Record<string, string>;
  nextId: number;
};

export type RpcOutcome = { ok: true; result: unknown; fetched: Fetched } | { ok: false; issue: CollectIssue };

/** MCP's Streamable HTTP transport asks a client to accept both kinds of answer. */
export const RPC_ACCEPT = 'application/json, text/event-stream';

/** How often a stream the server closed before answering is resumed. */
export const MAX_RESUMES = 3;

/** The longest wait a server's `retry` field can ask for before a resume. */
const MAX_RETRY_MS = 5_000;

export function rpcSession(surface: Surface, url: string): RpcSession {
  return { surface, url, headers: { accept: RPC_ACCEPT }, nextId: 1 };
}

/**
 * Sends one request and returns the answer to it. `what` names the request
 * in issue messages: the tool, for a tools/call.
 */
export async function rpc(
  ctx: CollectContext,
  session: RpcSession,
  method: string,
  params?: Record<string, unknown>,
  what: string = method,
): Promise<RpcOutcome> {
  const id = session.nextId++;
  const body: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) body.params = params;
  const complete = (stream: string) => answerIn(eventMessages(stream), id) !== undefined;
  let res: Fetched;
  try {
    res = await ctx.fetcher.query(session.url, body, { headers: session.headers, complete });
    // A server may close the stream before it answers, having sent an event
    // id to resume from; the answer then comes on a GET that names that id.
    for (let resume = 0; resume < MAX_RESUMES && isOk(res.status) && answerTo(res, id) === undefined; resume++) {
      const stream = streamState(res);
      if (stream?.lastEventId === undefined) break;
      if (stream.retryMs) await new Promise((wake) => setTimeout(wake, Math.min(stream.retryMs!, MAX_RETRY_MS)));
      const headers = { ...session.headers, accept: 'text/event-stream', 'last-event-id': stream.lastEventId };
      res = await ctx.fetcher.get(session.url, { headers, complete });
    }
  } catch (err) {
    return { ok: false, issue: refusalIssue(session.surface, err, session.url, what) };
  }
  // A server may answer a JSON-RPC error with a 4xx status (Shopify uses 422
  // for a profile it cannot fetch), so the body is read before the status.
  const answer = answerTo(res, id);
  if (answer) {
    if (answer.error !== undefined) return { ok: false, issue: rpcErrorIssue(session, what, answer.error) };
    return { ok: true, result: answer.result, fetched: res };
  }
  if (!isOk(res.status)) return { ok: false, issue: statusIssue(session.surface, res.status, session.url, what) };
  return { ok: false, issue: { surface: session.surface, code: 'parse-error', message: `${what}: the response holds no JSON-RPC answer to the request`, locator: session.url } };
}

/** Sends a notification, which has no answer. A server accepts one with 202 and no body. */
export async function notify(ctx: CollectContext, session: RpcSession, method: string): Promise<{ ok: true } | { ok: false; issue: CollectIssue }> {
  let res: Fetched;
  try {
    res = await ctx.fetcher.query(session.url, { jsonrpc: '2.0', method }, { headers: session.headers });
  } catch (err) {
    return { ok: false, issue: refusalIssue(session.surface, err, session.url, method) };
  }
  return isOk(res.status) ? { ok: true } : { ok: false, issue: statusIssue(session.surface, res.status, session.url, method) };
}

type Answer = { result?: unknown; error?: unknown };

/**
 * The JSON-RPC response with this id, from a JSON body (one message or a
 * batch) or from the data of a server-sent event stream. A server may send
 * other messages on the stream first, such as a progress notification.
 */
function answerTo(res: Fetched, id: number): Answer | undefined {
  if (isEventStream(res)) return answerIn(eventMessages(res.body), id);
  const parsed = parseJson(res.body);
  return parsed ? answerIn(Array.isArray(parsed.value) ? parsed.value : [parsed.value], id) : undefined;
}

const isEventStream = (res: Fetched): boolean => (res.headers['content-type'] ?? '').toLowerCase().includes('text/event-stream');

/** The JSON messages of an event stream; an event whose data is not JSON, such as an empty priming event, is passed over. */
function eventMessages(stream: string): unknown[] {
  return eventData(stream).flatMap((data) => {
    const parsed = parseJson(data);
    return parsed ? [parsed.value] : [];
  });
}

function answerIn(messages: readonly unknown[], id: number): Answer | undefined {
  for (const message of messages) {
    if (!isRecord(message) || message.id !== id) continue;
    if (Object.hasOwn(message, 'error')) return { error: message.error };
    if (Object.hasOwn(message, 'result')) return { result: message.result };
  }
  return undefined;
}

/**
 * Where an event stream left off: the last event id it set and the reconnect
 * delay it asked for, if any. Undefined for a response that is not a stream.
 */
function streamState(res: Fetched): { lastEventId?: string; retryMs?: number } | undefined {
  if (!isEventStream(res)) return undefined;
  const state: { lastEventId?: string; retryMs?: number } = {};
  for (const line of res.body.split(/\r\n|\n|\r/)) {
    // An id with a NUL in it is ignored, as the event stream format says.
    if (line.startsWith('id:')) {
      const value = line.slice(3).replace(/^ /, '');
      if (!value.includes('\0')) state.lastEventId = value || undefined;
    }
    if (/^retry: ?\d+$/.test(line)) state.retryMs = Number(line.slice(6).trim());
  }
  return state;
}

/** The data of each event in a server-sent event stream, with multi-line data joined by newlines. */
export function eventData(stream: string): string[] {
  const out: string[] = [];
  for (const event of stream.split(/\r\n\r\n|\n\n|\r\r/)) {
    const lines = event.split(/\r\n|\n|\r/).filter((line) => line.startsWith('data:'));
    if (lines.length) out.push(lines.map((line) => line.slice(5).replace(/^ /, '')).join('\n'));
  }
  return out;
}

/**
 * A JSON-RPC error as an issue. UCP puts its own code in `error.data.code`
 * (version_unsupported, profile_unreachable and so on); MCP uses -32601 for a
 * method the server does not have.
 */
function rpcErrorIssue(session: RpcSession, method: string, error: unknown): CollectIssue {
  const fields = isRecord(error) ? error : {};
  const number = typeof fields.code === 'number' ? fields.code : undefined;
  const text = typeof fields.message === 'string' ? clip(fields.message) : '';
  const data = fields.data;
  const ucpCode = isRecord(data) && typeof data.code === 'string' ? data.code : undefined;
  const detail = isRecord(data) && typeof data.content === 'string' ? data.content : typeof data === 'string' ? data : undefined;
  const code = ucpCode === 'version_unsupported' ? 'version-unsupported' : number === -32601 ? 'not-supported' : 'fetch-failed';
  const why = [ucpCode, detail === undefined ? undefined : clip(detail)].filter((s): s is string => !!s).join(': ');
  const message = `${method}: JSON-RPC error${number === undefined ? '' : ` ${number}`}${text ? ` ${text}` : ''}${why ? ` (${clip(why)})` : ''}`;
  return { surface: session.surface, code, message, locator: session.url };
}

/**
 * The UCP payload a tool returned, and the JSON pointer to it inside the
 * JSON-RPC response. MCP puts it in `structuredContent` and repeats it as
 * JSON text in `content`; older servers give only the text.
 */
export function toolPayload(session: RpcSession, tool: string, result: unknown): { ok: true; payload: Record<string, unknown>; pointer: string } | { ok: false; issue: CollectIssue } {
  const fail = (code: string, message: string) => ({ ok: false as const, issue: { surface: session.surface, code, message: `${tool}: ${message}`, locator: session.url } });
  if (!isRecord(result)) return fail('parse-error', 'the tool result is not an object');
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content.flatMap((item, index) => (isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? [{ index, text: item.text }] : []));
  if (result.isError === true) return fail('fetch-failed', `the tool reported an error${texts.length ? `: ${clip(texts.map((t) => t.text).join(' '))}` : ''}`);
  if (isRecord(result.structuredContent)) return { ok: true, payload: result.structuredContent, pointer: '/result/structuredContent' };
  for (const { index, text } of texts) {
    const parsed = parseJson(text);
    if (parsed && isRecord(parsed.value)) return { ok: true, payload: parsed.value, pointer: `/result/content/${index}/text` };
  }
  return fail('parse-error', 'the tool result carries no JSON object');
}
