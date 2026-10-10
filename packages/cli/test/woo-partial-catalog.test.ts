import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import identity from '../../rules/src/parity/identity-unmatched.ts';
import priceMismatch from '../../rules/src/parity/price-mismatch.ts';
import { runAudit } from '../src/audit.ts';

const API = '/wp-json/wc/store/v1';
type Failure = 'http' | 'non-json' | 'robots';

/** Two products: the mug has unreadable variation B; the cup is complete. */
async function partialShop(failure: Failure, options: { mismatch?: boolean; onlyUnreadable?: boolean } = {}) {
  let origin = '';
  const requests: string[] = [];
  const prices = { price: '1000', currency_code: 'USD', currency_minor_unit: 2 };
  const server = createServer((req, res) => {
    const path = req.url ?? '';
    requests.push(path);
    const reply = (status: number, type: string, body: string) => res.writeHead(status, { 'content-type': type }).end(body);
    const json = (body: unknown) => reply(200, 'application/json', JSON.stringify(body));
    if (path === '/robots.txt') {
      return void reply(200, 'text/plain', `User-agent: *\n${failure === 'robots' ? `Disallow: ${API}/products/12\n` : 'Allow: /\n'}`);
    }
    if (path === `${API}/products?per_page=100&page=1`) {
      return void json([
        { id: 1, type: 'variable', permalink: `${origin}/products/mug`, variations: [{ id: 11 }, { id: 12 }] },
        ...(options.onlyUnreadable ? [] : [{ id: 2, type: 'simple', permalink: `${origin}/products/cup`, sku: 'C', prices, is_in_stock: true }]),
      ]);
    }
    if (path === `${API}/products/11` && !options.onlyUnreadable) return void json({ id: 11, sku: 'A', prices, is_in_stock: true });
    if (path === `${API}/products/12` || (options.onlyUnreadable && path === `${API}/products/11`)) {
      return void reply(failure === 'non-json' ? 200 : 503, 'text/html', '<html>temporarily unavailable</html>');
    }
    if (path === '/feed.tsv') {
      return void reply(200, 'text/tab-separated-values', [
        'id\ttitle\tlink\tprice',
        `A\tMug A\t${origin}/products/mug\t${options.mismatch ? '17.00' : '10.00'} USD`,
        `B\tMug B\t${origin}/products/mug\t10.00 USD`,
        `C\tCup\t${origin}/products/cup\t10.00 USD`,
        `D\tStale Cup\t${origin}/products/cup\t10.00 USD`,
      ].join('\n'));
    }
    if (!options.onlyUnreadable && path.startsWith('/products/')) return void reply(200, 'text/html', '<html><body><h1>Product</h1></body></html>');
    reply(404, 'text/plain', 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  origin = `http://127.0.0.1:${port}`;
  return { origin, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

for (const failure of ['http', 'non-json', 'robots'] as const) {
  test(`Woo ${failure} variation failure leaves identity findings on complete products and preserves strict failure`, async () => {
    const shop = await partialShop(failure);
    try {
      for (const strict of [false, true]) {
        const result = await runAudit({
          store: shop.origin, platform: 'woocommerce', feed: '/feed.tsv', strict,
          fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
        }, { rules: [identity] });
        // Feed ids are aliases rather than SKUs; the stale row has a fallback key.
        assert.deepEqual(result.findings.map((f) => [f.variant, f.surface]), [['variant-2', 'feed']]);
        assert.ok(result.findings[0]!.product.endsWith('/products/cup'));
        assert.deepEqual(result.counts, { products: 2, variants: 4 });
        assert.equal(result.ok, !strict);
        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0]!.surface, 'platform');
        assert.equal(result.issues[0]!.locator, `${shop.origin}${API}/products/12`);
        assert.equal(result.issues[0]!.code, failure === 'http' ? 'fetch-failed' : failure === 'non-json' ? 'parse-error' : 'robots-disallowed');
      }
      if (failure === 'robots') assert.ok(!shop.requests.includes(`${API}/products/12`));
    } finally {
      await shop.close();
    }
  });
}

test('a readable Woo sibling still exposes price mismatches when another variation failed', async () => {
  const shop = await partialShop('http', { mismatch: true });
  try {
    const result = await runAudit({
      store: shop.origin, platform: 'woocommerce', feed: '/feed.tsv',
      fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
    }, { rules: [identity, priceMismatch] });
    assert.deepEqual(result.findings.map((f) => [f.rule, f.variant]), [['price.mismatch', 'A'], ['identity.unmatched', 'variant-2']]);
    assert.equal(result.findings[0]!.expected!.value, '10.00 USD');
    assert.equal(result.findings[0]!.actual!.value, '17.00 USD');
    assert.equal(result.ok, false);
  } finally {
    await shop.close();
  }
});

test('Woo coverage metadata alone cannot make an otherwise empty non-strict audit pass', async () => {
  const shop = await partialShop('http', { onlyUnreadable: true });
  try {
    for (const strict of [false, true]) {
      const result = await runAudit({
        store: shop.origin, platform: 'woocommerce', strict,
        fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
      }, { rules: [identity] });
      assert.deepEqual(result.counts, { products: 0, variants: 0 });
      assert.deepEqual(result.surfaces, []);
      assert.deepEqual(result.findings, []);
      assert.equal(result.ok, false);
      assert.deepEqual(result.issues.map((i) => [i.surface, i.code]), [
        ['platform', 'fetch-failed'], ['platform', 'fetch-failed'], ['page', 'not-found'],
      ]);
    }
  } finally {
    await shop.close();
  }
});
