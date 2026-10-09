import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { startShop } from '../src/server.ts';
import type { RunningShop } from '../src/server.ts';
import { OWNERSHIP_TOKEN } from '../src/catalog.ts';

const NOW = new Date('2026-10-09T00:00:00Z');
const BASE = '/wp-json/wc/store/v1';

const running: RunningShop[] = [];

async function start(mode: 'clean' | 'misprint'): Promise<RunningShop> {
  const shop = await startShop({ mode, now: NOW });
  running.push(shop);
  return shop;
}

after(async () => {
  await Promise.all(running.map((r) => r.close()));
});

describe('fixture server', () => {
  it('serves the ownership token as plain text', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}/.well-known/regmark.txt`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await res.text(), `regmark-verify=${OWNERSHIP_TOKEN}\n`);
  });

  it('publishes no expected findings for the clean shop', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}/__regmark/expected.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    const body = (await res.json()) as { mode: string; defects: unknown[]; expected: unknown[] };
    assert.equal(body.mode, 'clean');
    assert.deepEqual(body.expected, []);
    assert.deepEqual(body.defects, []);
  });

  it('publishes the seeded findings for the misprint shop', async () => {
    const r = await start('misprint');
    const body = (await (await fetch(`${r.origin}/__regmark/expected.json`)).json()) as {
      mode: string;
      defects: unknown[];
      expected: unknown[];
    };
    assert.equal(body.mode, 'misprint');
    assert.equal(body.expected.length, 25);
    assert.equal(body.defects.length, 22);
  });

  it('serves the ACP feed as JSON Lines, and as the gzip file OpenAI asks for', async () => {
    const r = await start('clean');
    const plain = await fetch(`${r.origin}/feeds/acp.jsonl`);
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('content-type'), 'application/jsonl; charset=utf-8');
    const text = await plain.text();
    assert.equal(text.trim().split('\n').length, 19);
    const gz = await fetch(`${r.origin}/feeds/acp.jsonl.gz`);
    assert.equal(gz.status, 200);
    assert.equal(gz.headers.get('content-type'), 'application/gzip');
    // A file, not a transfer encoding: the bytes arrive still compressed.
    assert.equal(gz.headers.get('content-encoding'), null);
    assert.equal(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString('utf8'), text);
  });

  it('lists products over HTTP with the total header', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}${BASE}/products`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-wp-total'), '10');
    const list = (await res.json()) as unknown[];
    assert.equal(list.length, 10);
  });

  it('runs a whole cart conversation over HTTP', async () => {
    const r = await start('clean');
    const first = await fetch(`${r.origin}${BASE}/cart`);
    const token = first.headers.get('cart-token');
    assert.ok(token);
    await first.text();
    const json = { 'cart-token': token, 'content-type': 'application/json' };

    const add = await fetch(`${r.origin}${BASE}/cart/add-item`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ id: 102, quantity: 1 }),
    });
    assert.equal(add.status, 201);
    await add.text();

    const update = await fetch(`${r.origin}${BASE}/cart/update-customer`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ shipping_address: { country: 'US', postcode: '94103', state: 'CA', city: 'San Francisco' } }),
    });
    assert.equal(update.status, 200);
    const cart = (await update.json()) as { totals: { total_price: string } };
    assert.equal(cart.totals.total_price, '4520');

    const cleared = await fetch(`${r.origin}${BASE}/cart/items`, { method: 'DELETE', headers: { 'cart-token': token } });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await cleared.json(), []);

    const snapshot = r.carts().find((c) => c.token === token);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.items, []);
  });

  it('answers 400 rest_invalid_json for a broken body', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}${BASE}/cart/add-item`, {
      method: 'POST',
      headers: { 'cart-token': 'x', 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'rest_invalid_json');
  });

  it('answers 413 for a body over 64 KiB', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}${BASE}/cart/add-item`, {
      method: 'POST',
      headers: { 'cart-token': 'x', 'content-type': 'application/json' },
      body: 'x'.repeat(64 * 1024 + 1),
    });
    assert.equal(res.status, 413);
    await res.text();
  });

  it('answers 404 for an unknown path', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}/no/such/page`);
    assert.equal(res.status, 404);
    await res.text();
  });

  it('redirects a slashless product path with a 301', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}/product/enamel-mug`, { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/product/enamel-mug/');
    await res.text();
  });

  it('keeps the query string on that redirect', async () => {
    const r = await start('clean');
    const res = await fetch(`${r.origin}/product/enamel-mug?utm=1`, { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/product/enamel-mug/?utm=1');
    await res.text();
  });

  it('logs every request in order', async () => {
    const r = await start('clean');
    await (await fetch(`${r.origin}/.well-known/regmark.txt`)).text();
    await (await fetch(`${r.origin}${BASE}/products?per_page=2`)).text();
    await (await fetch(`${r.origin}/no/such/page`)).text();
    assert.deepEqual(r.requests, [
      'GET /.well-known/regmark.txt',
      `GET ${BASE}/products?per_page=2`,
      'GET /no/such/page',
    ]);
  });

  it('reports the origin from the bound loopback address', async () => {
    const r = await start('clean');
    assert.match(r.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${r.origin}/.well-known/regmark.txt`);
    assert.equal(res.status, 200);
    await res.text();
  });

  it('survives a renderer that throws and keeps serving', async () => {
    // /sitemap.xml is a stub that throws until the page renderers are finished.
    const r = await start('clean');
    const broken = await fetch(`${r.origin}/sitemap.xml`);
    assert.ok(broken.status === 200 || broken.status === 500, `unexpected status ${broken.status}`);
    await broken.text();
    const next = await fetch(`${r.origin}/.well-known/regmark.txt`);
    assert.equal(next.status, 200);
    await next.text();
  });
});
