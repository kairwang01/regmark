import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJUnit } from '../src/index.ts';
import { audit, richResult, singleFinding } from './fixtures.ts';

test('the testsuite attributes count rules, failures and skips, and time has three decimals', () => {
  const out = renderJUnit(richResult());
  assert.ok(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(
    out.includes('<testsuite name="regmark" tests="14" failures="2" skipped="2" time="161.000">'),
    out,
  );
  assert.ok(out.endsWith('</testsuite>\n'));
});

test('a failed rule gets a failure element with the count, budget and one line per finding', () => {
  const out = renderJUnit(richResult());
  assert.ok(out.includes('<testcase classname="regmark" name="price.mismatch">\n    <failure message="2 findings, budget 0">\n'));
  assert.ok(
    out.includes(
      'TEE-BLU-M: jsonld says 35.00 USD, checkout says 39.00 USD\n' +
        'TOTE-NAT: feed says 22.00 USD, platform says 24.00 USD\n    </failure>',
    ),
    out,
  );
});

test('a skipped rule gets a skipped element with the reason', () => {
  const out = renderJUnit(richResult());
  assert.ok(
    out.includes(
      '<testcase classname="regmark" name="shipping.mismatch">\n    <skipped message="needs checkout"/>\n  </testcase>',
    ),
  );
});

test('a rule with findings that passed gets system-out and no failure', () => {
  const out = renderJUnit(richResult());
  assert.ok(
    out.includes(
      '<testcase classname="regmark" name="shipping.undisclosed">\n    <system-out>\n' +
        'enamel-mug: no surface states a shipping cost; checkout charges 6.20 USD\n    </system-out>\n  </testcase>',
    ),
  );
  const block = out.slice(out.indexOf('name="shipping.undisclosed"'), out.indexOf('</testcase>', out.indexOf('name="shipping.undisclosed"')));
  assert.equal(block.includes('<failure'), false);
});

test('a clean rule gets an empty self-closing testcase', () => {
  const out = renderJUnit(richResult());
  assert.ok(out.includes('  <testcase classname="regmark" name="title.match"/>\n'));
});

test('a message with markup characters is escaped and the document stays well-formed', () => {
  const out = renderJUnit(
    singleFinding({ message: '<script>&"\'', product: 'mug' }),
  );
  assert.ok(out.includes('mug: &lt;script&gt;&amp;&quot;&apos;'), out);

  // Every '<' must open a tag or declaration we emitted, and every '&' must start an entity.
  const withoutTags = out.replace(/<\?[^>]*\?>|<\/?[A-Za-z][^>]*>/g, '');
  assert.equal(withoutTags.includes('<'), false);
  assert.equal(withoutTags.includes('>'), false);
  assert.equal(/&(?!(amp|lt|gt|quot|apos);)/.test(out), false);
});

test('a message with a script tag does not produce an element named script', () => {
  const out = renderJUnit(singleFinding({ message: '<script>alert(1)</script>', product: 'mug' }));
  assert.equal(/<script/.test(out), false);
});

test('control characters that XML 1.0 forbids are dropped', () => {
  const out = renderJUnit(singleFinding({ message: 'a\x01b\x1bc\x7fd\te', product: 'mug' }));
  assert.ok(out.includes('mug: ab' + 'c' + 'd\te'), JSON.stringify(out));
  // eslint-disable-next-line no-control-regex
  assert.equal(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(out), false);
});

test('an empty result still produces a valid suite', () => {
  const out = renderJUnit(audit());
  assert.ok(out.includes('<testsuite name="regmark" tests="0" failures="0" skipped="0" time="161.000">'));
});


test('XML character boundaries preserve legal Unicode and drop isolated surrogates', () => {
  const allowed = '\t\n\r ~\u00A0\uD7FF\uE000\uFFFD\u{10000}\u{1F6D2}\u{10FFFF}中文é';
  const out = renderJUnit(singleFinding({ message: allowed, product: 'mug' }));
  assert.ok(out.includes(`mug: ${allowed}`), JSON.stringify(out));

  // Separators keep isolated surrogate code units from forming a valid pair.
  const forbidden = '\u0000a\u0008b\u000Bc\u000Cd\u000Ee\u001Ff\u007Fg\u009Fh\uD800i\uDBFFj\uDC00k\uDFFFl\uFFFEm\uFFFFn';
  const cleaned = renderJUnit(singleFinding({ message: forbidden, product: 'mug' }));
  assert.ok(cleaned.includes('mug: abcdefghijklmn'), JSON.stringify(cleaned));
});
