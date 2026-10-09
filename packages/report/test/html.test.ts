import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderHtml } from '../src/index.ts';
import { audit, richResult, singleFinding } from './fixtures.ts';

test('the report is one self-contained document: no script, no external request', () => {
  const html = renderHtml(richResult());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.equal(/<script\b/i.test(html), false);
  assert.equal(/<link\b/i.test(html), false);
  assert.equal(/<img\b/i.test(html), false);
  assert.equal(/url\(/i.test(html), false);
  assert.equal(/@import/i.test(html), false);
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
});

test('the verdict says which way the audit went', () => {
  const failing = renderHtml(richResult());
  assert.ok(failing.includes('<section class="verdict out">'));
  assert.ok(failing.includes('<span class="pk">Out of register</span>'));
  assert.ok(failing.includes('<title>Regmark: shop.example out of register</title>'));
  const passing = renderHtml(audit({ ok: true }));
  assert.ok(passing.includes('<section class="verdict in">'));
  assert.ok(passing.includes('<span class="pk">In register</span>'));
  assert.ok(passing.includes('Every rule is within its budget.'));
});

test('the headline is read once by a screen reader although it is printed four times', () => {
  const html = renderHtml(richResult());
  assert.equal((html.match(/>Out of register<\/span>/g) ?? []).length, 4);
  assert.equal((html.match(/aria-hidden="true">Out of register<\/span>/g) ?? []).length, 3);
});

test('each plate lists the surfaces collected under it, and says so when there were none', () => {
  const html = renderHtml(audit({ surfaces: ['page', 'jsonld', 'feed', 'checkout'] }));
  assert.match(html, /chip-c">C<\/span>Page<\/h3>.*?<ul><li>page<\/li><li>jsonld<\/li><\/ul>/s);
  assert.match(html, /chip-m">M<\/span>Feed<\/h3>.*?<ul><li>feed<\/li><\/ul>/s);
  assert.match(html, /class="plate none"><h3><span class="chip chip-y">Y<\/span>Protocol<\/h3>.*?<li>not collected<\/li>/s);
  assert.match(html, /chip-k">K<\/span>Checkout<\/h3>.*?<ul><li>checkout<\/li><\/ul>/s);
});

test('a finding with two sides shows both, each tagged with its plate', () => {
  const html = renderHtml(richResult());
  assert.match(html, /<div class="says says-actual">\s*<p class="who"><span class="chip chip-c">C<\/span><span>jsonld<\/span><\/p>\s*<p class="value">35\.00 USD<\/p>/);
  assert.match(html, /<div class="says says-expected">\s*<p class="who"><span class="chip chip-k">K<\/span><span>checkout<\/span><\/p>\s*<p class="value">39\.00 USD<\/p>/);
  assert.ok(html.includes('id="rule-price.mismatch"'));
  assert.ok(html.includes('href="#rule-price.mismatch"'));
});

test('everything that came from the shop is escaped', () => {
  const nasty = '<img src=x onerror=alert(1)>"\'&';
  const html = renderHtml(
    singleFinding({
      message: nasty,
      product: `shop.example/product/${nasty}`,
      variant: nasty,
      expected: { surface: 'checkout', value: nasty, raw: nasty, locator: `https://shop.example/a#${nasty}` },
      actual: { surface: 'jsonld', value: nasty, raw: nasty, locator: `https://shop.example/b#${nasty}` },
    }),
  );
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('onerror=alert(1)>'), false);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
});

test('a locator becomes a link only when it is a plain http(s) URL', () => {
  const link = (locator: string) => renderHtml(singleFinding({ message: 'm', actual: { surface: 'jsonld', value: 'v', raw: 'v', locator } }));
  assert.ok(link('https://shop.example/p/#jsonld[0]/price').includes('<a class="loc" href="https://shop.example/p/" rel="noopener noreferrer nofollow">'));
  for (const bad of ['javascript:alert(1)#x', 'data:text/html,<b>x</b>', 'https://shop.example/"onmouseover="x', 'test://jsonld']) {
    const html = link(bad);
    assert.equal(/<a class="loc"/.test(html), false, bad);
    assert.ok(html.includes('<span class="loc">'), bad);
  }
});

test('control characters from the shop do not reach the document', () => {
  const html = renderHtml(singleFinding({ message: 'a\u0000b\u001bc\u009bd' }));
  assert.equal(/[\u0000\u001b\u009b]/.test(html), false);
  assert.ok(html.includes('a b c d'));
});

test('a rule with many findings is cut off with a pointer to the JSON report', () => {
  const findings = Array.from({ length: 7 }, (_, i) => ({ rule: 'price.mismatch', severity: 'error' as const, message: `m${i}`, product: 'p', variant: `V-${i}` }));
  const html = renderHtml(audit({ findings, rules: [{ id: 'price.mismatch', severity: 'error', summary: 's', findings: 7, budget: 0, passed: false }], ok: false }), { maxPerRule: 3 });
  assert.equal((html.match(/<li class="proof">/g) ?? []).length, 3);
  assert.ok(html.includes('and 4 more, in the JSON report.'));
});

test('collection issues get their own section, and are absent when there are none', () => {
  assert.ok(renderHtml(richResult()).includes('<h2>Collection issues</h2>'));
  assert.equal(renderHtml(audit({ ok: true })).includes('Collection issues'), false);
});
