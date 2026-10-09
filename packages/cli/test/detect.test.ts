import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectPlatform } from '../src/detect.ts';
import type { CollectContext, Fetched, Fetcher } from '../../core/src/types.ts';

const WOO = 'https://shop.example/wp-json/wc/store/v1/products?per_page=1';
const SHOPIFY = 'https://shop.example/products.json?limit=1';

type Reply = { status: number; body?: string; headers?: Record<string, string> } | 'throw';

/** A fetcher that answers from a table keyed by URL, and records every URL asked for. */
function fakeFetcher(replies: Record<string, Reply>) {
  const requested: string[] = [];
  const fetcher: Fetcher = {
    async get(url: string): Promise<Fetched> {
      requested.push(url);
      const reply = replies[url] ?? { status: 404 };
      if (reply === 'throw') throw new Error('connection refused');
      return {
        url,
        status: reply.status,
        headers: reply.headers ?? {},
        body: reply.body ?? '',
        fetchedAt: '2026-10-09T12:00:00.000Z',
      };
    },
    async send() {
      throw new Error('detection never writes');
    },
    async query() {
      throw new Error('detection never posts a query');
    },
  };
  return { fetcher, requested };
}

function context(fetcher: Fetcher): CollectContext {
  return { store: new URL('https://shop.example'), fetcher, now: () => new Date(), log: () => {} };
}

const json = (value: unknown) => JSON.stringify(value);

test('a WooCommerce Store API with products is recognised, and Shopify is never asked', async () => {
  const body = json([{ id: 1, name: 'Tee', prices: { price: '2500', currency_code: 'USD' } }]);
  const { fetcher, requested } = fakeFetcher({ [WOO]: { status: 200, body } });
  assert.equal(await detectPlatform(context(fetcher)), 'woocommerce');
  assert.deepEqual(requested, [WOO]);
  assert.ok(!requested.includes(SHOPIFY));
});

test('an empty WooCommerce catalogue is still WooCommerce, by its total header', async () => {
  const { fetcher } = fakeFetcher({ [WOO]: { status: 200, body: '[]', headers: { 'x-wp-total': '0' } } });
  assert.equal(await detectPlatform(context(fetcher)), 'woocommerce');
});

test('a JSON array with neither a total header nor prices is not WooCommerce', async () => {
  const body = json([{ id: 7, name: 'Some other API record' }]);
  const { fetcher, requested } = fakeFetcher({ [WOO]: { status: 200, body }, [SHOPIFY]: { status: 404 } });
  assert.equal(await detectPlatform(context(fetcher)), null);
  assert.deepEqual(requested, [WOO, SHOPIFY], 'detection falls through to the next platform');
});

test('a Shopify shop is recognised when the Woo URL is not there', async () => {
  const { fetcher, requested } = fakeFetcher({
    [WOO]: { status: 404 },
    [SHOPIFY]: { status: 200, body: json({ products: [] }) },
  });
  assert.equal(await detectPlatform(context(fetcher)), 'shopify');
  assert.deepEqual(requested, [WOO, SHOPIFY]);
});

test('a shop with neither endpoint is not recognised', async () => {
  const { fetcher } = fakeFetcher({ [WOO]: { status: 404 }, [SHOPIFY]: { status: 404 } });
  assert.equal(await detectPlatform(context(fetcher)), null);
});

test('a fetcher that throws on both URLs yields null and no exception escapes', async () => {
  const { fetcher, requested } = fakeFetcher({ [WOO]: 'throw', [SHOPIFY]: 'throw' });
  assert.equal(await detectPlatform(context(fetcher)), null);
  assert.deepEqual(requested, [WOO, SHOPIFY]);
});

test('an HTML page answering 200 is not a platform', async () => {
  const html = '<!doctype html><html><body>Welcome</body></html>';
  const { fetcher } = fakeFetcher({ [WOO]: { status: 200, body: html }, [SHOPIFY]: { status: 200, body: html } });
  assert.equal(await detectPlatform(context(fetcher)), null);
});
