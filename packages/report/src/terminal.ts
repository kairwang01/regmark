import { styleText } from 'node:util';
import { PLATE_OF } from '@regmark/core';
import type { AuditResult, Plate, Severity, Surface } from '@regmark/core';
import { durationMs, findingSentence, subjectOf } from './shared.ts';

export type TerminalOptions = { color?: boolean; maxExamples?: number };

type Style = 'red' | 'yellow' | 'green' | 'dim' | 'bold' | 'cyan' | 'magenta';

// The four plates, in press order. Each surface is printed with the letter of
// the plate it belongs to, so a line reads as "this plate against that one".
const PLATES: readonly Plate[] = ['C', 'M', 'Y', 'K'];
const PLATE_STYLE: Readonly<Record<Plate, Style>> = { C: 'cyan', M: 'magenta', Y: 'yellow', K: 'bold' };
const plateOf = (surface: Surface): Plate => PLATE_OF[surface] ?? 'C';

const MARK: Readonly<Record<Severity, string>> = { error: '✗', warn: '!', info: 'i' };
const MARK_STYLE: Readonly<Record<Severity, Style | undefined>> = {
  error: 'red',
  warn: 'yellow',
  info: undefined,
};

// Everything from a page is untrusted. Control characters, including ESC,
// become spaces so a page cannot drive the terminal; ranges are cut to keep one
// hostile value from pushing the table out of shape. The C1 range (0x80-0x9F)
// is stripped too, since some terminals read U+009B as a CSI introducer.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_LEN = 200;

function clean(text: string): string {
  return text.replace(CONTROL, ' ');
}

function untrusted(text: string): string {
  const cleaned = clean(text);
  const chars = Array.from(cleaned);
  return chars.length > MAX_LEN ? `${chars.slice(0, MAX_LEN - 1).join('')}…` : cleaned;
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function hostOf(store: string): string {
  try {
    return new URL(store).host;
  } catch {
    return untrusted(store);
  }
}

// Shows the duration in the largest unit that is non-zero, with the smaller
// unit zero-padded only once a larger unit precedes it.
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

const INDENT = '      ';
const LABEL_INDENT = '  ';

/**
 * Layout: a leading blank line, the header, a blank line, the rule blocks, then
 * the passed/skipped lines, an optional issues section, a blank line, the
 * summary, and a trailing blank line. The string therefore starts with "\n" and
 * ends with "summary\n\n", which keeps it apart from the next prompt.
 */
export function renderTerminal(result: AuditResult, options: TerminalOptions = {}): string {
  const color = options.color ?? false;
  const max = Math.max(0, Math.floor(options.maxExamples ?? 5));
  const paint = (style: Style, text: string): string =>
    color ? styleText(style, text, { validateStream: false }) : text;

  const tag = (surface: Surface): string => `${paint(PLATE_STYLE[plateOf(surface)], plateOf(surface))} ${untrusted(surface)}`;

  const header =
    `${LABEL_INDENT}${hostOf(result.store)}` +
    `    ${plural(result.counts.variants, 'variant')}` +
    `    ${formatDuration(durationMs(result))}`;
  // Which surfaces were read, grouped by plate. An empty plate is shown too:
  // knowing the checkout was never consulted changes how to read the rest.
  const plates =
    LABEL_INDENT +
    PLATES.map((plate) => {
      const mine = result.surfaces.filter((s) => plateOf(s) === plate);
      return `${paint(PLATE_STYLE[plate], plate)} ${mine.length ? mine.map(untrusted).join(' ') : '–'}`;
    }).join('    ');

  const withFindings = result.rules.filter((rule) => rule.findings > 0);
  const idWidth = withFindings.reduce((longest, rule) => Math.max(longest, rule.id.length), 0) + 4;

  const body: string[] = [];
  for (const rule of withFindings) {
    const marker = paint(MARK_STYLE[rule.severity] ?? 'dim', MARK[rule.severity]);
    const allowance = rule.budget !== null && rule.budget > 0 ? `, budget ${rule.budget}` : '';
    body.push(`${LABEL_INDENT}${marker} ${rule.id.padEnd(idWidth)}${plural(rule.findings, 'finding')}${allowance}`);

    const shown = result.findings.filter((f) => f.rule === rule.id).slice(0, max);
    const subjects = shown.map((f) => untrusted(subjectOf(f)));
    const width = subjects.reduce((longest, s) => Math.max(longest, s.length), 0) + 3;
    const gutter = ' '.repeat(width);

    shown.forEach((finding, i) => {
      const subject = subjects[i]!.padEnd(width);
      if (finding.expected && finding.actual) {
        const actual = `${tag(finding.actual.surface)} ${untrusted(finding.actual.value)}`;
        const expected = `${tag(finding.expected.surface)} ${untrusted(finding.expected.value)}`;
        body.push(`${INDENT}${subject}${actual}  ${paint('bold', '≠')}  ${expected}`);
        body.push(`${INDENT}${gutter}${paint('dim', untrusted(finding.actual.locator))}`);
        return;
      }
      body.push(`${INDENT}${subject}${untrusted(finding.message)}`);
      if (finding.actual) {
        body.push(`${INDENT}${gutter}${paint('dim', untrusted(finding.actual.locator))}`);
      }
    });

    const rest = rule.findings - shown.length;
    if (rest > 0) body.push(`${INDENT}… and ${rest} more`);
  }

  const passedCount = result.rules.filter((r) => r.findings === 0 && r.skipped === undefined).length;
  if (passedCount > 0) {
    body.push(`${LABEL_INDENT}${paint('green', '✓')} ${plural(passedCount, 'rule')} passed`);
  }

  const skipped = result.rules.filter((r) => r.skipped !== undefined);
  if (skipped.length > 0) {
    const list = skipped.map((r) => `${r.id} (${untrusted(r.skipped ?? '')})`).join(', ');
    body.push(`${LABEL_INDENT}– ${plural(skipped.length, 'rule')} skipped: ${list}`);
  }

  const issueLines: string[] = [];
  if (result.issues.length > 0) {
    issueLines.push(`${LABEL_INDENT}${plural(result.issues.length, 'collection issue')}`);
    for (const issue of result.issues.slice(0, max)) {
      issueLines.push(`${INDENT}${untrusted(issue.surface)} ${untrusted(issue.code)}: ${untrusted(issue.message)}`);
      if (issue.locator) issueLines.push(`${INDENT}  ${paint('dim', untrusted(issue.locator))}`);
    }
    const rest = result.issues.length - Math.min(max, result.issues.length);
    if (rest > 0) issueLines.push(`${INDENT}… and ${rest} more`);
  }

  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const warns = result.findings.filter((f) => f.severity === 'warn').length;
  const notes = result.findings.filter((f) => f.severity === 'info').length;
  let summary =
    `${errors > 0 ? paint('red', plural(errors, 'error')) : plural(errors, 'error')}, ` +
    `${warns > 0 ? paint('yellow', plural(warns, 'warning')) : plural(warns, 'warning')}`;
  if (notes > 0) summary += `, ${plural(notes, 'note')}`;

  if (result.ok) {
    summary += '. Within budget.';
  } else {
    // The rules are named above, each with its count; here only how many broke their budget.
    const over = result.rules.filter((r) => !r.passed).length;
    summary += `. ${plural(over, 'rule')} over budget.`;
  }

  const lines = [header, plates];
  if (body.length > 0) lines.push('', ...body);
  if (issueLines.length > 0) lines.push('', ...issueLines);
  lines.push('', `${LABEL_INDENT}${summary}`);
  return `\n${lines.join('\n')}\n\n`;
}
