// Working out what a shop runs on, so that `regmark audit <url>` needs no flags.
//
// Two reads at most, both of endpoints the platforms publish for storefronts
// to use. A shop that answers neither is audited from its pages alone.

import type { CollectContext } from '@regmark/core';

export type Platform = 'woocommerce' | 'shopify';

async function readJson(ctx: CollectContext, url: string): Promise<{ body: unknown; headers: Record<string, string> } | undefined> {
  try {
    const res = await ctx.fetcher.get(url, { headers: { accept: 'application/json' } });
    if (res.status !== 200) return undefined;
    return { body: JSON.parse(res.body) as unknown, headers: res.headers };
  } catch {
    // Refused by robots.txt, not JSON, not there: all mean "not this platform".
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function detectPlatform(ctx: CollectContext): Promise<Platform | null> {
  const origin = ctx.store.origin;

  const woo = await readJson(ctx, `${origin}/wp-json/wc/store/v1/products?per_page=1`);
  if (woo && Array.isArray(woo.body)) {
    const first: unknown = woo.body[0];
    // The total header is WordPress's; a `prices` object is the Store API's.
    if ('x-wp-total' in woo.headers || (isObject(first) && isObject(first.prices))) return 'woocommerce';
  }

  const shopify = await readJson(ctx, `${origin}/products.json?limit=1`);
  if (shopify && isObject(shopify.body) && Array.isArray(shopify.body.products)) return 'shopify';

  return null;
}
