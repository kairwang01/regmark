import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJson } from '../src/index.ts';
import { richResult } from './fixtures.ts';

test('JSON output round-trips to the same AuditResult', () => {
  const result = richResult();
  assert.deepEqual(JSON.parse(renderJson(result)), result);
});

test('JSON output ends with a single newline and is two-space indented', () => {
  const out = renderJson(richResult());
  assert.ok(out.endsWith('}\n'));
  assert.ok(out.startsWith('{\n  "schema": "regmark.audit/v0"'));
});
