import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import zlib from 'node:zlib';
import { createFetcher, DEFAULT_POLICY, FetchRefused, verifyOwnership } from '../src/index.ts';

let server: http.Server;
let origin: string;
const hits: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const url = req.url ?? '/';
    if (url === '/hello') return void res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('héllo');
    if (url === '/gzip') return void res.writeHead(200, { 'content-encoding': 'gzip' }).end(zlib.gzipSync('zipped'));
    if (url === '/broken-gzip') return void res.writeHead(200, { 'content-encoding': 'gzip' }).end('invalid compressed data');
    if (url === '/truncated-gzip') {
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': '1000' });
      res.write(zlib.gzipSync('partial'));
      setTimeout(() => res.destroy(), 10);
      return;
    }
    if (url === '/bomb') return void res.writeHead(200, { 'content-encoding': 'gzip' }).end(zlib.gzipSync(Buffer.alloc(200_000, 97)));
    if (url === '/big') return void res.writeHead(200).end(Buffer.alloc(200_000, 97));
    if (url === '/file.gz') return void res.writeHead(200, { 'content-type': 'application/gzip' }).end(zlib.gzipSync('{"item_id":"A"}\n'));
    if (url === '/twice.gz') return void res.writeHead(200, { 'content-encoding': 'gzip' }).end(zlib.gzipSync(zlib.gzipSync('twice')));
    if (url === '/bomb.gz') return void res.writeHead(200, { 'content-type': 'application/gzip' }).end(zlib.gzipSync(Buffer.alloc(200_000, 97)));
    if (url === '/broken.gz') return void res.writeHead(200, { 'content-type': 'application/gzip' }).end(Buffer.from([0x1f, 0x8b, 1, 2, 3]));
    if (url === '/slow') return void setTimeout(() => res.writeHead(200).end('late'), 600);
    if (url === '/open-stream') {
      // Answers at once, then keeps the stream open, as an MCP server may.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': ping\n\n');
      setTimeout(() => res.write('id: 1\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'), 20);
      return;
    }
    if (url === '/hop') return void res.writeHead(302, { location: '/hello' }).end();
    if (url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
    if (url === '/away') return void res.writeHead(301, { location: 'https://elsewhere.example/x' }).end();
    if (url === '/credentials') return void res.writeHead(302, { location: `${origin.replace('http://', 'http://user:password@')}/hello` }).end();
    if (url === '/cross-origin') return void res.writeHead(302, { location: `${origin.replace('127.0.0.1', 'localhost')}/headers` }).end();
    if (url === '/headers') return void res.writeHead(200).end(JSON.stringify(req.headers));
    if (url === '/latin1') return void res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' }).end(Buffer.from([0xe9]));
    if (url === '/ua') return void res.writeHead(200).end(String(req.headers['user-agent']));
    if (url === '/.well-known/regmark.txt') return void res.writeHead(200).end('# verification\nregmark-verify=tok_0123456789abcdef\n');
    if (url === '/cart' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => res.writeHead(201, { 'content-type': 'application/json', 'cart-token': 'T1' }).end(body));
      return;
    }
    res.writeHead(404).end('nope');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const local = (extra = {}) => createFetcher({ hosts: ['127.0.0.1'], allowPrivateNetwork: true, respectRobots: false, minIntervalMs: 0, ...extra });
const refusal = (code: string) => (err: unknown) => err instanceof FetchRefused && err.code === code;

test('get() returns status, lowercased headers and a decoded body', async () => {
  const r = await local().get(`${origin}/hello`);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'héllo');
  assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
  assert.match(r.fetchedAt, /^\d{4}-\d\d-\d\dT/);
});

test('get() decompresses, and honours a declared legacy charset', async () => {
  assert.equal((await local().get(`${origin}/gzip`)).body, 'zipped');
  assert.equal((await local().get(`${origin}/latin1`)).body, 'é');
});

test('get() identifies itself', async () => {
  assert.match((await local().get(`${origin}/ua`)).body, /^Regmark\/\d+\.\d+\.\d+(-[\w.]+)? \(\+https:\/\//);
});

test('a private address is refused unless the run opted in', async () => {
  const strict = createFetcher({ hosts: ['127.0.0.1', 'localhost'], respectRobots: false, minIntervalMs: 0 });
  await assert.rejects(strict.get(`${origin}/hello`), refusal('private-address'));
  // By name as well as by literal: the check runs on what the name resolves to.
  await assert.rejects(strict.get(`${origin.replace('127.0.0.1', 'localhost')}/hello`), refusal('private-address'));
});

test('a host outside the allowlist is refused before any request is made', async () => {
  const before = hits.length;
  await assert.rejects(local().get('http://other.example/'), refusal('foreign-host'));
  await assert.rejects(local().get('ftp://127.0.0.1/x'), refusal('bad-url'));
  await assert.rejects(local().get(`http://user:pw@127.0.0.1/x`), refusal('bad-url'));
  assert.equal(hits.length, before);
});

test('a same-host redirect is followed; one that leaves the allowlist is handed back', async () => {
  const hop = await local().get(`${origin}/hop`);
  assert.equal(hop.status, 200);
  assert.equal(new URL(hop.url).pathname, '/hello');
  const away = await local().get(`${origin}/away`);
  assert.equal(away.status, 301);
  assert.equal(away.headers['location'], 'https://elsewhere.example/x');
  await assert.rejects(local({ maxRedirects: 3 }).get(`${origin}/loop`), refusal('too-many-redirects'));
});

test('redirects reject URL credentials before contacting the destination', async () => {
  const before = hits.length;
  await assert.rejects(local().get(`${origin}/credentials`), refusal('bad-url'));
  assert.deepEqual(hits.slice(before), ['GET /credentials']);
});

test('caller headers do not cross origins even when both hosts are allowed', async () => {
  const headers = { authorization: 'Bearer secret', cookie: 'session=secret', 'cart-token': 'secret' };
  const fetcher = local({ hosts: ['127.0.0.1', 'localhost'] });
  const same = JSON.parse((await fetcher.get(`${origin}/headers`, { headers })).body);
  assert.equal(same.authorization, headers.authorization);
  const other = JSON.parse((await fetcher.get(`${origin}/cross-origin`, { headers })).body);
  for (const name of Object.keys(headers)) assert.equal(other[name], undefined, name);
});

test('robots redirects apply the same URL validation as page redirects', async () => {
  const visited: string[] = [];
  const robotsServer = http.createServer((req, res) => {
    visited.push(req.url ?? '');
    const location = `http://user:password@127.0.0.1:${(robotsServer.address() as AddressInfo).port}/rules`;
    if (req.url === '/robots.txt') res.writeHead(302, { location }).end();
    else res.end('User-agent: *\nAllow: /');
  });
  await new Promise<void>((resolve) => robotsServer.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(robotsServer.address() as AddressInfo).port}/product`;
    await assert.rejects(local({ respectRobots: true }).get(url), refusal('robots'));
    assert.deepEqual(visited, ['/robots.txt']);
  } finally {
    robotsServer.close();
  }
});

test('undefined policy overrides retain safe defaults and obey a real robots refusal', async () => {
  const visited: string[] = [];
  const robotsServer = http.createServer((req, res) => {
    visited.push(req.url ?? '');
    assert.match(req.headers['user-agent'] ?? '', /^Regmark\//);
    res.end('User-agent: *\nDisallow: /');
  });
  await new Promise<void>((resolve) => robotsServer.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(robotsServer.address() as AddressInfo).port}/product`;
    const fetcher = createFetcher({
      hosts: ['127.0.0.1'], allowPrivateNetwork: true,
      respectRobots: undefined, timeoutMs: undefined, minIntervalMs: undefined,
      maxBytes: undefined, maxRedirects: undefined, userAgent: undefined, agentToken: undefined,
    });
    await assert.rejects(fetcher.get(url), refusal('robots'));
    assert.deepEqual(visited, ['/robots.txt']);
  } finally {
    robotsServer.close();
  }
});

test('the size limit counts decompressed bytes', async () => {
  await assert.rejects(local({ maxBytes: 50_000 }).get(`${origin}/big`), refusal('too-large'));
  await assert.rejects(local({ maxBytes: 50_000 }).get(`${origin}/bomb`), refusal('too-large'));
});

test('a gzip file is unpacked only when the caller says the resource may be one', async () => {
  assert.equal((await local().get(`${origin}/file.gz`, { gzipFile: true })).body, '{"item_id":"A"}\n');
  assert.notEqual((await local().get(`${origin}/file.gz`)).body, '{"item_id":"A"}\n');
  // A .gz file sent with Content-Encoding: gzip is compressed twice, and unpacked twice.
  assert.equal((await local().get(`${origin}/twice.gz`, { gzipFile: true })).body, 'twice');
  // A body without the magic bytes is left as it is.
  assert.equal((await local().get(`${origin}/hello`, { gzipFile: true })).body, 'héllo');
});

test('a gzip file is held to the size limit after it is unpacked, and a broken one fails', async () => {
  await assert.rejects(local({ maxBytes: 50_000 }).get(`${origin}/bomb.gz`, { gzipFile: true }), refusal('too-large'));
  await assert.rejects(local().get(`${origin}/broken.gz`, { gzipFile: true }), refusal('network'));
});

test('invalid or interrupted compressed responses fail without leaving a decoder running', async () => {
  await assert.rejects(local().get(`${origin}/broken-gzip`), refusal('network'));
  await assert.rejects(local().get(`${origin}/truncated-gzip`), refusal('network'));
});

test('a slow response times out', async () => {
  await assert.rejects(local({ timeoutMs: 150 }).get(`${origin}/slow`), refusal('timeout'));
});

test('requests to one host are spaced out', async () => {
  const f = local({ minIntervalMs: 120 });
  const t0 = Date.now();
  await Promise.all([f.get(`${origin}/hello`), f.get(`${origin}/hello`), f.get(`${origin}/hello`)]);
  assert.ok(Date.now() - t0 >= 230, `three requests took ${Date.now() - t0} ms`);
  assert.equal(f.stats.requests, 3);
});

test('send() is refused until writes are authorized, and nothing reaches the server', async () => {
  const f = local();
  const before = hits.length;
  await assert.rejects(f.send('POST', `${origin}/cart`, { json: { id: 1 } }), refusal('write-not-authorized'));
  assert.equal(hits.length, before);
  f.authorizeWrites(origin);
  const r = await f.send('POST', `${origin}/cart`, { json: { id: 1 } });
  assert.equal(r.status, 201);
  assert.deepEqual(JSON.parse(r.body), { id: 1 });
  assert.equal(r.headers['cart-token'], 'T1');
});

test('verifyOwnership() accepts the file, and only with the exact token', async () => {
  const store = new URL(origin);
  const noDns = async () => [];
  assert.deepEqual(await verifyOwnership(store, 'tok_0123456789abcdef', local(), noDns), { verified: true, method: 'file', detail: '/.well-known/regmark.txt carries the token' });
  assert.equal((await verifyOwnership(store, 'tok_0123456789abcdeX', local(), noDns)).verified, false);
  assert.equal((await verifyOwnership(store, 'tok_0123456789abcde', local(), noDns)).verified, false);
  assert.equal((await verifyOwnership(store, undefined, local(), noDns)).verified, false);
  assert.equal((await verifyOwnership(store, 'short', local(), noDns)).verified, false);
});

test('verifyOwnership() accepts a DNS record when there is no file', async () => {
  const store = new URL('https://shop.example');
  const noFile = { get: async () => ({ url: 'https://shop.example/.well-known/regmark.txt', status: 404, headers: {}, body: '', fetchedAt: '' }) };
  const dns = async (host: string) => (host === '_regmark.shop.example' ? [['regmark-verify=', 'tok_0123456789abcdef']] : []);
  assert.deepEqual(await verifyOwnership(store, 'tok_0123456789abcdef', noFile, dns), { verified: true, method: 'dns', detail: 'TXT _regmark.shop.example carries the token' });
  assert.equal((await verifyOwnership(store, 'tok_ffffffffffffffff', noFile, dns)).verified, false);
});

test('verifyOwnership() rejects a file served from somewhere the shop redirected to', async () => {
  const store = new URL('https://shop.example');
  const redirected = { get: async () => ({ url: 'https://cdn.example/regmark.txt', status: 200, headers: {}, body: 'regmark-verify=tok_0123456789abcdef', fetchedAt: '' }) };
  assert.equal((await verifyOwnership(store, 'tok_0123456789abcdef', redirected, async () => [])).verified, false);
});

// ── Owner reads and queries ─────────────────────────────────────────────

/**
 * A shop whose robots.txt shuts every crawler out. It records each request
 * with the User-Agent it came with, and answers /hop by redirecting to the
 * same path on localhost, which is the same server under another origin.
 */
async function closedShop() {
  const seen: string[] = [];
  const shop = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.headers.host?.split(':')[0]}${req.url} ${req.headers['user-agent']}`);
    const port = (shop.address() as AddressInfo).port;
    if (req.url === '/robots.txt') return void res.end('User-agent: *\nDisallow: /');
    if (req.url === '/hop') return void res.writeHead(302, { location: `http://localhost:${port}/landing` }).end();
    if (req.url === '/moved') return void res.writeHead(301, { location: '/landing' }).end();
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ asked: JSON.parse(body), type: req.headers['content-type'] })));
      return;
    }
    res.writeHead(200).end(String(req.headers['user-agent']));
  });
  await new Promise<void>((resolve) => shop.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(shop.address() as AddressInfo).port}`;
  const fetcher = (extra = {}) =>
    createFetcher({ hosts: ['127.0.0.1', 'localhost'], allowPrivateNetwork: true, minIntervalMs: 0, respectRobots: true, ...extra });
  return { base, seen, fetcher, close: () => new Promise<void>((resolve) => shop.close(() => resolve())) };
}

const AGENT_UA = 'Mozilla/5.0; compatible; ChatGPT-User/1.0';

test('a User-Agent header is refused unless the read is made as the owner, and nothing is sent', async () => {
  const before = hits.length;
  const f = local();
  f.authorizeWrites(origin);
  await assert.rejects(f.get(`${origin}/ua`, { headers: { 'user-agent': AGENT_UA } }), refusal('write-not-authorized'));
  // Header names are case-insensitive, and so is the check.
  await assert.rejects(f.get(`${origin}/ua`, { headers: { 'User-Agent': AGENT_UA } }), refusal('write-not-authorized'));
  await assert.rejects(f.query(`${origin}/ua`, {}, { headers: { 'user-agent': AGENT_UA } }), refusal('write-not-authorized'));
  assert.equal(hits.length, before);
  // Other caller headers need no ownership.
  assert.equal((await local().get(`${origin}/headers`, { headers: { accept: 'text/html' } })).status, 200);
});

test('an owner read is refused until ownership has been verified, and nothing is sent', async () => {
  const before = hits.length;
  const f = local();
  await assert.rejects(f.get(`${origin}/ua`, { asOwner: true }), refusal('write-not-authorized'));
  await assert.rejects(f.get(`${origin}/ua`, { asOwner: true, headers: { 'user-agent': AGENT_UA } }), refusal('write-not-authorized'));
  await assert.rejects(f.query(`${origin}/ua`, {}, { asOwner: true }), refusal('write-not-authorized'));
  assert.equal(hits.length, before);
  f.authorizeWrites(origin);
  assert.equal((await f.get(`${origin}/ua`, { asOwner: true, headers: { 'user-agent': AGENT_UA } })).body, AGENT_UA);
  // Without a User-Agent of its own, an owner read still says it is Regmark.
  assert.match((await f.get(`${origin}/ua`, { asOwner: true })).body, /^Regmark\//);
});

test('an owner read does not consult robots.txt, which speaks to crawlers', async () => {
  const shop = await closedShop();
  try {
    await assert.rejects(shop.fetcher().get(`${shop.base}/product`), refusal('robots'));
    shop.seen.length = 0;
    const owner = shop.fetcher();
    owner.authorizeWrites(shop.base);
    const r = await owner.get(`${shop.base}/product`, { asOwner: true, headers: { 'user-agent': AGENT_UA } });
    assert.equal(r.status, 200);
    assert.equal(r.body, AGENT_UA);
    // A redirect within the shop keeps the owner's standing and the caller's User-Agent.
    const moved = await owner.get(`${shop.base}/moved`, { asOwner: true, headers: { 'user-agent': AGENT_UA } });
    assert.equal(new URL(moved.url).pathname, '/landing');
    assert.equal(moved.body, AGENT_UA);
    assert.deepEqual(shop.seen, [`GET 127.0.0.1/product ${AGENT_UA}`, `GET 127.0.0.1/moved ${AGENT_UA}`, `GET 127.0.0.1/landing ${AGENT_UA}`]);
  } finally {
    await shop.close();
  }
});

test('an owner read does not follow a redirect to another origin', async () => {
  const shop = await closedShop();
  try {
    const f = shop.fetcher({ respectRobots: false });
    f.authorizeWrites(shop.base);
    // Whatever answers at localhost was never asked as the owner, so the
    // redirect comes back to the caller instead of a page fetched as Regmark.
    const r = await f.get(`${shop.base}/hop`, { asOwner: true, headers: { 'user-agent': AGENT_UA } });
    assert.equal(r.status, 302);
    assert.equal(new URL(r.url).hostname, '127.0.0.1');
    assert.deepEqual(shop.seen, [`GET 127.0.0.1/hop ${AGENT_UA}`]);
    // An ordinary read still follows it, as Regmark.
    const plain = await f.get(`${shop.base}/hop`);
    assert.equal(new URL(plain.url).hostname, 'localhost');
    assert.equal(plain.body, DEFAULT_POLICY.userAgent);
  } finally {
    await shop.close();
  }
});

test('ownership shown for one host gives no standing on another host of the run', async () => {
  const shop = await closedShop();
  try {
    const f = shop.fetcher({ respectRobots: false });
    f.authorizeWrites(shop.base);
    const other = shop.base.replace('127.0.0.1', 'localhost');
    shop.seen.length = 0;
    await assert.rejects(f.get(`${other}/product`, { asOwner: true, headers: { 'user-agent': AGENT_UA } }), refusal('write-not-authorized'));
    await assert.rejects(f.query(`${other}/mcp`, {}, { asOwner: true }), refusal('write-not-authorized'));
    await assert.rejects(f.send('POST', `${other}/cart`, { json: {} }), refusal('write-not-authorized'));
    assert.deepEqual(shop.seen, [], 'nothing reached the other host');
    // The verified host itself is unaffected.
    assert.equal((await f.get(`${shop.base}/product`, { asOwner: true, headers: { 'user-agent': AGENT_UA } })).body, AGENT_UA);
  } finally {
    await shop.close();
  }
});

test('query() posts JSON, is checked against robots.txt like a read, and needs no ownership', async () => {
  const shop = await closedShop();
  try {
    await assert.rejects(shop.fetcher().query(`${shop.base}/mcp`, { method: 'tools/list' }), refusal('robots'));
    assert.ok(!shop.seen.some((s) => s.startsWith('POST')), 'a refused query sends nothing');
    const r = await shop.fetcher({ respectRobots: false }).query(`${shop.base}/mcp`, { method: 'tools/list' });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { asked: { method: 'tools/list' }, type: 'application/json' });
    // As the owner, it skips robots.txt the way an owner read does.
    const owner = shop.fetcher();
    owner.authorizeWrites(shop.base);
    assert.equal((await owner.query(`${shop.base}/mcp`, { method: 'tools/list' }, { asOwner: true })).status, 200);
  } finally {
    await shop.close();
  }
});

test('query() does not follow a redirect: replaying a body elsewhere is not done silently', async () => {
  const shop = await closedShop();
  try {
    const r = await shop.fetcher({ respectRobots: false }).query(`${shop.base}/moved`, { q: 'mug' });
    assert.equal(r.status, 301);
    assert.equal(r.headers['location'], '/landing');
    assert.deepEqual(shop.seen.filter((s) => s.includes('/landing')), []);
  } finally {
    await shop.close();
  }
});

test('query() is paced with every other request to the host', async () => {
  const f = local({ minIntervalMs: 120 });
  const t0 = Date.now();
  await Promise.all([f.get(`${origin}/hello`), f.query(`${origin}/cart`, { id: 1 }), f.query(`${origin}/cart`, { id: 2 })]);
  assert.ok(Date.now() - t0 >= 230, `three requests took ${Date.now() - t0} ms`);
  assert.equal(f.stats.requests, 3);
});

test('several Set-Cookie headers are kept one per line, because cookie dates contain commas', async () => {
  const shop = http.createServer((_req, res) => {
    res.setHeader('set-cookie', ['a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'b=2; Path=/']);
    res.end('ok');
  });
  await new Promise<void>((resolve) => shop.listen(0, '127.0.0.1', resolve));
  try {
    const r = await local().get(`http://127.0.0.1:${(shop.address() as AddressInfo).port}/`);
    assert.equal(r.headers['set-cookie'], 'a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT\nb=2; Path=/');
  } finally {
    shop.close();
  }
});

test('query() takes an event stream as complete once the caller finds its answer in it, though the server keeps it open', async () => {
  const seen: string[] = [];
  const started = Date.now();
  const r = await local({ timeoutMs: 5_000 }).query(`${origin}/open-stream`, {}, {
    complete: (body) => {
      seen.push(body);
      return body.includes('"id":1');
    },
  });
  assert.ok(Date.now() - started < 2_000, 'it does not wait for the stream to close');
  assert.equal(r.status, 200);
  assert.match(r.body, /data: \{"jsonrpc":"2.0","id":1,"result":\{\}\}/);
  assert.equal(seen[0], ': ping\n\n', 'the stream is offered as it arrives');
});

test('query() without a completion test waits for an open stream until the time limit', async () => {
  await assert.rejects(local({ timeoutMs: 300 }).query(`${origin}/open-stream`, {}), refusal('timeout'));
});

test('a completion test is not consulted for a response that is not an event stream', async () => {
  let asked = false;
  const r = await local().get(`${origin}/hello`, {
    complete: () => {
      asked = true;
      return true;
    },
  });
  assert.equal(asked, false);
  assert.equal(r.body, 'héllo');
});
