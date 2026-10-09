// Helpers the content hygiene rules share: how offending text is cut for
// evidence, and how a finding about one text sample is shaped.

import type { Finding, ProductNode, Severity, TextSample } from '@regmark/core';

/** Evidence shows at most this many characters of the offending text. */
export const EVIDENCE_MAX = 120;

/** Only the first characters of a sample are inspected; the rest is never matched. */
export const INSPECT_MAX = 20_000;

const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Control characters become spaces so an evidence value cannot break a report line. */
export function printable(text: string): string {
  return text.replace(CONTROL, ' ');
}

/** The first 120 characters, with an ellipsis when cut. Counts code points so an emoji is never split. */
export function clip(text: string): string {
  // Each code point is at most two UTF-16 units, so 242 units always hold 121 code points when there are that many.
  const head = Array.from(text.slice(0, EVIDENCE_MAX * 2 + 2));
  if (head.length > EVIDENCE_MAX) return printable(head.slice(0, EVIDENCE_MAX).join('')) + '…';
  return printable(text);
}

/**
 * A window of at most 120 characters that contains text[start, end), starting
 * at most 30 characters before the match. Matches are kept well under 120
 * characters by their patterns, so the window always covers them.
 */
export function windowAround(text: string, start: number, end: number): string {
  const from = Math.max(0, Math.max(start - 30, end - EVIDENCE_MAX));
  const to = Math.min(text.length, from + EVIDENCE_MAX);
  const body = printable(text.slice(from, to));
  return (from > 0 ? '…' : '') + body + (to < text.length ? '…' : '');
}

/** A finding about one text sample, shaped as the content rules report it. */
export function sampleFinding(product: ProductNode, sample: TextSample, severity: Severity, message: string, value: string): Finding {
  return {
    rule: '',
    severity,
    message,
    product: product.key,
    surface: 'page',
    actual: { surface: 'page', value, raw: value, locator: sample.locator },
  };
}
