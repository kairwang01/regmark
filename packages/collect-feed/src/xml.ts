import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { type FeedItem, type ShippingEntry } from './item.ts';

// Nothing is coerced: a GTIN with leading zeros and an id such as "0042" must
// reach the mapping exactly as written.
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'shipping',
});

type Result = { items: FeedItem[] } | { error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function scalar(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isObject(v)) {
    const text = v['#text'];
    if (typeof text === 'string' || typeof text === 'number') return scalar(String(text));
    const href = v['@_href'];
    if (typeof href === 'string') return href.trim() || undefined;
  }
  return undefined;
}

/**
 * A field that should be one string may arrive as several: RSS with both
 * <title> and <g:title> collapses to one key. The first non-empty one wins.
 */
function firstText(v: unknown): string | undefined {
  for (const candidate of asList(v)) {
    const text = scalar(candidate);
    if (text) return text;
  }
  return undefined;
}

/** Atom links: prefer the alternate or unlabelled <link href>, over self or edit. */
function linkText(v: unknown): string | undefined {
  const preferred = asList(v).find(
    (c) => isObject(c) && typeof c['@_href'] === 'string' && (c['@_rel'] === undefined || c['@_rel'] === 'alternate'),
  );
  return scalar(preferred) ?? firstText(v);
}

function shippingEntry(v: unknown): ShippingEntry | undefined {
  if (!isObject(v)) return undefined;
  const price = firstText(v.price);
  if (!price) return undefined;
  const country = firstText(v.country);
  return { ...(country ? { country } : {}), price, raw: price };
}

function itemFromXml(v: unknown): FeedItem {
  // No prototype: a tag named "constructor" must not read as present.
  const fields: Record<string, string> = Object.create(null);
  const shipping: ShippingEntry[] = [];
  if (!isObject(v)) return { fields, shipping };
  for (const [key, value] of Object.entries(v)) {
    if (key.startsWith('@_') || key === '#text') continue;
    if (key === 'shipping') {
      for (const entry of asList(value)) {
        const parsed = shippingEntry(entry);
        if (parsed) shipping.push(parsed);
      }
      continue;
    }
    const text = key === 'link' ? linkText(value) : firstText(value);
    if (text) fields[key] = text;
  }
  return { fields, shipping };
}

/** Reads an RSS 2.0 or Atom document. Anything else is an error, not an empty feed. */
export function readXml(text: string): Result {
  const valid = XMLValidator.validate(text);
  if (valid !== true) return { error: `not well-formed XML: ${valid.err.msg} (line ${valid.err.line})` };

  let root: unknown;
  try {
    root = parser.parse(text);
  } catch (err) {
    return { error: `XML could not be parsed: ${(err as Error).message}` };
  }
  if (!isObject(root)) return { error: 'XML has no root element' };

  if (isObject(root.rss)) {
    const channel = asList(root.rss.channel).find(isObject);
    if (!channel) return { error: 'RSS document has no channel' };
    return { items: asList(channel.item).map(itemFromXml) };
  }
  if (isObject(root.feed)) {
    return { items: asList(root.feed.entry).map(itemFromXml) };
  }
  return { error: 'XML is neither an RSS 2.0 nor an Atom feed' };
}
