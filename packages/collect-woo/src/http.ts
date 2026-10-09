// Plumbing shared by the catalogue reader and the checkout probe: URL
// building, defensive reads of response bodies, and the issue shapes both
// report. Nothing here throws on bad input; callers get undefined or an issue.

import { FetchRefused, fromMinor } from '@regmark/core';
import type { CollectContext, CollectIssue, Fetched, Money, Observation, Surface } from '@regmark/core';

export const API_PATH = '/wp-json/wc/store/v1';

export function apiBase(ctx: CollectContext): string {
  return `${ctx.store.origin}${API_PATH}`;
}

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

export function makeIssue(surface: Surface, code: string, message: string, locator?: string): CollectIssue {
  // Built without an undefined locator key so issues compare cleanly with deepEqual.
  return locator === undefined ? { surface, code, message } : { surface, code, message, locator };
}

export function fetchIssue(surface: Surface, err: unknown, locator: string): CollectIssue {
  if (err instanceof FetchRefused && err.code === 'robots') {
    return makeIssue(surface, 'robots-disallowed', err.message, locator);
  }
  return makeIssue(surface, 'fetch-failed', errorText(err), locator);
}

export function observe<T>(value: T, raw: string, surface: Surface, locator: string, fetchedAt: string): Observation<T> {
  return { value, raw, surface, locator, fetchedAt };
}

export type MinorReading = { value: Money; raw: string };

/**
 * Reads `container[field]` as an integer count of minor units, using the
 * currency fields beside it. A missing or malformed piece reads as nothing,
 * so the caller leaves the fact out rather than guessing a unit.
 */
export function readMinor(container: unknown, field: string): MinorReading | undefined {
  if (!isRecord(container)) return undefined;
  const raw = container[field];
  if (typeof raw !== 'string') return undefined;
  const minorUnit = container.currency_minor_unit;
  if (typeof minorUnit !== 'number') return undefined;
  const currency = typeof container.currency_code === 'string' ? container.currency_code : null;
  const value = fromMinor(raw, minorUnit, currency);
  return value ? { value, raw } : undefined;
}

export type JsonRead = { ok: true; res: Fetched; body: unknown } | { ok: false; issue: CollectIssue };

/**
 * GET a resource and parse it. Every failure comes back as an issue. The
 * body is accepted whatever its shape; the caller checks the shape.
 */
export async function getJson(ctx: CollectContext, url: string, surface: Surface): Promise<JsonRead> {
  let res: Fetched;
  try {
    res = await ctx.fetcher.get(url);
  } catch (err) {
    return { ok: false, issue: fetchIssue(surface, err, url) };
  }
  if (!isOk(res.status)) {
    return { ok: false, issue: makeIssue(surface, 'fetch-failed', `HTTP ${res.status}`, url) };
  }
  const parsed = parseJson(res.body);
  if (!parsed) {
    return { ok: false, issue: makeIssue(surface, 'parse-error', 'response is not JSON', url) };
  }
  return { ok: true, res, body: parsed.value };
}
