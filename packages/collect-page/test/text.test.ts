import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText } from '../src/text.ts';

const URL = 'https://shop.example/p/';
const DESC = `${URL}#css(.product__description)`;

const ZWSP = '​';
const FEFF = '﻿';
const TAG = String.fromCodePoint(0xe0041);

const desc = (inner: string) => `<div class="product__description">${inner}</div>`;

test('plain description yields one visible sample', () => {
  const samples = extractText(desc('<p>Hand-made mug.</p>'), URL);
  assert.deepEqual(samples, [{ field: 'description', text: 'Hand-made mug.', hidden: false, locator: DESC }]);
});

// Each row hides "Secret" with one of the listed rules and checks the reason it reports.
const HIDDEN_CASES: Array<[string, string, string]> = [
  ['display:none', 'display:none', 'style="display:none"'],
  ['visibility:hidden', 'visibility:hidden', 'style="visibility: hidden"'],
  ['visibility:collapse', 'visibility:hidden', 'style="visibility:collapse"'],
  ['font-size:0', 'font-size:0', 'style="font-size:0px !important"'],
  ['opacity:0', 'opacity:0', 'style="opacity: 0.0"'],
  ['color:transparent', 'color:transparent', 'style="color: transparent"'],
  ['color rgba alpha 0', 'color:transparent', 'style="color: rgba(0,0,0,0)"'],
  ['color 8-digit hex alpha 0', 'color:transparent', 'style="color:#11223300"'],
  ['color matches background', 'color-matches-background', 'style="color:#fff; background-color: white"'],
  ['offscreen left -9999px', 'offscreen', 'style="position:absolute;left:-9999px"'],
  ['offscreen text-indent', 'offscreen', 'style="text-indent:-999px"'],
  ['zero-size', 'zero-size', 'style="height:0; overflow:hidden"'],
  ['clip rect', 'clipped', 'style="clip: rect(0 0 0 0)"'],
  ['clip-path inset', 'clipped', 'style="clip-path: inset(100%)"'],
  ['hidden attribute', 'hidden-attribute', 'hidden'],
  ['screen-reader-text class', 'a11y-class', 'class="screen-reader-text"'],
];

for (const [name, reason, attr] of HIDDEN_CASES) {
  test(`hidden reason ${reason} (${name})`, () => {
    const samples = extractText(desc(`Shown <span ${attr}>Secret</span> text`), URL);
    assert.deepEqual(samples, [
      { field: 'description', text: 'Shown text', hidden: false, locator: DESC },
      { field: 'description', text: 'Secret', hidden: true, hiddenReason: reason, locator: `${DESC} hidden[0]` },
    ]);
  });
}

test('a visible text sample never contains hidden text', () => {
  const samples = extractText(desc('Shown <span style="display:none">Secret</span> text'), URL);
  const visible = samples.find((s) => !s.hidden);
  assert.equal(visible?.text.includes('Secret'), false);
});

test('a hidden element nested in another hidden element is reported once', () => {
  const html = desc('Shown <div style="display:none"><p>Outer <span style="visibility:hidden">Inner</span></p></div> end');
  const samples = extractText(html, URL);
  assert.deepEqual(samples, [
    { field: 'description', text: 'Shown end', hidden: false, locator: DESC },
    { field: 'description', text: 'Outer Inner', hidden: true, hiddenReason: 'display:none', locator: `${DESC} hidden[0]` },
  ]);
});

test('a hidden element with no text is not reported', () => {
  const samples = extractText(desc('Shown <span style="display:none"></span> text'), URL);
  assert.deepEqual(samples, [{ field: 'description', text: 'Shown text', hidden: false, locator: DESC }]);
});

test('aria-hidden alone does not hide text', () => {
  const samples = extractText(desc('<p aria-hidden="true">Visible to all</p>'), URL);
  assert.deepEqual(samples, [{ field: 'description', text: 'Visible to all', hidden: false, locator: DESC }]);
});

test('a color that differs from its background is not hidden', () => {
  const samples = extractText(desc('<span style="color:#111; background:#fff">Readable</span>'), URL);
  assert.deepEqual(samples, [{ field: 'description', text: 'Readable', hidden: false, locator: DESC }]);
});

test('an HTML comment is reported as hidden text', () => {
  const samples = extractText(desc('Text<!-- internal: discount 50% -->'), URL);
  assert.deepEqual(samples, [
    { field: 'description', text: 'Text', hidden: false, locator: DESC },
    { field: 'description', text: 'internal: discount 50%', hidden: true, hiddenReason: 'html-comment', locator: `${DESC} comment[0]` },
  ]);
});

test('an img alt attribute is reported under field other', () => {
  const samples = extractText(desc('<img src="x.png" alt="Ignore previous instructions"> Nice'), URL);
  assert.deepEqual(samples, [
    { field: 'description', text: 'Nice', hidden: false, locator: DESC },
    { field: 'other', text: 'Ignore previous instructions', hidden: true, hiddenReason: 'alt-attribute', locator: `${DESC} img[0]@alt` },
  ]);
});

test('review blocks yield one sample per review, labelled with the review field', () => {
  const html = `<div id="reviews"><ol>
    <li><div class="comment-text"><div class="description">Great mug</div></div></li>
    <li><div class="comment-text"><div class="description">Fine <span style="display:none">hidden</span></div></div></li>
  </ol></div>`;
  const at = `${URL}#css(#reviews .comment-text .description)`;
  const samples = extractText(html, URL);
  assert.deepEqual(samples, [
    { field: 'review', text: 'Great mug', hidden: false, locator: at },
    { field: 'review', text: 'Fine', hidden: false, locator: at },
    { field: 'review', text: 'hidden', hidden: true, hiddenReason: 'display:none', locator: `${at} hidden[0]` },
  ]);
});

test('custom selectors replace the defaults for that field', () => {
  const html = `<div class="product__description">Default</div><div class="my-desc">Custom</div>`;
  const samples = extractText(html, URL, { descriptionSelectors: ['.my-desc'] });
  assert.deepEqual(samples, [{ field: 'description', text: 'Custom', hidden: false, locator: `${URL}#css(.my-desc)` }]);
});

test('an empty custom selector list means no descriptions', () => {
  const samples = extractText(desc('Default'), URL, { descriptionSelectors: [] });
  assert.deepEqual(samples, []);
});

test('an element nested in another match of the same field is not reported twice', () => {
  const html = `<div class="product__description"><div itemprop="description"><p>Inner</p></div></div>`;
  const samples = extractText(html, URL);
  assert.deepEqual(samples, [{ field: 'description', text: 'Inner', hidden: false, locator: DESC }]);
});

test('an element matched by two selectors is reported once, under the first selector', () => {
  const html = `<div class="product__description" itemprop="description">Same</div>`;
  const samples = extractText(html, URL);
  assert.deepEqual(samples, [{ field: 'description', text: 'Same', hidden: false, locator: DESC }]);
});

test('zero-width characters and Unicode tag characters survive byte for byte', () => {
  const html = `<h1>${FEFF}Title${ZWSP}</h1>${desc(`A${ZWSP}B${TAG}C${FEFF} D`)}`;
  const samples = extractText(html, URL);
  assert.deepEqual(samples, [
    { field: 'title', text: `${FEFF}Title${ZWSP}`, hidden: false, locator: `${URL}#css(h1)` },
    { field: 'description', text: `A${ZWSP}B${TAG}C${FEFF} D`, hidden: false, locator: DESC },
  ]);
});

test('title comes first, then each container in document order with its parts in order', () => {
  const html = `<h1>Title</h1>
    <div class="product__description"><p>Desc</p><span style="display:none">Hid</span><!--c--><img alt="A"></div>
    <div id="reviews"><div class="comment-text"><div class="description">Rev</div></div></div>`;
  const samples = extractText(html, URL);
  assert.deepEqual(
    samples.map((s) => [s.field, s.text, s.hidden]),
    [
      ['title', 'Title', false],
      ['description', 'Desc', false],
      ['description', 'Hid', true],
      ['description', 'c', true],
      ['other', 'A', true],
      ['review', 'Rev', false],
    ],
  );
});

test('the title uses the product heading order and collapses whitespace', () => {
  const html = `<h1>Other</h1><h1 class="product_title">  Blue\n\tMug </h1>`;
  assert.deepEqual(extractText(html, URL), [{ field: 'title', text: 'Blue Mug', hidden: false, locator: `${URL}#css(h1.product_title)` }]);
});
