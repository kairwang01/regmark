import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sighting } from '@regmark/core';
import rule, { sameItem } from '../../src/content/cloaking.ts';
import { price, run, runFull, sample, stock, variant, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/cap/';

// What every client is told, read the ordinary way: two caps at 22.00, both in stock.
const ordinary = (): Sighting[] => [
  variant('platform', { sku: 'CAP-RED', variantId: '601', productId: '600', url: URL, options: { Color: 'Red' } }, { price: price('platform', '22.00'), availability: stock('platform', 'in_stock') }),
  variant('platform', { sku: 'CAP-BLK', variantId: '602', productId: '600', url: URL, options: { Color: 'Black' } }, { price: price('platform', '22.00'), availability: stock('platform', 'in_stock') }),
  whole('page', URL, { price: price('page', '22.00'), availability: stock('page', 'in_stock') }),
  variant('jsonld', { sku: 'CAP-RED', url: URL }, { price: price('jsonld', '22.00'), availability: stock('jsonld', 'in_stock') }),
  variant('jsonld', { sku: 'CAP-BLK', url: URL }, { price: price('jsonld', '22.00'), availability: stock('jsonld', 'in_stock') }),
  whole('opengraph', URL, { price: price('opengraph', '22.00'), availability: stock('opengraph', 'in_stock') }),
];

/** The page as one client was shown it. Each argument overrides one statement. */
function view(via: string, says: { page?: Partial<Sighting>; red?: Partial<Sighting>; blk?: Partial<Sighting>; og?: Partial<Sighting> } = {}): Sighting[] {
  return [
    whole('page', URL, { price: price('page', '22.00'), availability: stock('page', 'in_stock'), ...says.page, via }),
    variant('jsonld', { sku: 'CAP-RED', url: URL }, { price: price('jsonld', '22.00'), availability: stock('jsonld', 'in_stock'), ...says.red, via }),
    variant('jsonld', { sku: 'CAP-BLK', url: URL }, { price: price('jsonld', '22.00'), availability: stock('jsonld', 'in_stock'), ...says.blk, via }),
    whole('opengraph', URL, { price: price('opengraph', '22.00'), availability: stock('opengraph', 'in_stock'), ...says.og, via }),
  ];
}

const lower = { red: { price: price('jsonld', '19.00') }, blk: { price: price('jsonld', '19.00') } };

// ── When it stays silent ────────────────────────────────────────────────

test('without views the rule does not run at all', () => {
  const result = runFull(rule, ordinary());
  assert.deepEqual(result.findings, []);
  assert.equal(result.rules[0]!.skipped, 'needs --cloaking');
});

test('every client told the same thing: nothing to report', () => {
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser'), ...view('agent')]), []);
});

test('a lighter page for bots, leaving facts out, is not telling anyone anything different', () => {
  const lighter: Sighting[] = [
    // No visible price, no stock line, and no JSON-LD or Open Graph at all.
    whole('page', URL, { via: 'agent', text: [sample('A six panel cotton cap.')] }),
  ];
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser'), ...lighter]), []);
  // A view that states the price but not the stock level is compared on price alone.
  const priceOnly = view('agent', { red: { availability: undefined }, blk: { availability: undefined } });
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser'), ...priceOnly]), []);
});

test('a related product that a rotating block shows one client and not the other is not a difference', () => {
  // Cards with no URL of their own stay on the page's product; each names its own SKU.
  const card = (via: string, sku: string, amount: string) => variant('jsonld', { sku, url: URL }, { price: price('jsonld', amount), via });
  const browser = [...view('browser'), card('browser', 'BAG-OLV', '58.00')];
  const agent = [...view('agent'), card('agent', 'MUG-WHT', '16.00')];
  assert.deepEqual(run(rule, [...ordinary(), ...browser, ...agent]), []);
});

test('statements no identifier ties to an item differ only when none of them is stated to the reference', () => {
  // Cards with no SKU, rotated between the two reads: the page's own price is told to both.
  const loose = (via: string, amounts: string[]) => amounts.map((a) => whole('microdata', URL, { price: price('microdata', a), via }));
  assert.deepEqual(run(rule, [...ordinary(), ...loose('browser', ['22.00', '30.00', '45.00']), ...loose('agent', ['22.00', '45.00', '12.00'])]), []);
  // The page's own price told differently, with nothing else in common, is a difference.
  const found = run(rule, [...ordinary(), ...loose('browser', ['22.00']), ...loose('agent', ['19.00'])]);
  assert.deepEqual(found.map((f) => f.surface), ['microdata']);
});

test('the same facts in another order are the same facts', () => {
  const reordered = view('agent').reverse();
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser'), ...reordered]), []);
  // Offers that carry no identifier are compared as a set, so order cannot matter there either.
  const bare = (via: string, amounts: string[]) => amounts.map((a) => variant('microdata', { url: URL }, { price: price('microdata', a), via }));
  assert.deepEqual(run(rule, [...ordinary(), ...bare('browser', ['22.00', '25.00']), ...bare('agent', ['25.00', '22.00'])]), []);
});

test('markup that changes on every request (a CSRF token, a timestamp) is not a fact, and is not compared', () => {
  const browser = view('browser');
  const agent = view('agent');
  browser[0]!.text = [sample('Rendered at 12:00:01. Token 8f3a2c.', { field: 'other' })];
  agent[0]!.text = [sample('Rendered at 12:00:04. Token 1d9e77.', { field: 'other' })];
  assert.deepEqual(run(rule, [...ordinary(), ...browser, ...agent]), []);
});

test('an unknown stock level is no statement, on either side', () => {
  const unknownToAgent = view('agent', { red: { availability: stock('jsonld', 'unknown') }, og: { availability: stock('opengraph', 'unknown') } });
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser'), ...unknownToAgent]), []);
  const unknownToBrowser = view('browser', { red: { availability: stock('jsonld', 'unknown') }, blk: { availability: stock('jsonld', 'unknown') } });
  const soldOutToAgent = view('agent', { red: { availability: stock('jsonld', 'out_of_stock') } });
  // The browser view is the reference, and it states no stock level for either cap in its JSON-LD.
  assert.deepEqual(run(rule, [...ordinary(), ...unknownToBrowser, ...soldOutToAgent]), []);
});

test('pre-order and back-order are buyable, so they agree with in stock', () => {
  const agent = view('agent', { red: { availability: stock('jsonld', 'preorder') }, og: { availability: stock('opengraph', 'backorder') } });
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser'), ...agent]), []);
});

test('a view that failed, or never ran for this product, leaves nothing to compare', () => {
  // Only the browser view came back: the reference is never compared with itself.
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser')]), []);
  // The cap was read as an agent; the mug was not, and is not judged.
  const mugUrl = 'https://shop.example/product/mug/';
  const mug: Sighting[] = [
    variant('platform', { sku: 'MUG', variantId: '501', productId: '500', url: mugUrl }, { price: price('platform', '16.00') }),
    whole('page', mugUrl, { price: price('page', '16.00') }),
  ];
  const findings = run(rule, [...ordinary(), ...mug, ...view('browser'), ...view('agent', lower)]);
  assert.deepEqual(findings.map((f) => f.product), ['shop.example/product/cap']);
});

test('the browser view is the reference, and is not itself held to the ordinary read', () => {
  // The ordinary read and the browser disagree (a price changed between the two reads); the agent agrees with the browser.
  const browser = view('browser', lower);
  const agent = view('agent', lower);
  assert.deepEqual(run(rule, [...ordinary(), ...browser, ...agent]), []);
});

test('a reference that names the item but states no price for it is silent on that item', () => {
  const browser = view('browser', { red: { price: undefined } });
  const agent = view('agent', { red: { price: price('jsonld', '19.00') } });
  assert.deepEqual(run(rule, [...ordinary(), ...browser, ...agent]), []);
});

test('surfaces are compared with themselves only', () => {
  // The agent's JSON-LD says 19.00 and the browser's never had JSON-LD; its microdata says 22.00.
  const browser: Sighting[] = [variant('microdata', { sku: 'CAP-RED', url: URL }, { price: price('microdata', '22.00'), via: 'browser' })];
  const agent: Sighting[] = [variant('jsonld', { sku: 'CAP-RED', url: URL }, { price: price('jsonld', '19.00'), via: 'agent' })];
  assert.deepEqual(run(rule, [...ordinary(), ...browser, ...agent]), []);
});

test('a price without a currency is not a different price', () => {
  const agent = view('agent', { red: { price: price('jsonld', '22.00', null) }, og: { price: price('opengraph', '22.00', null) } });
  assert.deepEqual(run(rule, [...ordinary(), ...view('browser'), ...agent]), []);
});

test('a product-wide statement that matches any of the reference’s prices is not a different price', () => {
  const browser = view('browser', { blk: { price: price('jsonld', '25.00') } });
  // One offer for the whole product, naming no variant, at the red cap's price.
  const agent: Sighting[] = [whole('jsonld', URL, { price: price('jsonld', '22.00'), via: 'agent' })];
  assert.deepEqual(run(rule, [...ordinary(), ...browser, ...agent]), []);
});

// ── When it fires ───────────────────────────────────────────────────────

test('an agent told a lower JSON-LD price than a browser is reported once for the surface', () => {
  const findings = run(rule, [...ordinary(), ...view('browser'), ...view('agent', lower)]);
  assert.equal(findings.length, 1);
  const [f] = findings;
  assert.equal(f!.rule, 'content.cloaking');
  assert.equal(f!.severity, 'error');
  assert.equal(f!.product, 'shop.example/product/cap');
  assert.equal(f!.variant, undefined);
  assert.equal(f!.surface, 'jsonld');
  assert.equal(f!.message, 'a client identifying as agent was told 19.00 USD in jsonld; a browser 22.00 USD');
  assert.deepEqual(f!.expected, { surface: 'jsonld', value: '22.00 USD', raw: '22.00', locator: 'test://jsonld [via browser]' });
  assert.deepEqual(f!.actual, { surface: 'jsonld', value: '19.00 USD', raw: '19.00', locator: 'test://jsonld [via agent]' });
});

test('variants are paired by SKU, so one cap priced differently is enough', () => {
  const agent = view('agent', { blk: { price: price('jsonld', '24.00') } });
  const findings = run(rule, [...ordinary(), ...view('browser'), ...agent]);
  assert.deepEqual(findings.map((f) => [f.surface, f.actual?.value, f.expected?.value]), [['jsonld', '24.00 USD', '22.00 USD']]);
});

test('variants are paired by GTIN or by options when that is what both views give', () => {
  const byGtin = (via: string, red: string, blk: string): Sighting[] => [
    variant('microdata', { gtin: '4006381333931', url: URL }, { price: price('microdata', red), via }),
    variant('microdata', { gtin: '4006381333948', url: URL }, { price: price('microdata', blk), via }),
  ];
  // Both prices appear in both views, but on the other cap.
  assert.equal(run(rule, [...ordinary(), ...byGtin('browser', '22.00', '25.00'), ...byGtin('agent', '25.00', '22.00')]).length, 1);
  const byOptions = (via: string, red: string, blk: string): Sighting[] => [
    variant('microdata', { url: URL, options: { Color: 'Red' } }, { price: price('microdata', red), via }),
    variant('microdata', { url: URL, options: { color: 'black' } }, { price: price('microdata', blk), via }),
  ];
  assert.equal(run(rule, [...ordinary(), ...byOptions('browser', '22.00', '25.00'), ...byOptions('agent', '25.00', '22.00')]).length, 1);
});

test('a price in another currency is a different price', () => {
  const agent = view('agent', { og: { price: price('opengraph', '22.00', 'CAD') } });
  const findings = run(rule, [...ordinary(), ...view('browser'), ...agent]);
  assert.deepEqual(findings.map((f) => [f.surface, f.message]), [['opengraph', 'a client identifying as agent was told 22.00 CAD in opengraph; a browser 22.00 USD']]);
});

test('without identifiers, a price the reference does not state anywhere on the surface is reported', () => {
  const agent = view('agent', { page: { price: price('page', '18.00') } });
  const findings = run(rule, [...ordinary(), ...view('browser'), ...agent]);
  assert.deepEqual(findings.map((f) => [f.surface, f.actual?.value, f.expected?.value]), [['page', '18.00 USD', '22.00 USD']]);
});

test('a stock level that disagrees is its own finding, beside a price that does', () => {
  const agent = view('agent', { ...lower, red: { price: price('jsonld', '19.00'), availability: stock('jsonld', 'in_stock') } });
  const soldOut = view('browser', { red: { availability: stock('jsonld', 'out_of_stock') }, blk: { availability: stock('jsonld', 'out_of_stock') } });
  const findings = run(rule, [...ordinary(), ...soldOut, ...agent]);
  assert.deepEqual(findings.map((f) => f.message), [
    'a client identifying as agent was told 19.00 USD in jsonld; a browser 22.00 USD',
    'a client identifying as agent was told in_stock in jsonld; a browser out_of_stock',
  ]);
  assert.deepEqual(findings[1]!.expected, { surface: 'jsonld', value: 'out_of_stock', raw: 'out_of_stock', locator: 'test://jsonld [via browser]' });
});

test('each surface that disagrees is reported on its own', () => {
  const agent = view('agent', { ...lower, og: { price: price('opengraph', '19.00') } });
  const findings = run(rule, [...ordinary(), ...view('browser'), ...agent]);
  assert.deepEqual(findings.map((f) => f.surface), ['jsonld', 'opengraph']);
});

test('without a browser view, each view is held to the ordinary read', () => {
  const findings = run(rule, [...ordinary(), ...view('agent', lower)]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.message, 'a client identifying as agent was told 19.00 USD in jsonld; Regmark itself 22.00 USD');
  // The ordinary read's locator is left as it is.
  assert.equal(findings[0]!.expected!.locator, 'test://jsonld');
  assert.equal(findings[0]!.actual!.locator, 'test://jsonld [via agent]');
});

test('every other view is compared with the browser, each under its own name', () => {
  const findings = run(rule, [...ordinary(), ...view('browser'), ...view('agent', lower), ...view('searchbot', lower)]);
  assert.deepEqual(findings.map((f) => f.message.split(' was told')[0]), ['a client identifying as agent', 'a client identifying as searchbot']);
});

test('sameItem() pairs by the first identifier both carry, and declines when they share none', () => {
  const s = (ids: Sighting['ids']): Sighting => variant('jsonld', ids);
  assert.equal(sameItem(s({ sku: 'cap-red ' }), s({ sku: 'CAP-RED' })), true);
  assert.equal(sameItem(s({ sku: 'CAP-RED', gtin: '4006381333931' }), s({ sku: 'CAP-BLK', gtin: '4006381333931' })), false);
  assert.equal(sameItem(s({ gtin: '006381333931' }), s({ gtin: '0006381333931' })), true);
  assert.equal(sameItem(s({ options: { Colour: 'Red' } }), s({ options: { color: 'red' } })), true);
  assert.equal(sameItem(s({ sku: 'CAP-RED' }), s({ gtin: '4006381333931' })), null);
  assert.equal(sameItem(s({ url: URL }), s({ url: URL })), null);
});
