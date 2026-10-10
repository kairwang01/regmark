import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OWNERSHIP_TOKEN, startShop } from '../../../fixtures/shop/src/index.ts';
import type { AuditResult } from '@regmark/core';
import { runAudit } from '../src/audit.ts';
import type { AuditConfig } from '../src/audit.ts';

test('WooCommerce sampling reuses one catalogue listing and reads only selected variations', async () => {
  const shop = await startShop({ mode: 'clean' });
  try {
    const result = await runAudit({
      store: shop.origin,
      platform: 'woocommerce',
      sample: 1,
      fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
    });
    assert.equal(result.counts.products, 1);
    assert.deepEqual(result.issues, []);
    assert.equal(shop.requests.filter((r) => r.includes('/products?per_page=100&page=1')).length, 1);
    assert.equal(shop.requests.filter((r) => r.startsWith('POST') || r.startsWith('DELETE')).length, 0);
  } finally {
    await shop.close();
  }
});

test('maxAge reaches availability.stale as a limit per surface, and without it the rule is skipped', async () => {
  const now = new Date('2026-10-09T12:00:00.000Z');
  const shop = await startShop({ mode: 'misprint', now });
  try {
    const audit = (maxAge?: AuditConfig['maxAge']) =>
      runAudit(
        { store: shop.origin, platform: 'woocommerce', feed: '/feeds/google.xml', ...(maxAge ? { maxAge } : {}), sample: 50, fetch: { allowPrivateNetwork: true, minIntervalMs: 0 } },
        { now: () => now },
      );
    const stale = (result: AuditResult) => result.findings.filter((f) => f.rule === 'availability.stale');
    const summary = (result: AuditResult) => result.rules.find((r) => r.id === 'availability.stale')!;

    // The misprinted feed was generated nine days before the shop's clock.
    const day = await audit({ feed: '24h' });
    assert.deepEqual(stale(day).map((f) => [f.product.split('/').pop(), f.surface]), [['canvas-tote', 'feed']]);
    assert.match(stale(day)[0]!.message, /maxAge of 24 hours/);

    const tenDays = await audit({ feed: '10d' });
    assert.deepEqual(stale(tenDays), []);
    assert.equal(summary(tenDays).skipped, undefined);

    const none = await audit();
    assert.equal(summary(none).skipped, 'needs maxAge, such as --max-age feed=24h');
  } finally {
    await shop.close();
  }
});

test('the cloaking check reads, as each configured profile, only the pages the ordinary read could use', async () => {
  const shop = await startShop({ mode: 'misprint' });
  try {
    const page = (slug: string) => `${shop.origin}/product/${slug}/`;
    const result = await runAudit({
      store: shop.origin,
      pages: [page('field-cap'), page('discontinued-scarf')],
      cloaking: { userAgents: { searchbot: 'Mozilla/5.0 (compatible; PerplexityBot/1.0)' } },
      ownershipToken: OWNERSHIP_TOKEN,
      fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
    });
    const posed = shop.requests.filter((_, i) => shop.userAgents[i]!.includes('PerplexityBot'));
    // The scarf's page is gone, so there is nothing to compare it with and it is not read again.
    assert.deepEqual(posed, ['GET /product/field-cap/']);
    assert.deepEqual(result.issues.map((i) => `${i.surface} ${i.code}`), ['page not-found']);
    // With no browser profile, the view is held to Regmark's own read of the page.
    const cloaked = result.findings.filter((f) => f.rule === 'content.cloaking');
    assert.deepEqual(cloaked.map((f) => [f.surface, f.message]), [['jsonld', 'a client identifying as searchbot was told 19.00 USD in jsonld; Regmark itself 22.00 USD']]);
  } finally {
    await shop.close();
  }
});

test('the protocol collectors ask about the sampled product only, by the storefront API’s variant ids', async () => {
  const shop = await startShop({ mode: 'misprint' });
  try {
    const result = await runAudit({
      store: shop.origin,
      platform: 'woocommerce',
      sample: 1,
      seed: 4,
      ucp: { agentProfile: 'https://agent.example/profile.json' },
      mcp: { url: '/api/mcp' },
      fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
    });
    assert.equal(result.counts.products, 1);
    assert.equal(result.counts.variants, 3, 'the UCP and MCP statements joined the three sock variants, adding none');
    assert.deepEqual(result.issues, []);
    // One lookup on each endpoint holds every variant of the one sampled product.
    assert.deepEqual(shop.requests.filter((r) => r.includes('/ucp')), ['GET /.well-known/ucp', 'POST /ucp/v1/catalog/lookup']);
    assert.deepEqual(shop.rpcCalls(), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call lookup_catalog']);
    // D32: the UCP catalogue's stale sock price, tied to its variant by the backend id.
    const agentFindings = result.findings.filter((f) => f.surface === 'ucp' || f.surface === 'mcp');
    assert.deepEqual(agentFindings.map((f) => [f.rule, f.variant, f.surface]), [['price.mismatch', 'SOCK-M', 'ucp']]);
  } finally {
    await shop.close();
  }
});

/** A shop of fixed responses on a local port, for cases the fixture shop does not cover. */
async function tinyShop(routes: Record<string, { type: string; body: string; status?: number; location?: string }>): Promise<{ origin: string; requests: string[]; close: () => Promise<void> }> {
  const { createServer } = await import('node:http');
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const route = routes[req.url ?? ''];
    if (!route) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    res.writeHead(route.status ?? 200, { 'content-type': route.type, ...(route.location ? { location: route.location } : {}) }).end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

const productPage = (name: string, sku: string) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, sku, offers: { '@type': 'Offer', price: '20.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>${name}</h1></body></html>`;

const sitemap = (paths: string[], index = false) => {
  const root = index ? 'sitemapindex' : 'urlset';
  const item = index ? 'sitemap' : 'url';
  return { type: 'application/xml', body: `<${root}>${paths.map((url) => `<${item}><loc>${url}</loc></${item}>`).join('')}</${root}>` };
};

for (const failed of [0, 1, 2]) {
  test(`a failed sitemap child at position ${failed + 1} keeps successful siblings and reads later children`, async () => {
    const children = [0, 1, 2].map((n) => `/sitemap-products-${n}.xml`);
    const working = [0, 1, 2].filter((n) => n !== failed);
    const shop = await tinyShop({
      '/sitemap.xml': sitemap(children, true),
      ...Object.fromEntries(working.flatMap((n) => [
        [children[n]!, sitemap([`/products/item-${n}`])],
        [`/products/item-${n}`, { type: 'text/html', body: productPage(`Item ${n}`, `ITEM-${n}`) }],
      ])),
    });
    try {
      for (const strict of [false, true]) {
        shop.requests.length = 0;
        const result = await runAudit({ store: shop.origin, strict, fetch: { allowPrivateNetwork: true, minIntervalMs: 0, respectRobots: false } });
        assert.equal(result.counts.products, 2);
        assert.equal(result.ok, !strict);
        assert.deepEqual(result.issues, [{ surface: 'page', code: 'fetch-failed', message: 'sitemap: HTTP 404', locator: `${shop.origin}${children[failed]}` }]);
        assert.deepEqual(shop.requests, ['GET /sitemap.xml', ...children.map((child) => `GET ${child}`), ...working.map((n) => `GET /products/item-${n}`)]);
      }
    } finally {
      await shop.close();
    }
  });
}

test('sitemap children report each failure, including robots refusals, without losing a later product', async () => {
  const shop = await tinyShop({
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /sitemap-products-blocked.xml\n' },
    '/sitemap.xml': sitemap(['/sitemap-products-missing.xml', '/sitemap-products-blocked.xml', '/sitemap-products-working.xml'], true),
    '/sitemap-products-working.xml': sitemap(['/products/mug']),
    '/products/mug': { type: 'text/html', body: productPage('Mug', 'MUG-1') },
  });
  try {
    const result = await runAudit({ store: shop.origin, fetch: { allowPrivateNetwork: true, minIntervalMs: 0 } });
    assert.equal(result.counts.products, 1);
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, [
      { surface: 'page', code: 'fetch-failed', message: 'sitemap: HTTP 404', locator: `${shop.origin}/sitemap-products-missing.xml` },
      { surface: 'page', code: 'robots-disallowed', message: `sitemap: robots: ${shop.origin}/sitemap-products-blocked.xml`, locator: `${shop.origin}/sitemap-products-blocked.xml` },
    ]);
    assert.ok(!shop.requests.includes('GET /sitemap-products-blocked.xml'));
    assert.ok(shop.requests.includes('GET /products/mug'));
  } finally {
    await shop.close();
  }
});

test('a failed top-level sitemap still reports its own URL', async () => {
  const shop = await tinyShop({});
  try {
    const result = await runAudit({ store: shop.origin, fetch: { allowPrivateNetwork: true, minIntervalMs: 0, respectRobots: false } });
    assert.equal(result.counts.products, 0);
    assert.equal(result.ok, false);
    assert.deepEqual(result.issues, [{ surface: 'page', code: 'fetch-failed', message: 'sitemap: HTTP 404', locator: `${shop.origin}/sitemap.xml` }]);
  } finally {
    await shop.close();
  }
});

test('strict CLI exits 2 for a failed sitemap child while its report retains successful products', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'regmark-sitemap-'));
  const shop = await tinyShop({
    '/sitemap.xml': sitemap(['/sitemap-products-working.xml', '/sitemap-products-missing.xml'], true),
    '/sitemap-products-working.xml': sitemap(['/products/mug']),
    '/products/mug': { type: 'text/html', body: productPage('Mug', 'MUG-1') },
  });
  try {
    const report = path.join(dir, 'audit.json');
    const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
    const { code, stderr } = await new Promise<{ code: number | string; stderr: string }>((resolve) => {
      execFile(process.execPath, [bin, 'audit', shop.origin, '--platform', 'none', '--strict', '--allow-private-network', '--interval', '0', '--json', report, '--quiet'], { cwd: dir, timeout: 30_000 }, (error, _stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stderr });
      });
    });
    assert.equal(code, 2);
    assert.match(stderr, /strict audit incomplete: 1 collection issue/);
    const result = JSON.parse(await readFile(report, 'utf8')) as AuditResult;
    assert.equal(result.counts.products, 1);
    assert.equal(result.ok, false);
    assert.deepEqual(result.issues, [{ surface: 'page', code: 'fetch-failed', message: 'sitemap: HTTP 404', locator: `${shop.origin}/sitemap-products-missing.xml` }]);
  } finally {
    await shop.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a sitemap that lists paths, not URLs, is read against its own URL, with the agent endpoints on too', async () => {
  const shop = await tinyShop({
    '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>/products/blue-shirt</loc></url></urlset>' },
    '/products/blue-shirt': { type: 'text/html', body: productPage('Blue shirt', 'SHIRT-B') },
  });
  try {
    const result = await runAudit({ store: shop.origin, ucp: true, mcp: true, fetch: { allowPrivateNetwork: true, minIntervalMs: 0, respectRobots: false } });
    assert.equal(result.counts.products, 1);
    assert.ok(shop.requests.includes('GET /products/blue-shirt'));
    assert.deepEqual(result.issues.filter((i) => i.surface === 'page'), []);
    assert.deepEqual(result.issues.map((i) => `${i.surface} ${i.code}`).sort(), ['mcp not-found', 'ucp not-found']);
  } finally {
    await shop.close();
  }
});

test('a sitemap entry that is no URL at all is reported by the page reader, and the agent endpoints still run', async () => {
  const shop = await tinyShop({ '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>http://[oops</loc></url></urlset>' } });
  try {
    const result = await runAudit({ store: shop.origin, ucp: true, fetch: { allowPrivateNetwork: true, minIntervalMs: 0, respectRobots: false } });
    assert.deepEqual(result.issues.map((i) => `${i.surface} ${i.code} ${i.message}`), ['page fetch-failed bad-url: http://[oops', 'ucp not-found business profile: HTTP 404; the shop publishes no UCP profile here']);
  } finally {
    await shop.close();
  }
});

test('ACP rows held back from buyers are not fetched as strays, so the rows on offer get the stray budget', async () => {
  const row = (id: string, path: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ item_id: id, url: path, title: id, description: 'd', brand: 'b', seller_name: 's', image_url: '/i.jpg', price: '20.00 USD', availability: 'in_stock', ...extra });
  const shop = await tinyShop({
    '/products.json?limit=250&page=1': {
      type: 'application/json',
      body: JSON.stringify({ products: [{ id: 1, handle: 'mug', title: 'Mug', variants: [{ id: 11, sku: 'MUG-1', price: '20.00', available: true }] }] }),
    },
    '/acp.jsonl': {
      type: 'application/jsonl',
      body: [row('MUG-1', '/products/mug'), row('OLD-1', '/products/old1', { is_eligible_search: false }), row('OLD-2', '/products/old2', { is_eligible_search: false }), row('GHOST-1', '/products/ghost')].join('\n'),
    },
    '/products/mug': { type: 'text/html', body: productPage('Mug', 'MUG-1') },
  });
  try {
    const result = await runAudit({ store: shop.origin, platform: 'shopify', acpFeed: '/acp.jsonl', sample: 1, fetch: { allowPrivateNetwork: true, minIntervalMs: 0, respectRobots: false } });
    assert.ok(shop.requests.includes('GET /products/ghost'));
    assert.ok(!shop.requests.some((r) => r.startsWith('GET /products/old')));
    const unmatched = result.findings.filter((f) => f.rule === 'identity.unmatched');
    assert.deepEqual(unmatched.map((f) => f.product.split('/').pop()), ['ghost']);
  } finally {
    await shop.close();
  }
});


for (const index of [false, true]) {
  test(`redirected sitemap ${index ? 'index and child' : 'document'} resolves relative locs against the response URL`, async () => {
    const redirect = (location: string) => ({ type: 'text/plain', body: '', status: 302, location });
    const shop = await tinyShop({
      '/sitemap.xml': redirect('/catalog/sitemap.xml'),
      '/catalog/sitemap.xml': sitemap(index ? ['sitemap-products.xml'] : ['products/mug'], index),
      ...(index ? {
        '/catalog/sitemap-products.xml': redirect('/catalog/final/sitemap.xml'),
        '/catalog/final/sitemap.xml': sitemap(['../products/mug']),
      } : {}),
      '/catalog/products/mug': { type: 'text/html', body: productPage('Mug', 'MUG-1') },
    });
    try {
      const result = await runAudit({ store: shop.origin, strict: true, fetch: { allowPrivateNetwork: true, minIntervalMs: 0, respectRobots: false } });
      assert.equal(result.counts.products, 1);
      assert.equal(result.ok, true);
      assert.deepEqual(result.issues, []);
      assert.ok(shop.requests.includes('GET /catalog/products/mug'));
      assert.ok(!shop.requests.includes('GET /products/mug'));
      if (index) assert.ok(shop.requests.includes('GET /catalog/final/sitemap.xml'));
    } finally {
      await shop.close();
    }
  });
}
