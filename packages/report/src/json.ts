import type { AuditResult } from '@regmark/core';

// The AuditResult type is the schema, so the JSON is the result unchanged.
export function renderJson(result: AuditResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
