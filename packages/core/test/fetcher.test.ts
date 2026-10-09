import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import zlib from 'node:zlib';
import { createFetcher, FetchRefused, verifyOwnership } from '../src/index.ts';

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
    if (url === '/slow') return void setTimeout(() => res.writeHead(200).end('late'), 600);
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

after(() => server.close());

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
  assert.match((await local().get(`${origin}/ua`)).body, /^Regmark\/\d+\.\d+\.\d+ \(\+https:\/\//);
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
  f.authorizeWrites();
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
