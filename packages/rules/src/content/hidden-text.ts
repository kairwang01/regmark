// Text a shopper's browser does not show, which a machine reading the page
// would still take as the product's description.
//
// Most hidden text on a real shop is honest. Screen-reader labels, image
// descriptions and editor comments are hidden on purpose and exempt. So is the
// other slide of a testimonial carousel, the closed panel of an accordion and
// the size guide behind a button: a page hides those with display:none or
// visibility:hidden and shows them on a click. Reporting each of them would
// bury the one case that matters.
//
// What is left falls in two groups. Some techniques have no use except to
// keep text in the markup while making sure nobody sees it: text the colour
// of its background, a font size of zero, a block pushed off the screen.
// Those are reported outright. The ordinary techniques are reported only when
// the hidden text itself reads as keyword stuffing.

import { defineRule } from '@regmark/core';
import type { Finding, ProductNode } from '@regmark/core';
import { clip, printable, sampleFinding } from './shared.ts';

const HONEST: ReadonlySet<string> = new Set(['a11y-class', 'alt-attribute', 'html-comment']);

/** Ways of hiding that an interface has no ordinary reason to use. */
const CLOAKING: ReadonlySet<string> = new Set(['font-size:0', 'color:transparent', 'color-matches-background', 'offscreen', 'zero-size', 'clipped']);

/** Shorter fragments are labels and stray words, not content worth reporting. */
const MIN_LENGTH = 20;

/**
 * Keyword stuffing repeats the thing being sold: a word from the product's
 * own name, four times or more, making up a fifth of the hidden text. A size
 * table repeats itself too ("fits chest"), but not with the product's name,
 * which is what keeps it out. Without a name to go on the bar is higher.
 */
export function looksStuffed(text: string, title?: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  if (words.length < 8) return false;
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const named = new Set((title ?? '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  if (named.size > 0) {
    return [...named].some((w) => {
      const n = counts.get(w) ?? 0;
      return n >= 4 && n / words.length >= 0.2;
    });
  }
  const top = Math.max(...counts.values());
  return top >= 6 && top / words.length >= 0.3;
}

export default defineRule({
  id: 'content.hidden-text',
  severity: 'warn',
  summary: 'Text kept in the page but deliberately kept from the eye.',
  help: 'Remove the hidden block. If it is left over from old search-engine practice it now counts against the shop. If nobody on the team put it there, treat it as a sign that the site has been tampered with.',
  check(product: ProductNode): Finding[] {
    const findings: Finding[] = [];
    for (const sample of product.text) {
      if (!sample.hidden) continue;
      const reason = sample.hiddenReason ?? '';
      if (HONEST.has(reason)) continue;
      const trimmed = sample.text.trim();
      if (trimmed.length < MIN_LENGTH) continue;
      if (!CLOAKING.has(reason) && !looksStuffed(trimmed, product.title)) continue;
      const value = clip(trimmed);
      const how = reason ? `hidden with ${printable(reason)}` : 'hidden text';
      findings.push(sampleFinding(product, sample, 'warn', `${how}: "${value}"`, value));
    }
    return findings;
  },
});
