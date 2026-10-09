import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OWNERSHIP_TOKEN, startShop } from '../../../fixtures/shop/src/index.ts';
import { runAudit } from '../src/audit.ts';

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
