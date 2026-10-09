import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderHtml, renderJUnit, renderMarkdown, renderSarif, renderTerminal } from '../src/index.ts';
import { audit } from './fixtures.ts';

const issues = [{ surface: 'feed' as const, code: 'fetch-failed', message: '<upstream> & unavailable', locator: 'https://shop.example/feed.xml' }];
const rules = [{ id: 'price.mismatch', severity: 'error' as const, summary: 'Prices agree', findings: 0, budget: 0, passed: true }];

test('strict collection failures are explained without claiming a finding budget was exceeded', () => {
  const result = audit({ ok: false, rules, issues });
  for (const render of [renderHtml, renderMarkdown, renderTerminal]) {
    const out = render(result);
    assert.ok(out.includes('Collection issues prevent a passing audit.'));
    assert.doesNotMatch(out, /0 rules? over budget|Over budget: \./);
    assert.ok(!out.includes('Every rule is within its budget.'));
  }
  assert.ok(renderHtml(result).includes('<span class="pk">Out of register</span>'));
});

test('JUnit records a collection error and escapes diagnostics when collection prevents a pass', () => {
  const out = renderJUnit(audit({ ok: false, rules, issues }));
  assert.match(out, /tests="2" failures="0" skipped="0" time="161.000" errors="1"/);
  assert.match(out, /<testcase classname="regmark" name="collection">/);
  assert.ok(out.includes('<error message="Collection issues prevent a passing audit.">'));
  assert.ok(out.includes('&lt;upstream&gt; &amp; unavailable'));
  assert.ok(!out.includes('<upstream>'));
});

test('SARIF reports an unsuccessful invocation and retains collection diagnostics', () => {
  const { runs: [run] } = JSON.parse(renderSarif(audit({ ok: false, rules, issues })));
  assert.equal(run.invocations[0].executionSuccessful, false);
  assert.equal(run.invocations[0].toolExecutionNotifications[0].level, 'error');
  assert.equal(run.invocations[0].toolExecutionNotifications[0].properties.locator, issues[0]!.locator);
  assert.deepEqual(run.results, []);
});

test('non-strict partial collection keeps a passing verdict and still exposes diagnostics', () => {
  const result = audit({ rules, issues });
  assert.ok(renderMarkdown(result).includes('Every rule is within its budget.'));
  const junit = renderJUnit(result);
  assert.ok(!junit.includes('<error'));
  assert.ok(junit.includes('<system-err>feed fetch-failed:'));
  const { runs: [run] } = JSON.parse(renderSarif(result));
  assert.equal(run.invocations[0].executionSuccessful, true);
  assert.equal(run.invocations[0].toolExecutionNotifications[0].level, 'warning');
});

test('an audit that reads no products cannot become a passing JUnit or SARIF report', () => {
  const result = audit({ ok: false, rules, counts: { products: 0, variants: 0 } });
  assert.ok(renderJUnit(result).includes('<error message="No product was read, so nothing was checked.">'));
  const { runs: [run] } = JSON.parse(renderSarif(result));
  assert.equal(run.invocations[0].executionSuccessful, false);
  assert.equal(run.invocations[0].toolExecutionNotifications[0].descriptor.id, 'nothing-read');
});
