import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startShop } from '../../../fixtures/shop/src/index.ts';
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
