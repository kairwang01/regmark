import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startShop } from '../../../fixtures/shop/src/index.ts';
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
