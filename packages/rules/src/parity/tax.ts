// Telling a tax difference from a price difference.
//
// Outside North America shops quote prices with tax included, and which of a
// shop's surfaces include it is a matter of configuration: the page may show
// a price without tax to a visitor abroad while the storefront API quotes it
// with tax, and both are right. Two amounts exactly one tax rate apart are
// far more likely to be that than a stale price, so they are reported as a
// question about tax basis, not as a wrong price.

import type { Money } from '@regmark/core';

/** Standard VAT and GST rates in use, in percent. */
const RATES = [5, 7, 7.5, 7.7, 8, 8.1, 9, 10, 12, 12.5, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 25.5, 27];

/** Currencies whose shops quote prices before tax. A gap there is a gap. */
const TAX_NEVER_INCLUDED = new Set(['USD', 'CAD']);

/** One hundredth of a major unit, in Money units: the rounding a tax calculation leaves. */
const ROUNDING = 100;

/**
 * The tax rate, in percent, that would turn the smaller amount into the
 * larger, or null when no standard rate does. Null as well when the amounts
 * are equal or the currency is one that never includes tax.
 */
export function taxRateBetween(a: Money, b: Money): number | null {
  const currency = a.currency ?? b.currency;
  if (currency && TAX_NEVER_INCLUDED.has(currency)) return null;
  const lo = Math.min(a.units, b.units);
  const hi = Math.max(a.units, b.units);
  if (lo <= 0 || lo === hi) return null;
  for (const rate of RATES) {
    if (Math.abs(lo * (1 + rate / 100) - hi) <= ROUNDING) return rate;
  }
  return null;
}
