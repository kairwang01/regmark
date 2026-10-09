import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule, { looksStuffed } from '../../src/content/hidden-text.ts';
import { run, sample, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/beanie/';
const STUFFED = 'best beanie cheap beanie warm winter hat top rated beanie free shipping beanie sale';
const PROSE = 'Root Science, you did it again! I am so happy you made a vitamin C treatment that helps to even my skin tone.';
const hidden = (text: string, hiddenReason: string) => run(rule, [whole('page', URL, { title: 'Wool Beanie', text: [sample(text, { hidden: true, hiddenReason })] })]);

test('a block hidden with a cloaking technique is reported whatever it says', () => {
  for (const reason of ['font-size:0', 'color:transparent', 'color-matches-background', 'offscreen', 'zero-size', 'clipped']) {
    const findings = hidden(PROSE, reason);
    assert.equal(findings.length, 1, reason);
    assert.equal(findings[0]!.surface, 'page');
    assert.equal(findings[0]!.variant, undefined);
    assert.ok(findings[0]!.message.startsWith(`hidden with ${reason}: "`), reason);
  }
});

test('keyword stuffing hidden the ordinary way is reported', () => {
  for (const reason of ['display:none', 'visibility:hidden', 'opacity:0', 'hidden-attribute']) {
    assert.equal(hidden(STUFFED, reason).length, 1, reason);
  }
});

test('ordinary prose hidden the ordinary way is an interface doing its job, and is not reported', () => {
  for (const reason of ['display:none', 'visibility:hidden', 'opacity:0', 'hidden-attribute']) {
    assert.deepEqual(hidden(PROSE, reason), [], reason);
  }
});

test('the honest reasons never fire, not even for stuffed text', () => {
  for (const reason of ['a11y-class', 'alt-attribute', 'html-comment']) {
    assert.deepEqual(hidden(STUFFED, reason), [], reason);
  }
});

test('visible text is not this rule’s business', () => {
  assert.deepEqual(run(rule, [whole('page', URL, { text: [sample(STUFFED)] })]), []);
});

test('a fragment under 20 characters is ignored', () => {
  assert.deepEqual(hidden('free shipping today', 'font-size:0'), []);
  assert.equal(hidden('free shipping today!', 'font-size:0').length, 1);
});

test('two offending samples give two findings', () => {
  const findings = run(rule, [
    whole('page', URL, {
      title: 'Wool Beanie',
      text: [sample(STUFFED, { hidden: true, hiddenReason: 'display:none' }), sample(PROSE, { hidden: true, hiddenReason: 'offscreen', locator: 'test://page#2' })],
    }),
  ]);
  assert.equal(findings.length, 2);
});

test('a long hidden text is cut to 120 characters and an ellipsis in the evidence', () => {
  const [finding] = hidden('x'.repeat(500), 'font-size:0');
  assert.equal(finding!.actual!.value.length, 121);
  assert.ok(finding!.actual!.value.endsWith('…'));
});

test('control characters do not survive into the evidence', () => {
  const [finding] = hidden(`hidden text with an escape \u001b[31m in it`, 'offscreen');
  assert.equal(finding!.actual!.value.includes('\u001b'), false);
});

test('looksStuffed() looks for the product\u2019s own name repeated, which a size table does not do', () => {
  const sizes = 'Size guide: small fits chest 34 to 36, medium fits chest 38 to 40, large fits chest 42 to 44, extra large fits chest 46 to 48, double extra large fits chest 50 to 52.';
  assert.equal(looksStuffed(STUFFED, 'Wool Beanie'), true);
  assert.equal(looksStuffed(PROSE, 'Vitamin C Serum'), false);
  assert.equal(looksStuffed(sizes, 'Classic Tee'), false);
  assert.equal(looksStuffed('beanie beanie beanie', 'Wool Beanie'), false);
  // Without a name to go on, only heavy repetition counts.
  assert.equal(looksStuffed(STUFFED), false);
  assert.equal(looksStuffed(sizes), false);
  assert.equal(looksStuffed('cheap beanie best beanie warm beanie beanie sale beanie beanie winter beanie'), true);
});

test('a size guide tucked behind a button is not reported', () => {
  const sizes = 'Size guide: small fits chest 34 to 36, medium fits chest 38 to 40, large fits chest 42 to 44, extra large fits chest 46 to 48.';
  assert.deepEqual(run(rule, [whole('page', URL, { title: 'Classic Tee', text: [sample(sizes, { hidden: true, hiddenReason: 'display:none' })] })]), []);
});
