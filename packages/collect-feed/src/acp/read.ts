// Reading an Agentic Commerce Protocol product feed into records, before any
// field means anything. The protocol has two record shapes, and a file holds
// one of them:
//
//   flat     one row per item or variant, the file-upload format OpenAI
//            documents: JSON Lines, CSV or TSV. A CSV or TSV file is either
//            in OpenAI's own format or in its Google-compatible profile, and
//            the two read some fields differently (see flat.ts).
//   product  a Product with its Variants nested inside, the shape of the
//            protocol's Feed API: products.jsonl, one Product per line, or a
//            {"products": [...]} document as the Feed API returns it.
//
// OpenAI also takes Parquet, which is not read here, and no ACP format is XML.
// Either is refused with a message that says what to export instead.

import type { CollectIssue } from '@regmark/core';
import { headerName, splitRows } from '../tsv.ts';

/** Where a record sits in the file, for messages and locators: "line 3", "#line[3]". */
export type Place = { unit: 'line' | 'row' | 'product'; position: number };

export type FlatRecord = {
  kind: 'flat';
  /** Field name to value. A JSON Lines record keeps its JSON values; a CSV or TSV cell is a string. */
  fields: Record<string, unknown>;
  place: Place;
};

export type ProductRecord = { kind: 'product'; product: Record<string, unknown>; place: Place };

export type AcpRecord = FlatRecord | ProductRecord;

/**
 * Which of OpenAI's two delimited formats a flat record follows. JSON Lines
 * is always 'openai': the Google-compatible profile is CSV or TSV only.
 */
export type Profile = 'openai' | 'google';

export type AcpRead = { records: AcpRecord[]; profile: Profile; issues: CollectIssue[] } | { error: string };

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A JSON value as text, without throwing. JSON.parse reads nesting far deeper
 * than JSON.stringify can walk back, and one such value in a feed must not
 * end the run.
 */
export function jsonText(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return '[a value nested too deeply to show]';
  }
}

/** A value as it reads in a message: as JSON, cut so one long value cannot flood the report. */
export function shownJson(v: unknown): string {
  const text = jsonText(v);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export const placeText = (p: Place): string => `${p.unit} ${p.position}`;
export const placeLocator = (feedUrl: string, p: Place): string => `${feedUrl}#${p.unit}[${p.position}]`;

/** A JSON object as a record of one shape or the other: a Product is the one with variants. */
function record(value: Record<string, unknown>, place: Place): AcpRecord {
  // No prototype: a field named "constructor" must not read as present.
  const fields: Record<string, unknown> = Object.assign(Object.create(null), value);
  return Array.isArray(value.variants) ? { kind: 'product', product: fields, place } : { kind: 'flat', fields, place };
}

/**
 * JSON Lines: one record per line. A line that is not a JSON object is
 * reported and the rest are read, as OpenAI rejects a malformed row and keeps
 * processing the others.
 */
function readJsonLines(text: string, feedUrl: string): AcpRead {
  const records: AcpRecord[] = [];
  const issues: CollectIssue[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    const place: Place = { unit: 'line', position: i + 1 };
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err) {
      issues.push({ surface: 'acp', code: 'feed-line-unreadable', message: `line ${i + 1} is not JSON: ${(err as Error).message}`, locator: placeLocator(feedUrl, place) });
      return;
    }
    if (!isObject(value)) {
      issues.push({ surface: 'acp', code: 'feed-line-unreadable', message: `line ${i + 1} is not a JSON object`, locator: placeLocator(feedUrl, place) });
      return;
    }
    records.push(record(value, place));
  });
  return { records, profile: 'openai', issues };
}

/** The products of a {"products": [...]} document, as the Feed API returns them. */
function readProductsDocument(products: unknown[], feedUrl: string): AcpRead {
  const records: AcpRecord[] = [];
  const issues: CollectIssue[] = [];
  products.forEach((value, i) => {
    const place: Place = { unit: 'product', position: i + 1 };
    if (isObject(value)) records.push({ kind: 'product', product: Object.assign(Object.create(null), value), place });
    else issues.push({ surface: 'acp', code: 'feed-item-incomplete', message: `product ${i + 1} is not an object`, locator: placeLocator(feedUrl, place) });
  });
  return { records, profile: 'openai', issues };
}

/**
 * CSV or TSV with one header row. The delimiter is the header's: a header
 * with a tab in it is tab-separated. OpenAI's own format names the page `url`;
 * its Google-compatible profile names it `link`. OpenAI tries its own format
 * first, so a header with `url` is read as that.
 */
function readDelimited(text: string): AcpRead {
  const headerLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const delimiter = headerLine.includes('\t') ? '\t' : ',';
  let rows: string[][];
  try {
    rows = splitRows(text, delimiter);
  } catch (err) {
    return { error: (err as Error).message };
  }
  const [header, ...body] = rows;
  if (!header) return { error: 'feed is empty' };
  const names = header.map(headerName);
  const kind = delimiter === '\t' ? 'tab-separated' : 'comma-separated';
  let profile: Profile;
  if (names.includes('url')) {
    profile = 'openai';
    if (!names.some((n) => n === 'item_id' || n === 'id' || n === 'sku')) return { error: `${kind} ACP feed has a url column but no item_id column` };
  } else if (names.includes('link')) {
    profile = 'google';
    if (!names.includes('id')) return { error: `${kind} ACP feed in the Google-compatible profile has a link column but no id column` };
  } else {
    return { error: `${kind} ACP feed has neither a url column (OpenAI format) nor a link column (Google-compatible profile)` };
  }
  const records: AcpRecord[] = body.map((cells, i) => {
    const fields: Record<string, unknown> = Object.create(null);
    names.forEach((name, column) => {
      const value = (cells[column] ?? '').trim();
      if (name && value && !(name in fields)) fields[name] = value;
    });
    return { kind: 'flat', fields, place: { unit: 'row', position: i + 1 } };
  });
  return { records, profile, issues: [] };
}

/** Pure. Splits the text of an ACP feed into records; the format is told from the text, not from a file name. */
export function readAcp(text: string, feedUrl: string): AcpRead {
  const start = text.trimStart();
  if (start.startsWith('PAR1')) return { error: 'the feed is Parquet, which is not read; export it as JSON Lines, CSV or TSV' };
  if (start.startsWith('<')) return { error: 'the feed is XML, which is not an ACP feed format; ACP feeds are JSON Lines, CSV or TSV, and a Google Merchant feed is read with --feed' };
  if (start.startsWith('[')) return { error: 'the feed is a JSON array, which is not an ACP feed format; write one record per line (JSON Lines), or a {"products": [...]} document' };
  if (start.startsWith('{')) {
    // A whole-file parse tells a {"products": [...]} document, which may span
    // many lines, from JSON Lines, where only a one-record file parses whole.
    let whole: unknown;
    try {
      whole = JSON.parse(text);
    } catch {
      return readJsonLines(text, feedUrl);
    }
    if (isObject(whole) && Array.isArray(whole.products)) return readProductsDocument(whole.products, feedUrl);
    return readJsonLines(text, feedUrl);
  }
  return readDelimited(text);
}
