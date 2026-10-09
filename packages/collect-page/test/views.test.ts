import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FetchRefused } from '@regmark/core';
import type { CollectContext, Fetched, Fetcher, RequestOptions } from '@regmark/core';
import { collectViews, extractPage } from '../src/index.ts';
import type { ClientProfile } from '../src/index.ts';

const AT = '2026-10-09T12:00:00.000Z';
const MUG = 'https://shop.example/product/mug/';
const CAP = 'https://shop.example/product/cap/';

const BROWSER: ClientProfile = { name: 'browser', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0' };
const AGENT: ClientProfile = { name: 'agent', userAgent: 'Mozilla/5.0; compatible; ChatGPT-User/1.0' };

const page = (amount: string, extra = '') => `<main>
  <h1 class="product_title">Enamel Mug</h1>
  <p class="price">$${amount}</p>
  <div class="product__description">White enamel over steel.</div>
  <script type="application/ld+json">{"@type":"Product","sku":"MUG","url":"https://shop.example/mug?ref=canonical","offers":{"@type":"Offer","price":"${amount}","priceCurrency":"USD"}}</script>
  ${extra}
</main>`;

type Answer = Partial<Fetched> | Error;
type Call = { url: string; options: RequestOptions | undefined };

/** Answers by URL and by the User-Agent the caller sent, so a test can play a shop that cloaks. */
function fakeShop(answer: (url: string, userAgent: string | undefined) => Answer) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const fetcher: Fetcher = {
    async get(url, options) {
      calls.push({ url, options });
      const a = answer(url, options?.headers?.['user-agent']);
      if (a instanceof Error) throw a;
      return { url, status: 200, headers: { 'content-type': 'text/html' }, body: '', fetchedAt: AT, ...a };
    },
    async send() {
      throw new Error('the views collector must never write');
    },
    async query() {
      throw new Error('the views collector never posts a query');
    },
  };
  const ctx: CollectContext = { store: new URL('https://shop.example'), fetcher, now: () => new Date(AT), log: (_l, m) => void logs.push(m) };
  return { ctx, calls, logs };
}

test('each page is fetched once per profile, as the owner, sending that profile’s User-Agent', async () => {
  const shop = fakeShop(() => ({ body: page('16.00') }));
  await collectViews(shop.ctx, [MUG, CAP], [BROWSER, AGENT]);
  // A page's views are read back to back, so the views being compared are close together in time.
  assert.deepEqual(shop.calls.map((c) => `${c.url} ${c.options?.headers?.['user-agent']}`), [
    `${MUG} ${BROWSER.userAgent}`,
    `${MUG} ${AGENT.userAgent}`,
    `${CAP} ${BROWSER.userAgent}`,
    `${CAP} ${AGENT.userAgent}`,
  ]);
  for (const c of shop.calls) {
    assert.equal(c.options?.asOwner, true);
    assert.equal(c.options?.headers?.accept, 'text/html,application/xhtml+xml');
  }
});

test('every sighting names its profile and keeps the URL it states, as the ordinary read does', async () => {
  const shop = fakeShop(() => ({ body: page('16.00') }));
  const result = await collectViews(shop.ctx, [MUG], [AGENT]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings.map((s) => s.surface), ['page', 'jsonld']);
  for (const s of result.sightings) assert.equal(s.via, 'agent');
  // The same statements an ordinary read of the page makes, so the graph
  // hands each view to the product the ordinary read gave it to.
  const ordinary = extractPage(page('16.00'), MUG, AT).sightings;
  assert.deepEqual(result.sightings.map((s) => s.ids.url), ordinary.map((s) => s.ids.url));
  assert.equal(result.sightings[1]!.ids.sku, 'MUG');
});

test('a related product’s card stays with that product, not the page it appears on', async () => {
  const card = '<script type="application/ld+json">{"@type":"Product","sku":"CAP","url":"https://shop.example/product/cap/","offers":{"@type":"Offer","price":"22.00","priceCurrency":"USD"}}</script>';
  const shop = fakeShop(() => ({ body: page('16.00', card) }));
  const result = await collectViews(shop.ctx, [MUG], [AGENT]);
  const cap = result.sightings.find((s) => s.ids.sku === 'CAP');
  assert.equal(cap?.ids.url, CAP);
});

test('what each client was told is kept as that client’s own reading', async () => {
  const shop = fakeShop((_url, ua) => ({ body: page(ua === AGENT.userAgent ? '12.00' : '16.00') }));
  const result = await collectViews(shop.ctx, [MUG], [BROWSER, AGENT]);
  const told = result.sightings.map((s) => `${s.via} ${s.surface} ${s.price?.raw}`);
  assert.deepEqual(told, ['browser page $16.00', 'browser jsonld 16.00', 'agent page $12.00', 'agent jsonld 12.00']);
  // Observations keep the raw text and the extractor's own locator.
  assert.match(result.sightings[3]!.price!.locator, /^https:\/\/shop\.example\/product\/mug\//);
  assert.equal(result.sightings[3]!.price!.fetchedAt, AT);
});

test('the page text rides along, so the content rules can read what only one client was shown', async () => {
  const shop = fakeShop(() => ({ body: page('16.00') }));
  const result = await collectViews(shop.ctx, [MUG], [AGENT]);
  assert.ok(result.sightings[0]!.text?.some((t) => t.text === 'White enamel over steel.'));
});

test('a page that answers one client with an error is an issue naming that client, and the others are still read', async () => {
  const shop = fakeShop((_url, ua) => (ua === AGENT.userAgent ? { status: 403, body: 'Forbidden' } : { body: page('16.00') }));
  const result = await collectViews(shop.ctx, [MUG], [BROWSER, AGENT]);
  assert.deepEqual(result.issues, [{ surface: 'page', code: 'view-failed', message: 'as agent: HTTP 403', locator: MUG }]);
  assert.ok(result.sightings.length > 0);
  assert.ok(result.sightings.every((s) => s.via === 'browser'));
});

test('a refusal or a network error becomes an issue, never an exception', async () => {
  const shop = fakeShop((url) =>
    url === MUG
      ? new FetchRefused('write-not-authorized', MUG, 'ownership of this shop has not been verified')
      : new Error('socket hang up'),
  );
  const result = await collectViews(shop.ctx, [MUG, CAP], [AGENT]);
  assert.deepEqual(result.sightings, []);
  assert.deepEqual(result.issues, [
    { surface: 'page', code: 'view-failed', message: `as agent: write-not-authorized: ${MUG} (ownership of this shop has not been verified)`, locator: MUG },
    { surface: 'page', code: 'view-failed', message: 'as agent: socket hang up', locator: CAP },
  ]);
  assert.deepEqual(shop.logs, [`page not read as agent: ${MUG}`, `page not read as agent: ${CAP}`]);
});

test('a page that redirected to another origin was not read as the client, so it is not a view', async () => {
  const shop = fakeShop(() => ({ url: 'https://cdn.example/mug.html', body: page('16.00') }));
  const result = await collectViews(shop.ctx, [MUG], [AGENT]);
  assert.deepEqual(result.sightings, []);
  assert.deepEqual(result.issues, [{ surface: 'page', code: 'view-redirected', message: 'as agent: answered from https://cdn.example/mug.html', locator: MUG }]);
});

test('a redirect the owner read did not follow is reported as one, not as a failure', async () => {
  const shop = fakeShop(() => ({ status: 302, headers: { location: 'https://cdn.example/mug.html' }, body: '' }));
  const result = await collectViews(shop.ctx, [MUG], [AGENT]);
  assert.deepEqual(result.sightings, []);
  assert.deepEqual(result.issues, [{ surface: 'page', code: 'view-redirected', message: 'as agent: redirected to https://cdn.example/mug.html', locator: MUG }]);
});

test('a redirect within the shop is still the client’s view', async () => {
  const shop = fakeShop(() => ({ url: `${MUG}?lang=en`, body: page('16.00') }));
  const result = await collectViews(shop.ctx, [MUG], [AGENT]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sightings.map((s) => s.via), ['agent', 'agent']);
});

test('problems inside a page are the ordinary read’s to report, not each view’s', async () => {
  const broken = page('16.00', '<script type="application/ld+json">{ not json</script>');
  assert.deepEqual(extractPage(broken, MUG, AT).issues.map((i) => i.code), ['parse-error']);
  const shop = fakeShop(() => ({ body: broken }));
  const result = await collectViews(shop.ctx, [MUG], [BROWSER, AGENT]);
  assert.deepEqual(result.issues, []);
});

test('the page options apply to the views as they do to the ordinary read', async () => {
  const shop = fakeShop(() => ({ body: '<main><h1>Mug</h1><p class="price">$16.00</p><span class="sale-now">$12.00</span></main>' }));
  const result = await collectViews(shop.ctx, [MUG], [AGENT], { priceSelector: '.sale-now', currency: 'CAD' });
  assert.deepEqual(result.sightings[0]!.price?.value, { units: 120000, currency: 'CAD' });
});

test('no pages or no profiles means no requests', async () => {
  const shop = fakeShop(() => ({ body: page('16.00') }));
  assert.deepEqual(await collectViews(shop.ctx, [], [BROWSER, AGENT]), { sightings: [], issues: [] });
  assert.deepEqual(await collectViews(shop.ctx, [MUG], []), { sightings: [], issues: [] });
  assert.equal(shop.calls.length, 0);
});
