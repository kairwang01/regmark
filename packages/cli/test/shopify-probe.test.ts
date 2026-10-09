// The Shopify checkout probe end to end: a small storefront on a local port,
// read by the real fetcher, so that what the unit tests fake is exercised for
// real. robots.txt disallows /cart, as Shopify's does; the cart lives in a
// session found by its Set-Cookie headers; and the probe's readings reach the
// rules.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import { runAudit } from '../src/audit.ts';

const TOKEN = 'shopify_probe_0123456789';

type Variant = { id: number; sku: string; size: string; price: string; cents: number; soldOut: boolean };
const VARIANTS: Variant[] = [
  { id: 101, sku: 'TEE-M', size: 'M', price: '39.00', cents: 3900, soldOut: false },
  // The catalogue and the page say this one is available; the cart refuses it.
  { id: 102, sku: 'TEE-L', size: 'L', price: '39.00', cents: 3900, soldOut: true },
];

type Session = { lines: { variant: Variant; quantity: number }[] };
type Seen = { method: string; path: string; cookie: string | undefined };

async function startShopifyShop() {
  const seen: Seen[] = [];
  const sessions = new Map<string, Session>();
  let origin = '';

  const send = (res: ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(body);
  };

  const cart = (session: Session) => ({
    token: 'Z2NwOjAx?key=0d99',
    item_count: session.lines.reduce((n, l) => n + l.quantity, 0),
    items: session.lines.map(({ variant, quantity }) => ({
      id: variant.id,
      variant_id: variant.id,
      quantity,
      price: variant.cents,
      original_price: variant.cents,
      final_price: variant.cents,
      final_line_price: variant.cents * quantity,
      sku: variant.sku,
      requires_shipping: true,
    })),
    requires_shipping: session.lines.length > 0,
    currency: 'USD',
  });

  const page = () => {
    const offers = VARIANTS.map((v) => ({
      '@type': 'Offer',
      sku: v.sku,
      price: v.price,
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${origin}/products/classic-tee`,
    }));
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'Classic Tee', offers };
    return `<!DOCTYPE html><html><head><title>Classic Tee</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>Classic Tee</h1></body></html>`;
  };

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', origin);
    seen.push({ method: req.method ?? '', path: url.pathname, cookie: req.headers.cookie });
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /cart\nDisallow: /checkout\n');
      return;
    }
    if (url.pathname === '/.well-known/regmark.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`regmark-verify=${TOKEN}\n`);
      return;
    }
    if (url.pathname === '/products.json') {
      const variants = VARIANTS.map((v) => ({
        id: v.id, title: v.size, option1: v.size, option2: null, option3: null,
        sku: v.sku, price: v.price, compare_at_price: null, available: true, product_id: 10,
      }));
      const products = [{ id: 10, title: 'Classic Tee', handle: 'classic-tee', vendor: 'Northfold', options: [{ name: 'Size', position: 1, values: ['M', 'L'] }], variants }];
      send(res, 200, JSON.stringify({ products: url.searchParams.get('page') === '1' ? products : [] }));
      return;
    }
    if (url.pathname === '/products/classic-tee') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page());
      return;
    }
    if (!url.pathname.startsWith('/cart')) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html>Not found</html>');
      return;
    }

    // The cart: one per session, found by the cart cookie, started on the first request without one.
    const token = /(?:^|;\s*)cart=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    let session = token === undefined ? undefined : sessions.get(token);
    const cookies: string[] = [];
    if (!session) {
      const id = `s${sessions.size + 1}`;
      session = { lines: [] };
      sessions.set(id, session);
      cookies.push(`cart=${id}; path=/; expires=Fri, 23 Oct 2026 12:00:00 GMT; SameSite=Lax`, `_shopify_essential=:${id}:; path=/; HttpOnly`);
    }
    const headers: Record<string, string | string[]> = cookies.length ? { 'set-cookie': cookies } : {};
    const body = await new Promise<string>((resolve) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', () => resolve(text));
    });

    if (req.method === 'GET' && url.pathname === '/cart.js') return send(res, 200, JSON.stringify(cart(session)), headers);
    if (req.method === 'POST' && url.pathname === '/cart/add.js') {
      const id = (JSON.parse(body) as { items: { id: number }[] }).items[0]?.id;
      const variant = VARIANTS.find((v) => v.id === id);
      if (!variant) return send(res, 422, JSON.stringify({ status: 422, message: 'Cart Error', description: 'Cannot find variant' }), headers);
      if (variant.soldOut) {
        return send(res, 422, JSON.stringify({ status: 422, message: 'Cart Error', description: "The product 'Classic Tee - L' is already sold out." }), headers);
      }
      session.lines.push({ variant, quantity: 1 });
      return send(res, 200, JSON.stringify({ items: cart(session).items }), headers);
    }
    if (req.method === 'POST' && url.pathname === '/cart/prepare_shipping_rates.json') {
      res.writeHead(202, headers);
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/cart/async_shipping_rates.json') {
      return send(res, 200, JSON.stringify({ shipping_rates: [{ name: 'Standard', price: '6.20', currency: null }] }), headers);
    }
    if (req.method === 'POST' && url.pathname === '/cart/clear.js') {
      session.lines.splice(0);
      return send(res, 200, JSON.stringify(cart(session)), headers);
    }
    send(res, 404, JSON.stringify({ status: 404, message: 'Not Found' }), headers);
  };

  const server = createServer((req, res) => {
    route(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    seen,
    sessions,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('a Shopify audit with --checkout probes the cart as the owner, keeps its session, and feeds the rules', async () => {
  const shop = await startShopifyShop();
  try {
    const result = await runAudit({
      store: shop.origin,
      platform: 'shopify',
      checkout: { shipTo: { country: 'US', postcode: '94103' } },
      ownershipToken: TOKEN,
      fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
    });

    assert.deepEqual(result.issues, []);
    assert.ok(result.surfaces.includes('checkout'));
    // The cart charges what every surface says, so no price finding; the
    // refused size and the shipping nobody states are what the probe adds.
    // No surface states a return policy either.
    assert.deepEqual(result.findings.map((f) => [f.rule, f.variant ?? null]), [
      ['variant.unpurchasable', 'TEE-L'],
      ['shipping.undisclosed', 'TEE-M'],
      ['policy.return-missing', null],
    ]);
    const refusal = result.findings.find((f) => f.rule === 'variant.unpurchasable');
    assert.equal(refusal?.actual?.raw, "The product 'Classic Tee - L' is already sold out.");
    assert.match(result.findings.find((f) => f.rule === 'shipping.undisclosed')!.message, /charges 6\.20 USD for shipping/);
    for (const rule of ['variant.unpurchasable', 'shipping.mismatch', 'shipping.undisclosed']) {
      assert.equal(result.rules.find((r) => r.id === rule)?.skipped, undefined, `${rule} ran`);
    }

    // robots.txt disallows /cart for crawlers, and the owner's reads went ahead.
    const cartRequests = shop.seen.filter((r) => r.path.startsWith('/cart'));
    assert.ok(cartRequests.some((r) => r.method === 'GET' && r.path === '/cart.js'));
    // One session: the first cart request started it, and every later one carried it.
    assert.equal(shop.sessions.size, 1);
    assert.equal(cartRequests[0]?.cookie, undefined);
    for (const r of cartRequests.slice(1)) assert.match(r.cookie ?? '', /^cart=s1; _shopify_essential=:s1:$/, `${r.method} ${r.path}`);
    assert.equal(shop.sessions.get('s1')?.lines.length, 0, 'the cart is empty at the end');
    assert.equal(shop.seen.some((r) => r.path.startsWith('/checkout')), false);
  } finally {
    await shop.close();
  }
});

test('without a verified ownership token the Shopify probe makes no cart request at all', async () => {
  const shop = await startShopifyShop();
  try {
    const result = await runAudit({
      store: shop.origin,
      platform: 'shopify',
      checkout: { shipTo: { country: 'US' } },
      ownershipToken: 'not_the_right_token_0000',
      fetch: { allowPrivateNetwork: true, minIntervalMs: 0 },
    });
    assert.deepEqual(result.issues.map((i) => [i.surface, i.code]), [['checkout', 'ownership-not-verified']]);
    assert.equal(shop.seen.some((r) => r.path.startsWith('/cart')), false);
  } finally {
    await shop.close();
  }
});
