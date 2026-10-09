import assert from 'node:assert/strict';
import { test } from 'node:test';
import rule from '../../src/content/invisible-chars.ts';
import { run, sample, whole } from '../helpers.ts';

const URL = 'https://shop.example/product/scarf/';
const onPage = (...samples: ReturnType<typeof sample>[]) => whole('page', URL, { text: samples });
const tag = (cp: number) => String.fromCodePoint(cp);
const SCOTLAND = String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f);
const INVISIBLE = /[​⁠﻿]|[\u{e0020}-\u{e007e}]/u;

test('three zero-width spaces fire', () => {
  const findings = run(rule, [onPage(sample('soft​​scarf​'))]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.actual!.value, '3 zero-width characters');
  assert.equal(findings[0]!.message, 'text contains invisible characters: 3 zero-width characters');
  assert.equal(findings[0]!.surface, 'page');
});

test('two zero-width spaces are silent', () => {
  assert.equal(run(rule, [onPage(sample('soft​​scarf'))]).length, 0);
});

test('one tag character fires', () => {
  const findings = run(rule, [onPage(sample(`wool scarf${tag(0xe0062)}`))]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.actual!.value, '1 tag character');
});

test('the Scotland flag emoji is silent', () => {
  assert.equal(run(rule, [onPage(sample(`Made in ${SCOTLAND}`))]).length, 0);
});

test('a flag plus a stray tag character elsewhere fires with a count of 1', () => {
  const findings = run(rule, [onPage(sample(`Made in ${SCOTLAND} and dyed${tag(0xe0041)}`))]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.actual!.value, '1 tag character');
});

test('a flag base with no closing cancel tag is counted as tags', () => {
  const findings = run(rule, [onPage(sample(`flag ${String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062)} end`))]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.actual!.value, '2 tag characters');
});

test('many emoji joiners and Persian non-joiners are silent', () => {
  const joined = '👨‍👩‍👧'.repeat(20);
  const persian = 'کتاب‌ها'.repeat(20);
  assert.equal(run(rule, [onPage(sample(joined), sample(persian))]).length, 0);
});

test('U+FEFF and U+2060 count together with U+200B', () => {
  const findings = run(rule, [onPage(sample('a﻿b⁠c​d'))]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.actual!.value, '3 zero-width characters');
});

test('the evidence names the count and carries none of the invisible characters', () => {
  const findings = run(rule, [onPage(sample(`hidden${tag(0xe0068)}${tag(0xe0069)}​​​text`))]);
  assert.equal(findings.length, 1);
  const { value, raw } = findings[0]!.actual!;
  assert.equal(value, '2 tag characters, 3 zero-width characters');
  assert.equal(raw, value);
  assert.doesNotMatch(value, INVISIBLE);
});

test('singular and plural wording', () => {
  const single = run(rule, [onPage(sample(`a​​​${tag(0xe0062)}`))]);
  assert.equal(single[0]!.actual!.value, '1 tag character, 3 zero-width characters');

  const one = run(rule, [onPage(sample(`a${tag(0xe0062)}${tag(0xe0063)}​﻿⁠`))]);
  assert.equal(one[0]!.actual!.value, '2 tag characters, 3 zero-width characters');

  const twoTags = run(rule, [onPage(sample(`a${tag(0xe0062)}${tag(0xe0063)}`))]);
  assert.equal(twoTags[0]!.actual!.value, '2 tag characters');
});

test('each offending sample gets its own finding', () => {
  const findings = run(rule, [onPage(sample(`one${tag(0xe0062)}`), sample('clean text'), sample(`two${tag(0xe0063)}`))]);
  assert.equal(findings.length, 2);
  assert.equal(findings[0]!.actual!.locator, 'test://page#css(.description)');
});
