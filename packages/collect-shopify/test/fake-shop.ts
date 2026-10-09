// An in-memory shop for the catalogue tests. Answers are keyed by exact URL,
// and every request is recorded so that tests can assert on what was asked.

import type { CollectContext, Fetched, Fetcher, RequestOptions } from '@regmark/core';

export const ORIGIN = 'https://shop.example';
export const FETCHED_AT = '2026-10-09T12:00:00.000Z';

export type Answer = { status?: number; body?: string; throws?: Error };

export type FakeShop = { ctx: CollectContext; calls: string[]; logs: string[] };

/** Unknown URLs answer 404, so a test that pages too far fails loudly. */
export function fakeShop(answers: Record<string, Answer>): FakeShop {
  const calls: string[] = [];
  const logs: string[] = [];
  const fetcher: Fetcher = {
    async get(url: string, _options?: RequestOptions): Promise<Fetched> {
      calls.push(url);
      const answer = Object.hasOwn(answers, url) ? answers[url]! : { status: 404, body: '' };
      if (answer.throws) throw answer.throws;
      return { url, status: answer.status ?? 200, headers: { 'content-type': 'application/json' }, body: answer.body ?? '', fetchedAt: FETCHED_AT };
    },
    async send(): Promise<Fetched> {
      throw new Error('the Shopify collector must never write');
    },
  };
  const ctx: CollectContext = {
    store: new URL(ORIGIN),
    fetcher,
    now: () => new Date(FETCHED_AT),
    log: (_level, message) => {
      logs.push(message);
    },
  };
  return { ctx, calls, logs };
}

export function catalogUrl(page: number): string {
  return `${ORIGIN}/products.json?limit=250&page=${page}`;
}

/** A product with one variant and no options, for paging tests. */
export function plainProduct(n: number): Record<string, unknown> {
  return {
    id: n,
    title: `Product ${n}`,
    handle: `product-${n}`,
    vendor: 'Northfold',
    options: [{ name: 'Title', position: 1, values: ['Default Title'] }],
    variants: [
      {
        id: 100000 + n,
        title: 'Default Title',
        option1: 'Default Title',
        option2: null,
        option3: null,
        sku: `SKU-${n}`,
        price: '10.00',
        compare_at_price: null,
        available: true,
        product_id: n,
      },
    ],
  };
}

export function pageBody(products: unknown[]): string {
  return JSON.stringify({ products });
}
