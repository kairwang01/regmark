import { money } from '../src/index.ts';
import type { Availability, Money, Observation, Sighting, Surface, VariantIds } from '../src/index.ts';

const AT = '2026-10-09T00:00:00.000Z';

export const obs = <T>(surface: Surface, value: T, raw = String(value)): Observation<T> => ({ value, raw, surface, locator: `test://${surface}`, fetchedAt: AT });

export const price = (surface: Surface, amount: string, currency: string | null = 'USD'): Observation<Money> => obs(surface, money(amount, currency), amount);

export const stock = (surface: Surface, a: Availability): Observation<Availability> => obs(surface, a, a);

export const sighting = (surface: Surface, ids: VariantIds, rest: Partial<Sighting> = {}): Sighting => ({ surface, scope: 'variant', ids, ...rest });
