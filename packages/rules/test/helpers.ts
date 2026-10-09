// Builders shared by every rule test. A test states what each surface says,
// builds the graph the way a real run would, and runs one rule over it.

import { buildGraph, DEFAULT_DATUM, money, runRules } from '@regmark/core';
import type { Availability, Finding, Money, Observation, ReturnPolicy, Rule, ShippingQuote, Sighting, Surface, TextSample, VariantIds } from '@regmark/core';

export const NOW = new Date('2026-10-09T12:00:00.000Z');
const AT = '2026-10-09T00:00:00.000Z';

export const obs = <T>(surface: Surface, value: T, raw = String(value)): Observation<T> => ({
  value,
  raw,
  surface,
  locator: `test://${surface}`,
  fetchedAt: AT,
});

export const price = (surface: Surface, amount: string, currency: string | null = 'USD'): Observation<Money> => obs(surface, money(amount, currency), amount);

export const stock = (surface: Surface, a: Availability): Observation<Availability> => obs(surface, a, a);

export const shipping = (surface: Surface, cost: string | null, extra: Partial<ShippingQuote> = {}): Observation<ShippingQuote> =>
  obs(surface, { free: cost === null ? false : money(cost).units === 0, cost: cost === null ? null : money(cost, 'USD'), ...extra }, cost ?? '');

export const returns = (surface: Surface, days = 30): Observation<ReturnPolicy> => obs(surface, { present: true, days }, `${days} days`);

export const until = (surface: Surface, date: string): Observation<string> => obs(surface, date, date);

export const bought = (ok: boolean): Observation<boolean> => obs('checkout', ok, ok ? 'added' : 'woocommerce_rest_product_not_purchasable');

/** A variant-scope sighting. */
export const variant = (surface: Surface, ids: VariantIds, rest: Partial<Sighting> = {}): Sighting => ({ surface, scope: 'variant', ids, ...rest });

/** A product-scope sighting, such as a page headline price or an og: tag. */
export const whole = (surface: Surface, url: string, rest: Partial<Sighting> = {}): Sighting => ({ surface, scope: 'product', ids: { url }, ...rest });

export const sample = (text: string, rest: Partial<TextSample> = {}): TextSample => ({ field: 'description', text, hidden: false, locator: 'test://page#css(.description)', ...rest });

export type RunOptions = { datum?: readonly Surface[]; now?: Date };

/** Build the graph from sightings and return the rule's findings. */
export function run(rule: Rule, sightings: Sighting[], options: RunOptions = {}): Finding[] {
  return runRules(buildGraph(sightings), [rule], { datum: options.datum ?? DEFAULT_DATUM, now: options.now ?? NOW }).findings;
}

/** The same, but also says whether the rule ran or was skipped for want of a surface. */
export function runFull(rule: Rule, sightings: Sighting[], options: RunOptions = {}) {
  return runRules(buildGraph(sightings), [rule], { datum: options.datum ?? DEFAULT_DATUM, now: options.now ?? NOW });
}

/** Findings reduced to the fields a test usually asserts on. */
export const brief = (findings: Finding[]) => findings.map((f) => ({ variant: f.variant, surface: f.surface }));
