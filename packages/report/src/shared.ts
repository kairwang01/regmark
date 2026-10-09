import type { AuditResult, Evidence, Finding, Severity } from '@regmark/core';

// Every reporter needs the same sentence for a finding, so the SARIF message
// and the JUnit failure lines cannot drift apart.
export function subjectOf(finding: Finding): string {
  if (finding.variant) return finding.variant;
  // A product key is "host/path". The last path segment is what people call the product.
  const tail = finding.product.replace(/\/+$/, '').split('/').pop();
  return tail && tail !== finding.product ? tail : finding.product;
}

export function findingSentence(finding: Finding): string {
  const subject = subjectOf(finding);
  if (finding.expected && finding.actual) {
    return `${subject}: ${finding.actual.surface} says ${finding.actual.value}, ${finding.expected.surface} says ${finding.expected.value}`;
  }
  return `${subject}: ${finding.message}`;
}

/** The evidence that points at where the shop's wrong statement lives. */
export function primaryEvidence(finding: Finding): Evidence | undefined {
  return finding.actual ?? finding.expected;
}

export function sarifLevel(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'error') return 'error';
  if (severity === 'warn') return 'warning';
  return 'note';
}

/** Duration in milliseconds, never negative and never NaN. */
export function durationMs(result: AuditResult): number {
  const ms = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

// Locators are "URL#pointer". The artifact is the URL part; the pointer goes
// into properties so GitHub can still show it without breaking file lookup.
export function artifactUri(locator: string): string {
  const hash = locator.indexOf('#');
  return hash === -1 ? locator : locator.slice(0, hash);
}

/** True when the audit read no product at all. "Within budget" is then true and means nothing, so no reporter says it. */
export function nothingRead(result: AuditResult): boolean {
  return result.counts.products === 0;
}

/** Why collection prevents a passing audit, independently of finding budgets. */
export function collectionFailure(result: AuditResult): string | undefined {
  if (nothingRead(result)) return 'No product was read, so nothing was checked.';
  if (!result.ok && result.issues.length > 0 && result.rules.every((rule) => rule.passed)) {
    return 'Collection issues prevent a passing audit.';
  }
  return undefined;
}
