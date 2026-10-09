import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditResult, CollectIssue, Evidence, Finding, RuleSummary } from '@regmark/core';
import { renderMarkdown } from '../src/markdown.ts';
import { audit, richResult, singleFinding } from './fixtures.ts';

const TITLE_OUT = '## Regmark: out of register';

const ev = (surface: Evidence['surface'], value: string): Evidence => ({
  surface,
  value,
  raw: value,
  locator: 'https://shop.example/p#x',
});

function oneRule(rule: Partial<RuleSummary> = {}, findings: Finding[] = [], overrides: Partial<AuditResult> = {}): AuditResult {
  const summary: RuleSummary = {
    id: 'price.mismatch',
    severity: 'error',
    summary: 'Price agrees',
    findings: findings.length,
    budget: 0,
    passed: findings.length === 0,
    ...rule,
  };
  return audit({ rules: [summary], findings, ok: summary.passed, ...overrides });
}

function manyFindings(n: number): Finding[] {
  return Array.from({ length: n }, (_, i) => ({
    rule: 'price.mismatch',
    severity: 'error' as const,
    message: `differs ${i}`,
    product: 'mug',
    variant: `V-${i}`,
  }));
}

/** Number of pipes in a line that are not escaped with a backslash. */
function separators(line: string): number {
  return line.replace(/\\\|/g, '').split('|').length - 1;
}

function tableRows(out: string): string[] {
  return out.split('\n').filter((line) => line.startsWith('|'));
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The checks shared by every hostile-input test. */
function assertInert(out: string, detailsBlocks: number): void {
  assert.ok(!out.includes('<img'), 'no raw <img');
  assert.equal(countOf(out, '</details>'), detailsBlocks, 'only the real closers');
  const headings = out.split('\n').filter((line) => line.startsWith('## '));
  assert.deepEqual(headings, [TITLE_OUT], 'no injected heading');
  for (const row of tableRows(out)) {
    const n = separators(row);
    assert.ok(n === 4 || n === 5, `table row has ${n} separators: ${row}`);
  }
}

test('full output for the rich fixture matches the layout exactly', () => {
  const expected = [
    '## Regmark: out of register',
    '',
    '**3 errors, 1 warning** across 48 variants of 12 products on `shop.example`. 2 rules over budget.',
    '',
    'Surfaces read: **C** page, jsonld · **M** feed · **Y** none · **K** checkout',
    '',
    '| | Rule | Findings | Budget |',
    '|:-:|---|--:|---|',
    '| ✗ | `price.mismatch` | 2 | 0 |',
    '| ✗ | `availability.mismatch` | 1 | 0 |',
    '| ! | `shipping.undisclosed` | 1 | no limit |',
    '| ✓ | 9 rules clean | | |',
    '| – | `shipping.mismatch` | | needs checkout |',
    '| – | `variant.unpurchasable` | | needs checkout |',
    '',
    '<details>',
    '<summary><code>price.mismatch</code> · 2 findings · Price agrees with checkout</summary>',
    '',
    '| Subject | Says | Datum |',
    '|---|---|---|',
    '| `TEE-BLU-M` | **C** jsonld `35.00 USD` | **K** checkout `39.00 USD` |',
    '| `TOTE-NAT` | **M** feed `22.00 USD` | **K** platform `24.00 USD` |',
    '',
    '</details>',
    '',
    '<details>',
    '<summary><code>availability.mismatch</code> · 1 finding · Availability agrees with platform</summary>',
    '',
    '| Subject | Says | Datum |',
    '|---|---|---|',
    '| `BEANIE-NVY` | **M** feed `in_stock` | **K** platform `out_of_stock` |',
    '',
    '</details>',
    '',
    '<details>',
    '<summary><code>shipping.undisclosed</code> · 1 finding · Shipping cost is stated somewhere</summary>',
    '',
    '| Subject | Says | Datum |',
    '|---|---|---|',
    '| `enamel-mug` | `no surface states a shipping cost; checkout charges 6.20 USD` | |',
    '',
    '</details>',
    '',
    '### Collection issues',
    '',
    '- `microdata parse-error` `unclosed tag at line 40`',
    '',
    '<sub>regmark 0.1.0 · shop read in 2m 41s</sub>',
    '',
  ].join('\n');
  assert.equal(renderMarkdown(richResult()), expected);
});

test('an ok result has the in-register title, the budget sentence and no details', () => {
  const out = renderMarkdown(
    audit({
      rules: [{ id: 'title.match', severity: 'error', summary: 'Title', findings: 0, budget: 0, passed: true }],
      ok: true,
    }),
  );
  assert.ok(out.startsWith('## Regmark: in register\n'));
  assert.ok(out.includes('Every rule is within its budget.'));
  assert.ok(!out.includes('<details>'));
  assert.ok(!out.includes('over budget'));
});

test('singular forms: error, warning, variant, product, rule over budget', () => {
  const out = renderMarkdown(singleFinding({}, { counts: { products: 1, variants: 1 } }));
  assert.ok(out.includes('**1 error, 0 warnings** across 1 variant of 1 product on `shop.example`. 1 rule over budget.'));
  assert.ok(out.includes('<summary><code>price.mismatch</code> · 1 finding · one rule</summary>'));
});

test('plural forms: errors, warnings, notes, variants, products, rules over budget', () => {
  const out = renderMarkdown(
    audit({
      counts: { products: 2, variants: 5 },
      rules: [
        { id: 'a.one', severity: 'error', summary: 's', findings: 1, budget: 0, passed: false },
        { id: 'a.two', severity: 'warn', summary: 's', findings: 4, budget: null, passed: true },
      ],
      findings: [
        { rule: 'a.one', severity: 'error', message: 'm', product: 'p' },
        { rule: 'a.two', severity: 'warn', message: 'm', product: 'p' },
        { rule: 'a.two', severity: 'warn', message: 'm', product: 'q' },
        { rule: 'a.two', severity: 'info', message: 'm', product: 'q' },
        { rule: 'a.two', severity: 'info', message: 'm', product: 'r' },
      ],
      ok: false,
    }),
  );
  assert.ok(
    out.includes('**1 error, 2 warnings, 2 notes** across 5 variants of 2 products on `shop.example`. 1 rule over budget.'),
    out,
  );
  assert.ok(out.includes('<summary><code>a.two</code> · 4 findings ·'));
});

test('a single note reads as singular', () => {
  const out = renderMarkdown(singleFinding({ severity: 'info' }, { ok: true }));
  assert.ok(out.includes('**0 errors, 0 warnings, 1 note**'), out);
});

test('a single warning reads as singular', () => {
  const out = renderMarkdown(singleFinding({ severity: 'warn' }));
  assert.ok(out.includes('**0 errors, 1 warning**'), out);
});

test('an info finding is only counted as a note when present', () => {
  const out = renderMarkdown(richResult());
  assert.ok(out.includes('**3 errors, 1 warning** across'));
  assert.ok(!out.includes('note'));
});

test('one clean rule is folded and singular', () => {
  const out = renderMarkdown(
    audit({
      rules: [
        { id: 'a.bad', severity: 'error', summary: 's', findings: 1, budget: 0, passed: false },
        { id: 'a.good', severity: 'error', summary: 's', findings: 0, budget: 0, passed: true },
      ],
      findings: [{ rule: 'a.bad', severity: 'error', message: 'm', product: 'p' }],
      ok: false,
    }),
  );
  assert.ok(out.includes('| ✓ | 1 rule clean | | |'));
});

test('clean row sits after flagged rules and before skipped ones', () => {
  const out = renderMarkdown(
    audit({
      rules: [
        { id: 'a.skip', severity: 'error', summary: 's', findings: 0, budget: 0, passed: true, skipped: 'needs checkout' },
        { id: 'a.clean', severity: 'error', summary: 's', findings: 0, budget: 0, passed: true },
        { id: 'a.flag', severity: 'error', summary: 's', findings: 1, budget: 2, passed: true },
        { id: 'a.clean2', severity: 'error', summary: 's', findings: 0, budget: 0, passed: true },
      ],
      findings: [{ rule: 'a.flag', severity: 'error', message: 'm', product: 'p' }],
      ok: true,
    }),
  );
  const rows = tableRows(out);
  const flag = rows.findIndex((r) => r.includes('`a.flag`'));
  const clean = rows.findIndex((r) => r.includes('2 rules clean'));
  const skipped = rows.findIndex((r) => r.includes('`a.skip`'));
  assert.ok(flag >= 0 && clean > flag && skipped > clean, rows.join('\n'));
  assert.ok(out.includes('| ! | `a.flag` | 1 | 2 |'));
});

test('no clean row is written when every rule has findings or is skipped', () => {
  const out = renderMarkdown(richResult({ rules: richResult().rules.slice(0, 3) }));
  assert.ok(!out.includes('rules clean'));
  assert.ok(!out.includes('rule clean'));
});

test('a skipped rule shows its reason in the budget column and no count', () => {
  const out = renderMarkdown(
    audit({
      rules: [
        { id: 'shipping.mismatch', severity: 'error', summary: 's', findings: 0, budget: 0, passed: true, skipped: 'needs checkout' },
      ],
      ok: true,
    }),
  );
  assert.ok(out.includes('| – | `shipping.mismatch` | | needs checkout |'));
  assert.ok(!out.includes('<details>'));
});

test('a rule with no limit shows "no limit" and a null budget', () => {
  const out = renderMarkdown(oneRule({ budget: null, passed: true }, [{ rule: 'price.mismatch', severity: 'error', message: 'm', product: 'p' }]));
  assert.ok(out.includes('| ! | `price.mismatch` | 1 | no limit |'));
});

test('maxPerRule defaults to 10 and the rest are summarised', () => {
  const out = renderMarkdown(oneRule({ findings: 12 }, manyFindings(12)));
  const rows = tableRows(out).filter((r) => r.includes('`V-'));
  assert.equal(rows.length, 10);
  assert.ok(out.includes('\n\n…and 2 more in the JSON report.\n\n</details>'));
});

test('maxPerRule option changes how many findings are listed', () => {
  const out = renderMarkdown(oneRule({ findings: 3 }, manyFindings(3)), { maxPerRule: 1 });
  assert.ok(out.includes('`V-0`'));
  assert.ok(!out.includes('`V-1`'));
  assert.ok(out.includes('…and 2 more in the JSON report.'));
});

test('no "more" line when the findings fit', () => {
  const out = renderMarkdown(oneRule({ findings: 10 }, manyFindings(10)));
  assert.ok(!out.includes('more in the JSON report'));
});

test('a finding with no evidence is shown by its message', () => {
  const out = renderMarkdown(singleFinding({ message: 'plain message', variant: 'SKU-1' }));
  assert.ok(out.includes('| `SKU-1` | `plain message` | |'));
});

test('a finding with only actual evidence is shown by its message', () => {
  const out = renderMarkdown(singleFinding({ message: 'only actual', actual: ev('feed', '1.00 USD') }));
  assert.ok(out.includes('| `mug` | `only actual` | |'));
  assert.ok(!out.includes('1.00 USD'));
});

test('a finding with only expected evidence is shown by its message', () => {
  const out = renderMarkdown(singleFinding({ message: 'only expected', expected: ev('platform', '2.00 USD') }));
  assert.ok(out.includes('| `mug` | `only expected` | |'));
});

test('the help paragraph appears when the rule has one and is absent otherwise', () => {
  const withHelp = renderMarkdown(
    oneRule({ help: 'Usually a cache. Purge it.' }, [{ rule: 'price.mismatch', severity: 'error', message: 'm', product: 'p' }]),
  );
  assert.ok(withHelp.includes('</summary>\n\nUsually a cache. Purge it.\n\n| Subject | Says | Datum |'));

  const without = renderMarkdown(oneRule({}, [{ rule: 'price.mismatch', severity: 'error', message: 'm', product: 'p' }]));
  assert.ok(without.includes('</summary>\n\n| Subject | Says | Datum |'));
});

test('a plates line with an empty plate says none', () => {
  const out = renderMarkdown(audit({ surfaces: ['page', 'checkout'], ok: true }));
  assert.ok(out.includes('Surfaces read: **C** page · **M** none · **Y** none · **K** checkout'));
});

test('a result with no surfaces says none four times', () => {
  const out = renderMarkdown(audit({ surfaces: [], ok: true }));
  assert.ok(out.includes('Surfaces read: **C** none · **M** none · **Y** none · **K** none'));
  assert.equal(countOf(out, 'none'), 4);
});

test('collection issues appear with a section when present, and not otherwise', () => {
  const issue: CollectIssue = { surface: 'feed', code: 'fetch-failed', message: 'HTTP 503', locator: 'https://shop.example/feed.xml' };
  const withIssues = renderMarkdown(audit({ issues: [issue], ok: true }));
  assert.ok(
    withIssues.includes(
      '### Collection issues\n\n- `feed fetch-failed` `HTTP 503` `https://shop.example/feed.xml`\n\n<sub>',
    ),
  );
  const without = renderMarkdown(audit({ ok: true }));
  assert.ok(!without.includes('Collection issues'));
});

test('more than 20 collection issues are cut with an "and N more" line', () => {
  const issues: CollectIssue[] = Array.from({ length: 23 }, (_, i) => ({
    surface: 'page',
    code: 'parse-error',
    message: `problem ${i}`,
  }));
  const out = renderMarkdown(audit({ issues, ok: true }));
  const bullets = out.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(bullets.length, 21);
  assert.equal(bullets[20], '- …and 3 more');
});

test('a collection issue locator containing a pipe stays inside its code span', () => {
  const out = renderMarkdown(
    audit({ issues: [{ surface: 'page', code: 'x', message: 'y', locator: 'https://shop.example/a|b' }], ok: true }),
  );
  assert.ok(out.includes('`https://shop.example/a\\|b`'));
});

test('output ends with exactly one newline and no line has trailing whitespace', () => {
  for (const out of [renderMarkdown(richResult()), renderMarkdown(audit({ ok: true }))]) {
    assert.ok(out.endsWith('\n'));
    assert.ok(!out.endsWith('\n\n'));
    for (const line of out.split('\n')) {
      assert.ok(!/[ \t]$/.test(line), `trailing whitespace: "${line}"`);
    }
  }
});

test('footer reports the version and the duration', () => {
  const hours = renderMarkdown(audit({ finishedAt: '2026-10-09T11:02:00.000Z', ok: true }));
  assert.ok(hours.endsWith('<sub>regmark 0.1.0 · shop read in 1h 02m</sub>\n'));
  const seconds = renderMarkdown(audit({ finishedAt: '2026-10-09T10:00:41.000Z', ok: true }));
  assert.ok(seconds.endsWith('<sub>regmark 0.1.0 · shop read in 41s</sub>\n'));
});

test('a backtick, a pipe and an img tag in a variant name stay inside one code span', () => {
  const variant = '`x` | <img src=x onerror=1>';
  const out = renderMarkdown(singleFinding({ variant, message: 'm' }));
  assert.ok(out.includes('`ˋxˋ \\| ‹img src=x onerror=1›`'), out);
  assertInert(out, 1);
  assert.ok(out.includes('| `ˋxˋ \\| ‹img src=x onerror=1›` | `m` | |'));
});

test('a message with a newline and a fake heading stays on one row', () => {
  const out = renderMarkdown(singleFinding({ message: 'first line\n## fake heading' }));
  assert.ok(out.includes('`first line ## fake heading`'));
  assertInert(out, 1);
});

test('a value containing a closing details tag cannot close the block', () => {
  const out = renderMarkdown(
    singleFinding({
      variant: 'V1',
      expected: ev('platform', '</details>'),
      actual: ev('feed', '1.00 USD'),
    }),
  );
  assert.ok(out.includes('`‹/details›`'));
  assertInert(out, 1);
});

test('markdown links and images in a value are shown as code, not rendered', () => {
  const out = renderMarkdown(
    singleFinding({
      expected: ev('platform', '[click](http://evil.example)'),
      actual: ev('feed', '![img](http://evil.example/x.png)'),
    }),
  );
  assert.ok(out.includes('`[click](http://evil.example)`'));
  assert.ok(out.includes('`![img](http://evil.example/x.png)`'));
  assertInert(out, 1);
});

test('a mention is shown inside a code span only', () => {
  const out = renderMarkdown(
    singleFinding({
      expected: ev('platform', '@octocat'),
      actual: ev('feed', '1.00 USD'),
    }),
  );
  assert.ok(out.includes('`@octocat`'));
  assert.ok(!/(^|[^`])@octocat/.test(out));
  assertInert(out, 1);
});

test('a 500 character value is cut to 160 characters plus an ellipsis', () => {
  const out = renderMarkdown(
    singleFinding({ expected: ev('platform', 'a'.repeat(500)), actual: ev('feed', '1.00 USD') }),
  );
  assert.ok(out.includes(`\`${'a'.repeat(160)}…\``));
  assert.ok(!out.includes('a'.repeat(161)));
  assertInert(out, 1);
});

test('a control character and U+2028 are flattened to spaces', () => {
  const out = renderMarkdown(
    singleFinding({ expected: ev('platform', 'x\u0007y z'), actual: ev('feed', '1.00 USD') }),
  );
  assert.ok(out.includes('`x y z`'));
  assert.ok(!out.includes('\u0007'));
  assert.ok(!out.includes(' '));
  assertInert(out, 1);
});

test('an unparseable store URL is shown as code, raw', () => {
  const out = renderMarkdown(audit({ store: 'not a url', ok: true }));
  assert.ok(out.includes('on `not a url`.'));
});

test('a store with a port keeps the port in the host', () => {
  const out = renderMarkdown(audit({ store: 'http://localhost:8080/', ok: true }));
  assert.ok(out.includes('on `localhost:8080`.'));
});
