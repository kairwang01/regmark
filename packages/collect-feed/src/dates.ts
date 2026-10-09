// Reading the time a feed says it was generated. Both formats are read field
// by field rather than handed to Date.parse, which accepts 31 February and
// rolls it into March, and reads a time with no zone in the zone of whatever
// machine runs the audit. Text that is not exactly one of these formats is
// not a date, and the caller leaves the timestamp out.

/** A timestamp as the feed writes it, with where it was found. */
export type DateText = {
  text: string;
  /**
   * Where it was found: a path in the document such as
   * "/rss/channel/lastBuildDate", or "header(last-modified)". The locator is
   * the feed URL, "#", and this.
   */
  path: string;
  syntax: 'rfc822' | 'rfc3339';
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

/** Offsets in minutes for the zone names RFC 822 defines. Military letters other than Z are left out: RFC 2822 says they were never reliable. */
const ZONES: ReadonlyMap<string, number> = new Map([
  ['ut', 0],
  ['utc', 0],
  ['gmt', 0],
  ['z', 0],
  ['est', -300],
  ['edt', -240],
  ['cst', -360],
  ['cdt', -300],
  ['mst', -420],
  ['mdt', -360],
  ['pst', -480],
  ['pdt', -420],
]);

type Fields = { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number; offset: number };

/** The instant the fields name, or undefined when any of them is out of range. */
function instant(f: Fields): number | undefined {
  // Below 1900 is no feed's build date, and Date.UTC would read 0026 as 1926.
  if (f.year < 1900 || f.month < 1 || f.month > 12 || f.day < 1) return undefined;
  // The last day of the month: Date.UTC would roll 31 September into October.
  if (f.day > new Date(Date.UTC(f.year, f.month, 0)).getUTCDate()) return undefined;
  // 60 is a leap second, which both RFCs allow.
  if (f.hour > 23 || f.minute > 59 || f.second > 60) return undefined;
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second, f.ms) - f.offset * 60_000;
}

/** "+0200" or "-05:30" as minutes east of UTC, or undefined when the hours or minutes are out of range. */
function numericOffset(text: string): number | undefined {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(text);
  if (!m) return undefined;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 23 || minutes > 59) return undefined;
  return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

const RFC822 = /^(?:([A-Za-z]{3}),\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}|\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{4}|[A-Za-z]{1,3})$/;

/**
 * An RFC 822 date, as RSS and HTTP write them: "Wed, 30 Sep 2026 08:00:00 GMT".
 * The day name is optional and not checked against the date: a generator that
 * gets the weekday wrong has still written the date it meant. A two-digit year
 * is read as RFC 2822 says, 00 to 49 as 2000 to 2049 and 50 to 99 as 1950 to 1999.
 */
export function parseRfc822(text: string): number | undefined {
  const m = RFC822.exec(text.trim());
  if (!m) return undefined;
  if (m[1] !== undefined && !DAYS.has(m[1].toLowerCase())) return undefined;
  const month = MONTHS.indexOf(m[3]!.toLowerCase()) + 1;
  if (month === 0) return undefined;
  const zone = m[8]!;
  const offset = /^[+-]/.test(zone) ? numericOffset(zone) : ZONES.get(zone.toLowerCase());
  if (offset === undefined) return undefined;
  const written = Number(m[4]);
  const year = m[4]!.length === 2 ? written + (written < 50 ? 2000 : 1900) : written;
  return instant({ year, month, day: Number(m[2]), hour: Number(m[5]), minute: Number(m[6]), second: Number(m[7] ?? 0), ms: 0, offset });
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * An RFC 3339 date-time, as Atom writes it: "2026-09-30T08:00:00Z". The offset
 * is required; a time without one could be in any zone.
 */
export function parseRfc3339(text: string): number | undefined {
  const m = RFC3339.exec(text.trim());
  if (!m) return undefined;
  const zone = m[8]!;
  const offset = zone === 'Z' || zone === 'z' ? 0 : numericOffset(zone);
  if (offset === undefined) return undefined;
  // Milliseconds are as fine as a Date goes; further digits are cut, not rounded.
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  return instant({
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6]),
    ms,
    offset,
  });
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * An ISO 8601 date, "2026-10-07", or a date-time with a zone, as a sale window
 * in an Agentic Commerce Protocol feed may write one: "2026-10-07T23:59Z" or
 * "2026-10-07T23:59:59-05:00". Seconds and the colon in the offset are
 * optional; the zone is not, for the same reason as in RFC 3339. A date alone
 * is returned as the instant its UTC day starts, flagged so the caller can
 * read it as a whole day.
 */
export function parseIso8601(text: string): { time: number; dateOnly: boolean } | undefined {
  const trimmed = text.trim();
  const date = ISO_DATE.exec(trimmed);
  if (date) {
    const time = instant({ year: Number(date[1]), month: Number(date[2]), day: Number(date[3]), hour: 0, minute: 0, second: 0, ms: 0, offset: 0 });
    return time === undefined ? undefined : { time, dateOnly: true };
  }
  const m = ISO_DATETIME.exec(trimmed);
  if (!m) return undefined;
  const zone = m[8]!;
  const offset = zone === 'Z' || zone === 'z' ? 0 : numericOffset(zone);
  if (offset === undefined) return undefined;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  const time = instant({
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] ?? 0),
    ms,
    offset,
  });
  return time === undefined ? undefined : { time, dateOnly: false };
}

/** The text as an ISO 8601 instant in UTC, or undefined when it is not a date in its syntax. */
export function readDate(date: Pick<DateText, 'text' | 'syntax'>): string | undefined {
  const time = date.syntax === 'rfc822' ? parseRfc822(date.text) : parseRfc3339(date.text);
  return time === undefined ? undefined : new Date(time).toISOString();
}
