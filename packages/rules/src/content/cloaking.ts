// A product page that states one price or stock level to a browser and
// another to a client that identifies as a shopping agent. content.hidden-text
// sees text hidden inside one response; this rule compares two responses.
//
// Each view is held to a reference: the view read as a browser when there is
// one, else Regmark's ordinary read of the page. Only stated facts are
// compared, never markup, so a CSRF token, a timestamp or a rotating list of
// related products says nothing. And only facts both responses state: a
// lighter page for bots that leaves the JSON-LD out is not telling anyone
// anything different, so a fact one side omits is silence, not a finding.

import { defineRule, evidence, formatMoney, gtinKey, isBuyable, moneyEvidence, normalizeGtin, optionsKey, sameMoney, skuKey } from '@regmark/core';
import type { Availability, Evidence, Finding, Money, Observation, ProductNode, Sighting, Surface } from '@regmark/core';

const ID = 'content.cloaking';

/** The view the others are compared with, when it was read for the product. */
export const REFERENCE_VIEW = 'browser';

/** The surfaces a page states facts on, each compared only with itself. */
const PAGE_SURFACES: readonly Surface[] = ['page', 'jsonld', 'microdata', 'opengraph'];

/**
 * Whether two sightings are about the same item, judged by the first kind of
 * identifier both carry: SKU, then GTIN, then option set. Null when they share
 * no kind of identifier and so cannot be paired.
 */
export function sameItem(a: Sighting, b: Sighting): boolean | null {
  if (a.ids.sku && b.ids.sku) return skuKey(a.ids.sku) === skuKey(b.ids.sku);
  const ga = normalizeGtin(a.ids.gtin);
  const gb = normalizeGtin(b.ids.gtin);
  if (ga && gb) return gtinKey(ga) === gtinKey(gb);
  const oa = optionsKey(a.ids.options);
  const ob = optionsKey(b.ids.options);
  if (oa && ob) return oa === ob;
  return null;
}

type Read<T> = (s: Sighting) => Observation<T> | undefined;

/** A stock level counts only when it says buyable or not; 'unknown' is no statement. */
const readPrice: Read<Money> = (s) => s.price;
const readStock: Read<Availability> = (s) => (s.availability && isBuyable(s.availability.value) !== null ? s.availability : undefined);

/**
 * The first statement in `view` that the reference contradicts, paired with
 * the reference statement it is shown against.
 *
 * A statement about an item both sides identify is held to what the reference
 * says about that item, and when the reference names the item but states
 * nothing about this fact, there is nothing to hold it to. An item the view
 * identifies and the reference identifies as something else is not one the
 * reference describes at all: a related product that a rotating block showed
 * one client and not the other.
 *
 * Statements no identifier ties to an item are held to the reference as a
 * set. A rotating block can change some of them between two reads, so they
 * are a difference only when not one of them is something the reference
 * states: the page's own price told differently, not a card swapped for another.
 */
function contradiction<T>(
  view: readonly Sighting[],
  reference: readonly Sighting[],
  read: Read<T>,
  agree: (a: T, b: T) => boolean,
): { actual: Observation<T>; expected: Observation<T> } | undefined {
  const stated = reference.filter((r) => read(r) !== undefined);
  if (stated.length === 0) return undefined;
  const loose: Observation<T>[] = [];
  for (const v of view) {
    const actual = read(v);
    if (!actual) continue;
    const paired = reference.filter((r) => sameItem(v, r) === true);
    if (paired.length === 0) {
      if (reference.some((r) => sameItem(v, r) === false)) continue;
      loose.push(actual);
      continue;
    }
    const against = paired.filter((r) => read(r) !== undefined);
    if (against.length === 0) continue;
    if (!against.some((r) => agree(actual.value, read(r)!.value))) return { actual, expected: read(against[0]!)! };
  }
  if (loose.length > 0 && !loose.some((a) => stated.some((r) => agree(a.value, read(r)!.value)))) {
    return { actual: loose[0]!, expected: read(stated[0]!)! };
  }
  return undefined;
}

/** Evidence from a view says which client it came from, since both sides share a locator. */
const via = (e: Evidence, name: string | undefined): Evidence => (name ? { ...e, locator: `${e.locator} [via ${name}]` } : e);

export default defineRule({
  id: ID,
  severity: 'error',
  summary: 'A page tells an agent a different price or stock level than a browser',
  help:
    'The same product page answered a shopping agent with different facts than it gave a browser. Look for user-agent or bot detection in the theme, a CDN or caching rule that serves bots a separate copy, or a plugin that rewrites structured data for crawlers, and serve every client the same offer.',
  requires: (ctx) => (ctx.graph.products.some((p) => p.alternateViews.length > 0) ? undefined : 'needs --cloaking'),
  check(product: ProductNode): Finding[] {
    const findings: Finding[] = [];
    const names = [...new Set(product.alternateViews.map((s) => s.via!))];
    const hasBrowser = names.includes(REFERENCE_VIEW);
    const reference = hasBrowser
      ? product.alternateViews.filter((s) => s.via === REFERENCE_VIEW)
      : [...product.productLevel, ...product.variants.flatMap((v) => v.sightings)];
    const referenceName = hasBrowser ? REFERENCE_VIEW : undefined;
    const told = hasBrowser ? 'a browser' : 'Regmark itself';

    for (const name of names) {
      if (name === referenceName) continue;
      const view = product.alternateViews.filter((s) => s.via === name);
      for (const surface of PAGE_SURFACES) {
        const ours = view.filter((s) => s.surface === surface);
        const theirs = reference.filter((s) => s.surface === surface);
        if (ours.length === 0 || theirs.length === 0) continue;

        const price = contradiction(ours, theirs, readPrice, (a, b) => sameMoney(a, b));
        if (price) {
          findings.push({
            rule: ID,
            severity: 'error',
            message: `a client identifying as ${name} was told ${formatMoney(price.actual.value)} in ${surface}; ${told} ${formatMoney(price.expected.value)}`,
            product: product.key,
            surface,
            expected: via(moneyEvidence(price.expected), referenceName),
            actual: via(moneyEvidence(price.actual), name),
          });
        }

        const stock = contradiction(ours, theirs, readStock, (a, b) => isBuyable(a) === isBuyable(b));
        if (stock) {
          findings.push({
            rule: ID,
            severity: 'error',
            message: `a client identifying as ${name} was told ${stock.actual.value} in ${surface}; ${told} ${stock.expected.value}`,
            product: product.key,
            surface,
            expected: via(evidence(stock.expected, stock.expected.value), referenceName),
            actual: via(evidence(stock.actual, stock.actual.value), name),
          });
        }
      }
    }
    return findings;
  },
});
