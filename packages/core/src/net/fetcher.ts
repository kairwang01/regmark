// The one place Regmark opens a socket.
//
// Everything a collector fetches goes through here, so the properties below
// hold for the whole tool rather than for whichever collector remembered:
//
//   - only hosts on the run's allowlist are contacted; a redirect or a link
//     pointing anywhere else is returned to the caller unfollowed
//   - no host that resolves to a private address is contacted, checked on
//     the addresses the socket actually uses (see guard.ts)
//   - robots.txt is obeyed for reads
//   - requests to one host are spaced out
//   - a response is cut off at a size limit that counts decompressed bytes
//   - a request that changes state is refused unless the run verified that
//     the operator controls the shop (see ownership.ts)
//   - so is a read made as the owner: one that skips robots.txt, or sends a
//     User-Agent other than Regmark's own

import http from 'node:http';
import https from 'node:https';
import { pipeline, Writable } from 'node:stream';
import { TextDecoder } from 'node:util';
import zlib from 'node:zlib';
import type { Fetched, Fetcher, RequestOptions } from '../types.ts';
import { guardedLookup, ipLiteral, isPublicAddress, PrivateAddressError } from './guard.ts';
import { isAllowed, parseRobots, type Robots } from './robots.ts';

export type FetchPolicy = {
  /** Sent as User-Agent. Says who is asking and where to read about it. */
  userAgent: string;
  /** The product token matched against robots.txt groups. */
  agentToken: string;
  /** Hostnames this run may contact. "www." is ignored when comparing. */
  hosts: readonly string[];
  /** Minimum gap between requests to one host. */
  minIntervalMs: number;
  timeoutMs: number;
  /** Largest response body accepted, counted after decompression. */
  maxBytes: number;
  maxRedirects: number;
  respectRobots: boolean;
  /** Off by default. On only for a shop running on the operator's own machine or network. */
  allowPrivateNetwork: boolean;
};

export const DEFAULT_POLICY: Omit<FetchPolicy, 'hosts'> = {
  userAgent: 'Regmark/0.1.0 (+https://github.com/kairwang01/regmark)',
  agentToken: 'Regmark',
  minIntervalMs: 1000,
  timeoutMs: 15_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  respectRobots: true,
  allowPrivateNetwork: false,
};

export type RefusalCode =
  | 'bad-url'
  | 'foreign-host'
  | 'robots'
  | 'private-address'
  | 'too-large'
  | 'timeout'
  | 'too-many-redirects'
  | 'write-not-authorized'
  | 'network';

/** Thrown for every request that was not made, or was made and did not finish. */
export class FetchRefused extends Error {
  readonly code: RefusalCode;
  readonly url: string;
  constructor(code: RefusalCode, url: string, detail?: string) {
    super(`${code}: ${url}${detail ? ` (${detail})` : ''}`);
    this.name = 'FetchRefused';
    this.code = code;
    this.url = url;
  }
}

export type GuardedFetcher = Fetcher & {
  /** Called once ownership has been verified. There is no way to call it from the command line. */
  authorizeWrites(): void;
  readonly stats: { requests: number };
};

const hostKey = (hostname: string) => hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

type Raw = { status: number; headers: Record<string, string>; body: Buffer };

function decoderFor(contentType: string | undefined): TextDecoder {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset);
    } catch {
      // An unknown label falls through to UTF-8.
    }
  }
  return new TextDecoder('utf-8');
}

export function createFetcher(options: Partial<FetchPolicy> & { hosts: readonly string[] }): GuardedFetcher {
  // JS callers often forward optional fields explicitly. Undefined means
  // "use the default", never "disable robots or response limits".
  const overrides = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const policy: FetchPolicy = { ...DEFAULT_POLICY, ...overrides, hosts: options.hosts };
  const allowed = new Set(policy.hosts.map(hostKey));
  const nextSlot = new Map<string, number>();
  const robotsCache = new Map<string, Promise<Robots | 'allow-all' | 'deny-all'>>();
  const stats = { requests: 0 };
  let writesAuthorized = false;

  function parse(url: string): URL {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new FetchRefused('bad-url', url);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchRefused('bad-url', url, 'only http and https');
    if (u.username || u.password) throw new FetchRefused('bad-url', url, 'credentials in URL');
    return u;
  }

  function assertAllowedHost(u: URL): void {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchRefused('bad-url', u.href, 'only http and https');
    if (u.username || u.password) throw new FetchRefused('bad-url', u.href, 'credentials in URL');
    if (!allowed.has(hostKey(u.hostname))) throw new FetchRefused('foreign-host', u.href);
    const literal = ipLiteral(u.hostname);
    if (literal && !policy.allowPrivateNetwork && !isPublicAddress(literal)) {
      throw new FetchRefused('private-address', u.href, literal);
    }
  }

  async function pace(u: URL): Promise<void> {
    const key = hostKey(u.hostname);
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(key) ?? 0);
    nextSlot.set(key, at + policy.minIntervalMs);
    if (at > now) await sleep(at - now);
  }

  function request(method: string, u: URL, headers: Record<string, string>, body?: Buffer): Promise<Raw> {
    // This is the socket boundary, including robots.txt redirect targets.
    assertAllowedHost(u);
    stats.requests += 1;
    return new Promise<Raw>((resolve, reject) => {
      const lib = u.protocol === 'https:' ? https : http;
      const signal = AbortSignal.timeout(policy.timeoutMs);
      const req = lib.request(
        u,
        {
          method,
          signal,
          headers: {
            'user-agent': policy.userAgent,
            accept: '*/*',
            'accept-encoding': 'gzip, br, deflate',
            ...headers,
            ...(body ? { 'content-length': String(body.length) } : {}),
          },
          ...(policy.allowPrivateNetwork ? {} : { lookup: guardedLookup as never }),
        },
        (res) => {
          const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
          const decoder =
            encoding === 'gzip' || encoding === 'x-gzip'
              ? zlib.createGunzip()
              : encoding === 'br'
                ? zlib.createBrotliDecompress()
                : encoding === 'deflate'
                  ? zlib.createInflate()
                  : undefined;
          const chunks: Buffer[] = [];
          let size = 0;
          const sink = new Writable({
            write(chunk: Buffer, _encoding, done) {
              size += chunk.length;
              if (size > policy.maxBytes) {
                done(new FetchRefused('too-large', u.href, `over ${policy.maxBytes} bytes`));
                return;
              }
              chunks.push(chunk);
              done();
            },
          });
          // pipeline propagates upstream aborts and destroys the response and
          // decoder on failure, including decompression and size-limit errors.
          pipeline(decoder ? [res, decoder, sink] : [res, sink], (err) => {
            if (err) {
              reject(err instanceof FetchRefused ? err : new FetchRefused('network', u.href, err.message));
              return;
            }
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              // Cookie expiry dates contain commas, so several Set-Cookie
              // headers are kept one per line instead of comma-joined.
              const joiner = k.toLowerCase() === 'set-cookie' ? '\n' : ', ';
              if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(joiner) : v;
            }
            resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks) });
          });
        },
      );
      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err instanceof FetchRefused) return reject(err);
        if (err instanceof PrivateAddressError) return reject(new FetchRefused('private-address', u.href, err.message));
        if (err.name === 'TimeoutError' || err.name === 'AbortError') return reject(new FetchRefused('timeout', u.href, `${policy.timeoutMs} ms`));
        reject(new FetchRefused('network', u.href, err.code ?? err.message));
      });
      req.end(body);
    });
  }

  function loadRobots(u: URL): Promise<Robots | 'allow-all' | 'deny-all'> {
    const origin = u.origin;
    let pending = robotsCache.get(origin);
    if (!pending) {
      pending = (async () => {
        try {
          let target = new URL('/robots.txt', origin);
          for (let hop = 0; hop <= policy.maxRedirects; hop++) {
            await pace(target);
            const raw = await request('GET', target, {});
            const location = raw.headers['location'];
            if (REDIRECTS.has(raw.status) && location) {
              const next = new URL(location, target);
              if (!allowed.has(hostKey(next.hostname)) || (next.protocol !== 'http:' && next.protocol !== 'https:')) return 'allow-all';
              target = next;
              continue;
            }
            // RFC 9309: a 4xx means there are no rules; a 5xx means assume the worst.
            if (raw.status >= 200 && raw.status < 300) return parseRobots(decoderFor(raw.headers['content-type']).decode(raw.body));
            return raw.status >= 500 ? 'deny-all' : 'allow-all';
          }
          return 'allow-all';
        } catch (err) {
          // A shop on a private address must not be reported as a robots refusal.
          if (err instanceof FetchRefused && err.code === 'private-address') throw err;
          return 'deny-all';
        }
      })();
      robotsCache.set(origin, pending);
    }
    return pending;
  }

  async function assertRobots(u: URL): Promise<void> {
    if (!policy.respectRobots) return;
    const robots = await loadRobots(u);
    const ok = robots === 'allow-all' ? true : robots === 'deny-all' ? false : isAllowed(robots, policy.agentToken, u.pathname + u.search);
    if (!ok) throw new FetchRefused('robots', u.href);
  }

  /**
   * Caller headers, checked. A different User-Agent is posing as another
   * client, which Regmark does only on a shop that has shown it is the
   * operator's, and only when the caller says it is reading as the owner.
   */
  function callerHeaders(u: URL, init: RequestOptions): Record<string, string> {
    const headers = init.headers ?? {};
    const posing = Object.keys(headers).some((name) => name.toLowerCase() === 'user-agent');
    if (posing && !init.asOwner) throw new FetchRefused('write-not-authorized', u.href, 'a different User-Agent needs an owner read');
    if (init.asOwner && !writesAuthorized) throw new FetchRefused('write-not-authorized', u.href, 'ownership of this shop has not been verified');
    return headers;
  }

  const finish = (u: URL, raw: Raw): Fetched => ({
    url: u.href,
    status: raw.status,
    headers: raw.headers,
    body: decoderFor(raw.headers['content-type']).decode(raw.body),
    fetchedAt: new Date().toISOString(),
  });

  return {
    stats,
    authorizeWrites() {
      writesAuthorized = true;
    },

    async get(url: string, init: RequestOptions = {}): Promise<Fetched> {
      let u = parse(url);
      let headers = callerHeaders(u, init);
      let owner = init.asOwner === true;
      for (let hop = 0; ; hop++) {
        assertAllowedHost(u);
        // robots.txt speaks to crawlers. The owner reading their own shop is not one.
        if (!owner) await assertRobots(u);
        await pace(u);
        const raw = await request('GET', u, headers);
        const location = raw.headers['location'];
        if (!REDIRECTS.has(raw.status) || !location) return finish(u, raw);
        let next: URL;
        try {
          next = new URL(location, u);
        } catch {
          return finish(u, raw);
        }
        // A redirect that leaves the allowlist is the caller's to interpret, not ours to follow.
        if ((next.protocol !== 'http:' && next.protocol !== 'https:') || !allowed.has(hostKey(next.hostname))) return finish(u, raw);
        if (hop >= policy.maxRedirects) throw new FetchRefused('too-many-redirects', url);
        // An allowlisted feed host is not entitled to a shop's credentials or
        // cart token. Only same-origin redirects may inherit caller headers.
        // Nor is it the shop whose ownership was shown, so an owner read
        // becomes an ordinary one there: robots.txt applies again, and the
        // User-Agent is Regmark's own.
        if (next.origin !== u.origin) {
          headers = {};
          owner = false;
        }
        u = next;
      }
    },

    async query(url: string, json: unknown, init: RequestOptions = {}): Promise<Fetched> {
      const u = parse(url);
      const headers = callerHeaders(u, init);
      assertAllowedHost(u);
      if (!init.asOwner) await assertRobots(u);
      await pace(u);
      const body = Buffer.from(JSON.stringify(json));
      // A redirect is returned, not followed: replaying a body elsewhere is not something to do silently.
      return finish(u, await request('POST', u, { 'content-type': 'application/json', accept: 'application/json', ...headers }, body));
    },

    async send(method, url, init = {}): Promise<Fetched> {
      const u = parse(url);
      assertAllowedHost(u);
      if (!writesAuthorized) throw new FetchRefused('write-not-authorized', u.href, 'ownership of this shop has not been verified');
      await pace(u);
      const body = init.json === undefined ? undefined : Buffer.from(JSON.stringify(init.json));
      // A write is always made as the owner, so it may set its own User-Agent.
      const headers = { ...(body ? { 'content-type': 'application/json' } : {}), ...callerHeaders(u, { ...init, asOwner: true }) };
      // Redirects are never followed for a write: replaying a body somewhere else is not something to do silently.
      return finish(u, await request(method, u, headers, body));
    },
  };
}
