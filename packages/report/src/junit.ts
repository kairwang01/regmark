import type { AuditResult, RuleSummary } from '@regmark/core';
import { collectionFailure, durationMs, findingSentence } from './shared.ts';

// XML 1.0 forbids most control characters even as escaped text, so they are
// dropped before escaping rather than replaced. DEL and the C1 range (0x7F-0x9F)
// are legal in XML 1.0 but are dropped too: parsers and terminals handle them
// inconsistently, and a page has no business sending them.
const ILLEGAL_XML = /[^\t\n\r\x20-\x7E\u00A0-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

function xml(text: string): string {
  return text
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type Kind = 'skipped' | 'failure' | 'output' | 'empty';

function kindOf(rule: RuleSummary, lines: string[]): Kind {
  if (rule.skipped !== undefined) return 'skipped';
  if (!rule.passed) return 'failure';
  if (lines.length > 0) return 'output';
  return 'empty';
}

export function renderJUnit(result: AuditResult): string {
  const linesByRule = new Map<string, string[]>();
  for (const finding of result.findings) {
    const bucket = linesByRule.get(finding.rule) ?? [];
    bucket.push(findingSentence(finding));
    linesByRule.set(finding.rule, bucket);
  }

  const cases: string[] = [];
  let failures = 0;
  let skipped = 0;
  for (const rule of result.rules) {
    const lines = linesByRule.get(rule.id) ?? [];
    const kind = kindOf(rule, lines);
    const name = `classname="regmark" name="${xml(rule.id)}"`;
    const text = lines.map(xml).join('\n');

    if (kind === 'skipped') {
      skipped += 1;
      cases.push(
        `  <testcase ${name}>`,
        `    <skipped message="${xml(rule.skipped ?? '')}"/>`,
        '  </testcase>',
      );
    } else if (kind === 'failure') {
      failures += 1;
      const budget = rule.budget === null ? 'unlimited' : String(rule.budget);
      cases.push(
        `  <testcase ${name}>`,
        `    <failure message="${xml(`${rule.findings} findings, budget ${budget}`)}">`,
        text,
        '    </failure>',
        '  </testcase>',
      );
    } else if (kind === 'output') {
      cases.push(`  <testcase ${name}>`, '    <system-out>', text, '    </system-out>', '  </testcase>');
    } else {
      cases.push(`  <testcase ${name}/>`);
    }
  }

  const collection = collectionFailure(result);
  const diagnostics = result.issues.map((issue) =>
    `${issue.surface} ${issue.code}: ${issue.message}${issue.locator ? ` (${issue.locator})` : ''}`,
  ).join('\n');
  if (collection) {
    cases.push(
      '  <testcase classname="regmark" name="collection">',
      `    <error message="${xml(collection)}">${xml(diagnostics || collection)}</error>`,
      '  </testcase>',
    );
  }
  if (diagnostics) cases.push(`  <system-err>${xml(diagnostics)}</system-err>`);

  const seconds = (durationMs(result) / 1000).toFixed(3);
  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="regmark" tests="${result.rules.length + (collection ? 1 : 0)}" failures="${failures}" skipped="${skipped}" time="${seconds}"${collection ? ' errors="1"' : ''}>`,
  ];
  return `${[...head, ...cases, '</testsuite>'].join('\n')}\n`;
}
