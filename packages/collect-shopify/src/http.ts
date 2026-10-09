// Plumbing shared by the catalogue reader and the checkout probe: defensive
// reads of response bodies. Nothing here throws on bad input; callers get
// undefined or false.

import { FetchRefused } from '@regmark/core';

export function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Wrapped so that a body that parses to JSON null is not mistaken for one that does not parse. */
export function parseJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The one refusal the probe must stop on: the run never proved it controls the shop. */
export function isOwnershipRefusal(err: unknown): boolean {
  return err instanceof FetchRefused && err.code === 'write-not-authorized';
}
