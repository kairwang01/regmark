import type { Money } from './types.ts';

const SCALE = 10_000;

/** Currencies whose minor unit is not two digits. */
const MINOR_UNIT: Readonly<Record<string, number>> = {
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLP: 0, ISK: 0, JPY: 0, KRW: 0, PYG: 0, UGX: 0, VND: 0, XAF: 0, XOF: 0, XPF: 0,
};

const ISO_CODES = new Set(
  (
    'AED ARS AUD BGN BHD BRL CAD CHF CLP CNY COP CZK DKK EGP EUR GBP HKD HUF IDR ILS INR IQD ISK JOD JPY KRW KWD ' +
    'LYD MAD MXN MYR NGN NOK NZD OMR PEN PHP PKR PLN PYG QAR RON RUB SAR SEK SGD THB TND TRY TWD UAH UGX USD VND ' +
    'XAF XOF XPF ZAR'
  ).split(' '),
);

/**
 * Symbols that name exactly one currency. A bare "$" and a bare "¥" are
 * deliberately absent: seven currencies use the first and two the second, and
 * guessing is how a CAD price gets compared with a USD one.
 */
const SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ['US$', 'USD'], ['CA$', 'CAD'], ['C$', 'CAD'], ['AU$', 'AUD'], ['A$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'],
  ['S$', 'SGD'], ['R$', 'BRL'], ['MX$', 'MXN'], ['NT$', 'TWD'],
  ['€', 'EUR'], ['£', 'GBP'], ['₹', 'INR'], ['₩', 'KRW'], ['₽', 'RUB'], ['₺', 'TRY'], ['₫', 'VND'], ['₪', 'ILS'],
  ['₱', 'PHP'], ['฿', 'THB'], ['zł', 'PLN'],
];

export function minorUnitOf(currency: string | null): number {
  return currency ? (MINOR_UNIT[currency] ?? 2) : 2;
}

function normCurrency(c: string | null | undefined): string | null {
  if (!c) return null;
  const up = c.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(up) ? up : null;
}

/** "39", "39.0", "39.00001" → units. Rounds half up at the fourth place. */
function decimalToUnits(dec: string): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(dec);
  if (!m) return null;
  const frac = m[2] ?? '';
  let units = Number(m[1]) * SCALE + Number(frac.slice(0, 4).padEnd(4, '0'));
  if (frac.length > 4 && frac.charCodeAt(4) >= 53) units += 1;
  return Number.isSafeInteger(units) ? units : null;
}

/** Build a Money from an amount already known to be a plain decimal. */
export function money(amount: string | number, currency: string | null = null): Money {
  const text = typeof amount === 'number' ? amount.toFixed(4) : amount.trim();
  const units = decimalToUnits(text);
  if (units === null) throw new TypeError(`not a plain decimal amount: ${JSON.stringify(amount)}`);
  return { units, currency: normCurrency(currency) };
}

/** Build a Money from an integer count of minor units, as storefront APIs give it. */
export function fromMinor(minor: string | number, minorUnit: number, currency: string | null): Money | null {
  const text = String(minor).trim();
  if (!/^\d+$/.test(text) || !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 4) return null;
  const units = Number(text) * 10 ** (4 - minorUnit);
  return Number.isSafeInteger(units) ? { units, currency: normCurrency(currency) } : null;
}

function detectCurrency(text: string): string | null {
  for (const m of text.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)) {
    if (ISO_CODES.has(m[1]!)) return m[1]!;
  }
  for (const [symbol, code] of SYMBOLS) {
    if (text.includes(symbol)) return code;
  }
  return null;
}

/**
 * Turn one numeric token into a plain decimal string. The hard part is
 * telling a decimal separator from a grouping separator:
 *   both present      → whichever comes last is the decimal point
 *   one kind, repeated → grouping ("1,299,000")
 *   one kind, once     → grouping if exactly three digits follow and at most
 *                        three precede ("1,299"), otherwise decimal ("39,00")
 * The single-separator case is ambiguous for three-decimal currencies, which
 * is why the caller can pass the currency's minor unit.
 */
function normalizeNumber(token: string, minorUnit: number): string | null {
  const s = token.replace(/[\s  ']/g, '');
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let out: string;
  if (dots && commas) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    out = s.split(group).join('').replace(decimal, '.');
  } else if (dots + commas === 0) {
    out = s;
  } else {
    const sep = dots ? '.' : ',';
    if (dots + commas > 1) {
      out = s.split(sep).join('');
    } else {
      const [head = '', tail = ''] = s.split(sep);
      const grouping = tail.length === 3 && head.length <= 3 && head !== '0' && minorUnit !== 3;
      out = grouping ? head + tail : `${head}.${tail}`;
    }
  }
  return /^\d+(\.\d+)?$/.test(out) ? out : null;
}

const NUMBER_TOKEN = /\d(?:[\d.,'   ]*\d)?/g;

export type MoneyHint = { currency?: string | null };

/**
 * Read every amount out of a piece of free text, in order. "$45.00 $39.00"
 * gives two; a caller that wants one has to decide which.
 */
export function parseAllMoney(raw: string, hint: MoneyHint = {}): Money[] {
  const text = raw.normalize('NFKC');
  const currency = detectCurrency(text) ?? normCurrency(hint.currency);
  const out: Money[] = [];
  for (const m of text.matchAll(NUMBER_TOKEN)) {
    const dec = normalizeNumber(m[0], minorUnitOf(currency));
    const units = dec === null ? null : decimalToUnits(dec);
    if (units !== null) out.push({ units, currency });
  }
  return out;
}

/**
 * Read the first amount out of free text such as "$39.00", "39,00 €" or
 * "USD 1,299". The currency comes from the text when the text names exactly
 * one, else from the hint, else it is null. Returns null when there is no
 * number to read.
 */
export function parseMoney(raw: string, hint: MoneyHint = {}): Money | null {
  return parseAllMoney(raw, hint)[0] ?? null;
}

/**
 * Same amount, within `tolerance` units. Currencies must match when both are
 * known. An unknown currency on either side does not make two prices differ:
 * that is a different defect with its own rule.
 */
export function sameMoney(a: Money, b: Money, tolerance = 0): boolean {
  if (a.currency && b.currency && a.currency !== b.currency) return false;
  return Math.abs(a.units - b.units) <= tolerance;
}

export function addMoney(a: Money, b: Money): Money {
  return { units: a.units + b.units, currency: a.currency ?? b.currency };
}

/** "39.00 USD", "0.5005 KWD", "1299.00". At least two decimals, more only if needed. */
export function formatMoney(m: Money): string {
  const whole = Math.trunc(m.units / SCALE);
  const frac = String(Math.abs(m.units % SCALE)).padStart(4, '0').replace(/0{1,2}$/, '');
  return `${whole}.${frac}${m.currency ? ` ${m.currency}` : ''}`;
}
