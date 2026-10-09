// The report for a pull-request comment and the Actions job summary. GitHub
// renders it, so it must survive a hostile shop: every string that came from
// the audited site is wrapped in a code span by code(), which turns the few
// characters that could end the span, break a table or open HTML into look-alikes.

import { PLATE_OF } from '@regmark/core';
import type { AuditResult, Evidence, Finding, Plate, RuleSummary, Surface } from '@regmark/core';
import { durationMs, subjectOf } from './shared.ts';

export type MarkdownOptions = {
  /** How many findings to list per rule before summarising the rest. Default 10. */
  maxPerRule?: number;
};

const DEFAULT_MAX_PER_RULE = 10;
const MAX_ISSUES = 20;
const CODE_MAX = 160;
const PLATES: readonly Plate[] = ['C', 'M', 'Y', 'K'];

// Control characters and the two Unicode line separators. GitHub treats the
// separators as line breaks in some renderers, so they are flattened too.
const CONTROL_OR_SEPARATOR = /[\u0000-\u001f\u007f\u2028\u2029]/g;

/**
 * Untrusted text as an inline code span. Each replacement closes a way the
 * text could escape the span: a backtick ends it, a pipe splits a table cell,
 * and angle brackets could start an HTML tag in renderers that parse inside code.
 */
function code(text: string, max = CODE_MAX): string {
  const flat = text.replace(CONTROL_OR_SEPARATOR, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  const cut = chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
  if (cut === '') return '`–`';
  const safe = cut.replace(/`/g, 'ˋ').replace(/\|/g, '\\|').replace(/</g, '‹').replace(/>/g, '›');
  return `\`${safe}\``;
}

/** Tool-written text that is not in a code span: collapse whitespace only. */
function text(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Tool-written text that sits in a table cell: also keep the pipes from splitting it. */
function cell(value: string): string {
  return text(value).replace(/\|/g, '\\|');
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function hostOf(store: string): string {
  try {
    return new URL(store).host;
  } catch {
    return store;
  }
}

// Same shape as the terminal reporter, so the two read alike.
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

const plateOf = (surface: Surface): string => PLATE_OF[surface] ?? '–';

function says(evidence: Evidence): string {
  return `**${plateOf(evidence.surface)}** ${cell(evidence.surface)} ${code(evidence.value)}`;
}

function findingRow(finding: Finding): string {
  const subject = code(subjectOf(finding));
  // Only a pair of statements reads as "says X, datum says Y". Anything else
  // is shown as its message, which is the only thing the finding can say.
  if (finding.expected && finding.actual) {
    return `| ${subject} | ${says(finding.actual)} | ${says(finding.expected)} |`;
  }
  return `| ${subject} | ${code(finding.message)} | |`;
}

function ruleDetails(rule: RuleSummary, findings: readonly Finding[], maxPerRule: number): string {
  const matches = findings.filter((f) => f.rule === rule.id);
  const shown = matches.slice(0, maxPerRule);
  const lines = [
    '<details>',
    `<summary><code>${text(rule.id)}</code> · ${plural(rule.findings, 'finding')} · ${text(rule.summary)}</summary>`,
    '',
  ];
  if (rule.help) lines.push(text(rule.help), '');
  lines.push('| Subject | Says | Datum |', '|---|---|---|');
  for (const finding of shown) lines.push(findingRow(finding));
  // A blank line keeps this from being read as one more table row.
  const rest = matches.length - shown.length;
  if (rest > 0) lines.push('', `…and ${rest} more in the JSON report.`);
  lines.push('', '</details>');
  return lines.join('\n');
}

/**
 * GitHub-flavoured Markdown for a pull-request comment or a job summary.
 * Sections are separated by one blank line and the output ends with one newline.
 */
export function renderMarkdown(result: AuditResult, options: MarkdownOptions = {}): string {
  const maxPerRule = Math.max(0, Math.floor(options.maxPerRule ?? DEFAULT_MAX_PER_RULE));
  const sections: string[] = [];

  sections.push(result.ok ? '## Regmark: in register' : '## Regmark: out of register');

  const tally = (severity: Finding['severity']): number => result.findings.filter((f) => f.severity === severity).length;
  const errors = tally('error');
  const warnings = tally('warn');
  const notes = tally('info');
  const counts = [plural(errors, 'error'), plural(warnings, 'warning')];
  if (notes > 0) counts.push(plural(notes, 'note'));

  const overBudget = result.rules.filter((r) => r.skipped === undefined && !r.passed).length;
  const verdict = result.ok ? 'Every rule is within its budget.' : `${plural(overBudget, 'rule')} over budget.`;
  sections.push(
    `**${counts.join(', ')}** across ${plural(result.counts.variants, 'variant')} of ` +
      `${plural(result.counts.products, 'product')} on ${code(hostOf(result.store))}. ${verdict}`,
  );

  // An empty plate is printed too: knowing the checkout was never read changes how to read the rest.
  const plates = PLATES.map((plate) => {
    const mine = result.surfaces.filter((s) => PLATE_OF[s] === plate).map(cell);
    return `**${plate}** ${mine.length > 0 ? mine.join(', ') : 'none'}`;
  });
  sections.push(`Surfaces read: ${plates.join(' · ')}`);

  const skipped = result.rules.filter((r) => r.skipped !== undefined);
  const flagged = result.rules.filter((r) => r.skipped === undefined && r.findings > 0);
  const clean = result.rules.filter((r) => r.skipped === undefined && r.findings === 0);

  const rows: string[] = [];
  for (const rule of flagged) {
    const mark = rule.passed ? '!' : '✗';
    const budget = rule.budget === null ? 'no limit' : String(rule.budget);
    rows.push(`| ${mark} | ${code(rule.id)} | ${rule.findings} | ${budget} |`);
  }
  // Clean rules are folded into one row: the table is for what needs attention.
  if (clean.length > 0) rows.push(`| ✓ | ${plural(clean.length, 'rule')} clean | | |`);
  for (const rule of skipped) {
    rows.push(`| – | ${code(rule.id)} | | ${cell(rule.skipped ?? '')} |`);
  }
  if (rows.length > 0) {
    sections.push(['| | Rule | Findings | Budget |', '|:-:|---|--:|---|', ...rows].join('\n'));
  }

  for (const rule of flagged) {
    sections.push(ruleDetails(rule, result.findings, maxPerRule));
  }

  if (result.issues.length > 0) {
    const lines = ['### Collection issues', ''];
    for (const issue of result.issues.slice(0, MAX_ISSUES)) {
      let line = `- ${code(`${issue.surface} ${issue.code}`)} ${code(issue.message)}`;
      if (issue.locator) line += ` ${code(issue.locator)}`;
      lines.push(line);
    }
    const rest = result.issues.length - MAX_ISSUES;
    if (rest > 0) lines.push(`- …and ${rest} more`);
    sections.push(lines.join('\n'));
  }

  sections.push(
    `<sub>regmark ${cell(result.tool.version)} · shop read in ${formatDuration(durationMs(result))}</sub>`,
  );

  return `${sections.join('\n\n')}\n`;
}
