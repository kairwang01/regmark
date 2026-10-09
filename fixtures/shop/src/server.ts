// The fixture shop's HTTP server: the page and feed renderers plus the store API.
//
// The origin written into pages comes from the address the socket actually
// bound to, never from the request's Host header, so a client cannot make the
// shop print someone else's URLs.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildShop, clientOf } from './shop.ts';
import type { Shop } from './shop.ts';
import { renderFeed } from './render-feed.ts';
import { renderHome, renderProductPage, renderRobots, renderSitemap } from './render-page.ts';
import { createStoreApi } from './store-api.ts';
import type { CartSnapshot, StoreApi } from './store-api.ts';

const STORE_BASE = '/wp-json/wc/store/v1';
const MAX_BODY_BYTES = 64 * 1024;

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const XML = 'application/xml; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

export type RunningShop = {
  origin: string;
  shop: Shop;
  /** "METHOD /path?query" for every request received, in order. */
  requests: string[];
  /** The User-Agent of every request received, in the same order; empty when none was sent. */
  userAgents: string[];
  carts(): CartSnapshot[];
  close(): Promise<void>;
};

export type StartOptions = { mode: 'clean' | 'misprint'; now?: Date; port?: number; host?: string };

type Env = { shop: Shop; api: StoreApi; origin: string };

export async function startShop(options: StartOptions): Promise<RunningShop> {
  const shop = buildShop(options.mode, options.now);
  const api = createStoreApi(shop);
  const requests: string[] = [];
  const userAgents: string[] = [];
  const env: Env = { shop, api, origin: '' };

  const server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    userAgents.push(req.headers['user-agent'] ?? '');
    try {
      await route(req, res, env);
    } catch {
      // A renderer bug must cost one response, not the whole fixture.
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(500, { 'content-type': TEXT });
      res.end('Internal Server Error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('startShop: no TCP address');
  const host = address.address.includes(':') ? `[${address.address}]` : address.address;
  env.origin = `http://${host}:${address.port}`;

  return {
    origin: env.origin,
    shop,
    requests,
    userAgents,
    carts: () => api.carts(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // Keep-alive sockets would otherwise hold the close open indefinitely.
        server.closeAllConnections();
      }),
  };
}

async function route(req: IncomingMessage, res: ServerResponse, env: Env): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://fixture.invalid');
  const path = url.pathname;

  if (path === STORE_BASE || path.startsWith(`${STORE_BASE}/`)) return storeRoute(req, res, url, env);

  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
  const { shop, origin } = env;

  if (path === '/') return send(res, 200, HTML, renderHome(shop, origin));
  if (path === '/robots.txt') return send(res, 200, TEXT, renderRobots(origin));
  if (path === '/sitemap.xml') return send(res, 200, XML, renderSitemap(shop, origin));
  if (path === '/feeds/google.xml') return send(res, 200, XML, renderFeed(shop, origin));
  if (path === '/.well-known/regmark.txt') return send(res, 200, TEXT, `regmark-verify=${shop.token}\n`);
  if (path === '/__regmark/expected.json') {
    const body = JSON.stringify({ mode: shop.mode, defects: shop.defects, expected: shop.expected });
    return send(res, 200, 'application/json', body);
  }

  const page = /^\/product\/([^/]+)\/$/.exec(path);
  if (page) {
    // The page is the one place the shop looks at who is asking. A clean
    // product answers everyone the same; one with an agent override does not.
    const body = renderProductPage(shop, page[1]!, origin, clientOf(req.headers['user-agent']));
    return body === null ? notFound(res) : send(res, 200, HTML, body);
  }
  const bare = /^\/product\/([^/]+)$/.exec(path);
  if (bare) {
    res.writeHead(301, { location: `/product/${bare[1]}/${url.search}` });
    res.end();
    return;
  }

  return notFound(res);
}

async function storeRoute(req: IncomingMessage, res: ServerResponse, url: URL, env: Env): Promise<void> {
  const { tooLarge, text } = await readBody(req);
  if (tooLarge) {
    return sendJson(res, 413, {
      code: 'rest_payload_too_large',
      message: 'Request body is larger than 64 KiB.',
      data: { status: 413 },
    });
  }

  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return sendJson(res, 400, { code: 'rest_invalid_json', message: 'Invalid JSON body passed.', data: { status: 400 } });
    }
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }

  const result = env.api.handle({
    method: req.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    headers,
    body,
    origin: env.origin,
  });
  if (!result) return notFound(res);

  res.writeHead(result.status, { ...result.headers, 'content-type': JSON_TYPE });
  res.end(JSON.stringify(result.json));
}

/** Reads the whole body, but keeps draining past the limit so the client receives the 413 instead of a reset. */
async function readBody(req: IncomingMessage): Promise<{ tooLarge: boolean; text: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk as Buffer);
  }
  return { tooLarge, text: Buffer.concat(chunks).toString('utf8') };
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  send(res, status, JSON_TYPE, JSON.stringify(json));
}

function notFound(res: ServerResponse): void {
  send(res, 404, HTML, '<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1>\n');
}
