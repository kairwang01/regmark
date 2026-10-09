// Small helpers the protocol collectors share. Everything here treats what a
// shop sent as untrusted: nothing throws on it, and text from it is cut short
// before it goes into a message.

import { FetchRefused } from '@regmark/core';
import type { CollectIssue, Surface } from '@regmark/core';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isOk(status: number): boolean {
  return status >= 200 && status < 300;
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

/** Shop text in a message is cut short: an error page is not a message. */
export function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function issue(surface: Surface, code: string, message: string, locator?: string): CollectIssue {
  // Built without an undefined locator key so issues compare cleanly with deepEqual.
  return locator === undefined ? { surface, code, message } : { surface, code, message, locator };
}

/** A request that was refused or failed before an answer came back. */
export function refusalIssue(surface: Surface, err: unknown, url: string, what: string): CollectIssue {
  if (err instanceof FetchRefused && err.code === 'robots') return issue(surface, 'robots-disallowed', `${what}: ${err.message}`, url);
  return issue(surface, 'fetch-failed', `${what}: ${errorText(err)}`, url);
}

/** An HTTP status that is not a success, as an issue. A redirect is named, because a POST does not follow one. */
export function statusIssue(surface: Surface, status: number, url: string, what: string): CollectIssue {
  if (status === 404 || status === 410) return issue(surface, 'not-found', `${what}: HTTP ${status}`, url);
  const redirect = status >= 300 && status < 400 ? ' (a redirect, which Regmark does not follow for a query)' : '';
  return issue(surface, 'fetch-failed', `${what}: HTTP ${status}${redirect}`, url);
}
