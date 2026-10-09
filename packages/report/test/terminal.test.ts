import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTerminal } from '../src/index.ts';
import { audit, richResult, singleFinding } from './fixtures.ts';

const sp = (n: number): string => ' '.repeat(n);

test('full output for a mixed result matches the layout exactly', () => {
  const expected = [
    '  shop.example    48 variants    2m 41s',
    '  C page jsonld    M feed    Y –    K checkout',
    '',
    `  ✗ price.mismatch${sp(11)}2 findings`,
    `      TEE-BLU-M${sp(3)}C jsonld 35.00 USD  ≠  K checkout 39.00 USD`,
    `${sp(18)}https://shop.example/p/tee/#jsonld[0]/offers/2/price`,
    `      TOTE-NAT${sp(4)}M feed 22.00 USD  ≠  K platform 24.00 USD`,
    `${sp(18)}https://shop.example/feeds/google.xml#item[id="TOTE-NAT"]/price`,
    `  ✗ availability.mismatch${sp(4)}1 finding`,
    `      BEANIE-NVY${sp(3)}M feed in_stock  ≠  K platform out_of_stock`,
    `${sp(19)}https://shop.example/feeds/google.xml#item[id="BEANIE-NVY"]/availability`,
    `  ! shipping.undisclosed${sp(5)}1 finding`,
    `      enamel-mug${sp(3)}no surface states a shipping cost; checkout charges 6.20 USD`,
    '  ✓ 9 rules passed',
    '  – 2 rules skipped: shipping.mismatch (needs checkout), variant.unpurchasable (needs checkout)',
    '',
    '  1 collection issue',
    '      microdata parse-error: unclosed tag at line 40',
    '',
    '  3 errors, 1 warning. 2 rules over budget.',
  ].join('\n');

  // Leading newline, and the summary followed by a blank line.
  assert.equal(renderTerminal(richResult()), `\n${expected}\n\n`);
});

test('singular forms for counts, variants, surfaces, rules and issues', () => {
  const result = audit({
    counts: { products: 1, variants: 1 },
    surfaces: ['page'],
    rules: [
      { id: 'title.match', severity: 'error', summary: 's', findings: 0, budget: 0, passed: true },
      { id: 'gone.rule', severity: 'warn', summary: 's', findings: 0, budget: 0, passed: true, skipped: 'needs checkout' },
    ],
    findings: [],
    issues: [{ surface: 'page', code: 'fetch-failed', message: 'timeout' }],
    ok: true,
  });
  const out = renderTerminal(result);
  assert.match(out, /^\n {2}shop\.example {4}1 variant {4}2m 41s\n {2}C page {4}M – {4}Y – {4}K –\n/);
  assert.ok(out.includes('  ✓ 1 rule passed\n'));
  assert.ok(out.includes('  – 1 rule skipped: gone.rule (needs checkout)\n'));
  assert.ok(out.includes('  1 collection issue\n'));
  assert.ok(out.includes('      page fetch-failed: timeout\n'));
  assert.ok(out.endsWith('0 errors, 0 warnings. Within budget.\n\n'));
});

test('singular finding count and singular error/warning/note words', () => {
  const result = singleFinding({ severity: 'info', rule: 'note.only', message: 'fyi', variant: 'A-1' }, {
    rules: [{ id: 'note.only', severity: 'info', summary: 's', findings: 1, budget: null, passed: true }],
    ok: true,
  });
  const out = renderTerminal(result);
  assert.ok(out.includes('  i note.only    1 finding\n'));
  assert.ok(out.endsWith('0 errors, 0 warnings, 1 note. Within budget.\n\n'));
});

test('maxExamples truncates the list and reports the remainder', () => {
  const findings = ['A', 'B', 'C'].map((variant) => ({
    rule: 'price.mismatch',
    severity: 'error' as const,
    message: 'differs',
    product: 'tee',
    variant,
  }));
  const result = audit({
    rules: [{ id: 'price.mismatch', severity: 'error', summary: 's', findings: 3, budget: 0, passed: false }],
    findings,
    ok: false,
  });
  const out = renderTerminal(result, { maxExamples: 2 });
  assert.ok(out.includes('      A   differs\n'));
  assert.ok(out.includes('      B   differs\n'));
  assert.ok(!out.includes('      C'));
  assert.ok(out.includes('      … and 1 more\n'));
  assert.ok(out.includes(`  ✗ price.mismatch${sp(4)}3 findings\n`));
});

test('default maxExamples is five', () => {
  const findings = Array.from({ length: 7 }, (_, i) => ({
    rule: 'price.mismatch',
    severity: 'error' as const,
    message: 'differs',
    product: `p${i}`,
  }));
  const result = audit({
    rules: [{ id: 'price.mismatch', severity: 'error', summary: 's', findings: 7, budget: 0, passed: false }],
    findings,
    ok: false,
  });
  const out = renderTerminal(result);
  assert.ok(out.includes('      … and 2 more\n'));
});

test('a finding without evidence prints only the message', () => {
  const out = renderTerminal(
    singleFinding({ message: 'nothing to point at', product: 'mug' }),
  );
  assert.ok(out.includes(`      mug${sp(3)}nothing to point at\n`));
});

test('a finding with only actual prints the message and an aligned locator', () => {
  const out = renderTerminal(
    singleFinding({
      message: 'feed says sold out',
      product: 'mug',
      actual: { surface: 'feed', value: 'sold_out', raw: 'sold', locator: 'https://shop.example/f.xml#x' },
    }),
  );
  assert.ok(out.includes(`      mug${sp(3)}feed says sold out\n${sp(6 + 6)}https://shop.example/f.xml#x\n`));
});

test('ok: true ends with Within budget.', () => {
  const out = renderTerminal(audit({ ok: true }));
  assert.ok(out.endsWith('0 errors, 0 warnings. Within budget.\n\n'));
});

test('durations render as 41s, 2m 41s and 1h 02m', () => {
  const at = (finishedAt: string) => renderTerminal(audit({ finishedAt })).split('\n')[1]!;
  assert.ok(at('2026-10-09T10:00:41.000Z').endsWith('    41s'));
  assert.ok(at('2026-10-09T10:02:41.000Z').endsWith('    2m 41s'));
  assert.ok(at('2026-10-09T11:02:00.000Z').endsWith('    1h 02m'));
});

test('a finish time before the start does not produce a negative duration', () => {
  const line = renderTerminal(audit({ finishedAt: '2026-10-09T09:00:00.000Z' })).split('\n')[1]!;
  assert.ok(line.endsWith('    0s'));
});

test('subject and locator columns line up per block, with rule ids padded to the longest', () => {
  const findings = [
    {
      rule: 'a',
      severity: 'error' as const,
      message: 'm',
      product: 'p',
      variant: 'X',
      actual: { surface: 'feed' as const, value: '1', raw: '1', locator: 'L1' },
      expected: { surface: 'page' as const, value: '2', raw: '2', locator: 'L2' },
    },
    {
      rule: 'a',
      severity: 'error' as const,
      message: 'm',
      product: 'p',
      variant: 'LONGERVAR',
      actual: { surface: 'feed' as const, value: '1', raw: '1', locator: 'L1' },
      expected: { surface: 'page' as const, value: '2', raw: '2', locator: 'L2' },
    },
  ];
  const out = renderTerminal(
    audit({
      rules: [
        { id: 'a', severity: 'error', summary: 's', findings: 2, budget: 0, passed: false },
        { id: 'a.much.longer.id', severity: 'warn', summary: 's', findings: 1, budget: null, passed: true },
      ],
      findings: [...findings, { rule: 'a.much.longer.id', severity: 'warn', message: 'ok', product: 'q' }],
      ok: false,
    }),
  );
  // Rule count column: longest id (17) + 4 = 21.
  // 'a.much.longer.id' is 16 characters, so the column is 16 + 4 = 20 wide.
  assert.ok(out.includes(`  ✗ a${sp(19)}2 findings\n`));
  assert.ok(out.includes(`  ! a.much.longer.id    1 finding\n`));
  // Subject column: LONGERVAR (9) + 3 = 12.
  assert.ok(out.includes(`      X${sp(11)}M feed 1  ≠  C page 2\n`));
  assert.ok(out.includes(`      LONGERVAR   M feed 1  ≠  C page 2\n`));
});

test('color false produces no escape characters', () => {
  assert.equal(renderTerminal(richResult(), { color: false }).includes('\x1b'), false);
  assert.equal(renderTerminal(richResult()).includes('\x1b'), false);
});

test('color true produces escape sequences', () => {
  assert.equal(renderTerminal(richResult(), { color: true }).includes('\x1b'), true);
});

test('color true keeps the visible text identical to the plain output', () => {
  const plain = renderTerminal(richResult());
  const colored = renderTerminal(richResult(), { color: true });
  // eslint-disable-next-line no-control-regex
  assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ''), plain);
});

test('untrusted escape sequences in a value are neutralised', () => {
  const out = renderTerminal(
    singleFinding({ message: '\x1b[31mRED\x1b[0m', product: 'mug' }),
  );
  assert.equal(out.includes('\x1b'), false);
  assert.ok(out.includes(' [31mRED [0m'));
});

test('untrusted control characters in the locator and value are replaced with spaces', () => {
  const out = renderTerminal(
    singleFinding({
      product: 'mug',
      actual: { surface: 'feed', value: 'a\x07b', raw: 'a', locator: 'https://x.example/\x1b]0;evil\x07' },
      expected: { surface: 'page', value: '1', raw: '1', locator: 'L' },
    }),
  );
  assert.equal(/[\x00-\x08\x0b-\x1f\x7f]/.test(out.replace(/\n/g, '')), false);
  assert.ok(out.includes('M feed a b  ≠  C page 1'));
});

test('a 500-character untrusted value is cut to 199 characters plus an ellipsis', () => {
  const long = 'x'.repeat(500);
  const out = renderTerminal(singleFinding({ message: long, product: 'mug' }));
  assert.ok(out.includes(`${'x'.repeat(199)}…\n`));
  assert.equal(out.includes('x'.repeat(200)), false);
});

test('a value of exactly 200 characters is left alone', () => {
  const exact = 'y'.repeat(200);
  const out = renderTerminal(singleFinding({ message: exact, product: 'mug' }));
  assert.ok(out.includes(`${exact}\n`));
});

test('the host keeps its port when the store has one', () => {
  const out = renderTerminal(audit({ store: 'http://localhost:8080' }));
  assert.ok(out.startsWith('\n  localhost:8080    48 variants'));
});

test('a collection issue prints where it happened, and product-level subjects show the product name', () => {
  const result = singleFinding(
    { severity: 'info', rule: 'policy.return-missing', message: 'no surface gives a return policy a machine can read', product: 'shop.example/product/linen-apron' },
    {
      rules: [{ id: 'policy.return-missing', severity: 'info', summary: 's', findings: 1, budget: null, passed: true }],
      issues: [{ surface: 'page', code: 'not-found', message: 'HTTP 404', locator: 'https://shop.example/product/gone/' }],
      ok: true,
    },
  );
  const out = renderTerminal(result);
  assert.ok(out.includes('      page not-found: HTTP 404\n        https://shop.example/product/gone/\n'));
  assert.ok(out.includes('      linen-apron   no surface gives a return policy a machine can read\n'));
  assert.ok(!out.includes('shop.example/product/linen-apron'));
});

test('a rule with a non-zero budget shows it, and the summary counts rules over budget', () => {
  const result = singleFinding(
    { severity: 'error', rule: 'price.mismatch', message: 'm', variant: 'A-1' },
    { rules: [{ id: 'price.mismatch', severity: 'error', summary: 's', findings: 1, budget: 3, passed: true }], ok: true },
  );
  assert.ok(renderTerminal(result).includes('1 finding, budget 3\n'));
  const failing = singleFinding(
    { severity: 'error', rule: 'price.mismatch', message: 'm', variant: 'A-1' },
    { rules: [{ id: 'price.mismatch', severity: 'error', summary: 's', findings: 1, budget: 0, passed: false }], ok: false },
  );
  assert.ok(renderTerminal(failing).endsWith('  1 error, 0 warnings. 1 rule over budget.\n\n'));
});
