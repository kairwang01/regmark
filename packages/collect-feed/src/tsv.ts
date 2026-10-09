import { type FeedItem, parseShippingCell } from './item.ts';

// Google accepts "sale price" and "sale_price" and "g:price" alike, so the
// header is normalised before anything looks a column up.
export function headerName(cell: string): string {
  return cell.trim().toLowerCase().replace(/^g:/, '').replace(/\s+/g, '_');
}

/**
 * Splits tab-separated text into rows of cells. A cell that opens with a
 * double quote runs to the closing quote, may hold tabs and newlines, and
 * writes a literal quote as "".
 */
export function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        cell += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Empty lines are noise, not items.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function readTsv(text: string): FeedItem[] {
  const [header, ...body] = splitRows(text);
  if (!header) return [];
  const names = header.map(headerName);
  return body.map((cells) => {
    // No prototype: a header named "constructor" must not read as present.
    const fields: Record<string, string> = Object.create(null);
    names.forEach((name, column) => {
      const value = (cells[column] ?? '').trim();
      if (name && value && !(name in fields)) fields[name] = value;
    });
    return { fields, shipping: parseShippingCell(fields.shipping ?? '') };
  });
}
