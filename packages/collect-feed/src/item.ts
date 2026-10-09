// The one shape both feed syntaxes are read into, so the mapping to sightings
// is written once. XML and tab-separated text differ only in how they get here.

export type ShippingEntry = {
  /** Two-letter country as written, possibly empty. */
  country?: string;
  /** The price text, such as "6.20 USD". */
  price: string;
  /** The source text this entry was read from. */
  raw: string;
};

export type FeedItem = {
  /** Field name to trimmed text. Missing or empty fields are absent or ''. */
  fields: Record<string, string>;
  shipping: ShippingEntry[];
};

/**
 * Splits a tab-separated shipping cell into entries. Commas separate entries
 * only when the next token looks like a country and colon, so a price such
 * as "1,299 USD" inside one entry survives.
 *
 * The price is the fourth position, country:region:service:price, but Google
 * lets the handling and transit times follow it as whole numbers of days:
 * "US:CA:Overnight:16.00 USD:1:1:2:3". Those are dropped from the end before
 * the price is taken, or the last day count would be read as the price.
 */
export function parseShippingCell(cell: string): ShippingEntry[] {
  const out: ShippingEntry[] = [];
  for (const part of cell.split(/,(?=\s*[A-Za-z]{0,2}\s*:)/)) {
    const raw = part.trim();
    if (!raw) continue;
    const pieces = raw.split(':');
    while (pieces.length > 4 && /^\s*\d+\s*$/.test(pieces[pieces.length - 1]!)) pieces.pop();
    const price = (pieces[pieces.length - 1] ?? '').trim();
    if (!price) continue;
    const country = pieces.length > 1 ? (pieces[0] ?? '').trim() : '';
    out.push(country ? { country, price, raw } : { price, raw });
  }
  return out;
}
