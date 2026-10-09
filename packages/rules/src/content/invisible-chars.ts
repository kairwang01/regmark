// Characters that render as nothing but can carry text a shopper never sees.
// Counting is by code point: tag characters live outside the Basic
// Multilingual Plane and would be miscounted by UTF-16 units.

import { defineRule } from '@regmark/core';
import type { Finding, ProductNode } from '@regmark/core';
import { sampleFinding } from './shared.ts';

const EMOJI_FLAG_BASE = 0x1f3f4; // the black flag that opens a subdivision-flag sequence
const CANCEL_TAG = 0xe007f; // closes that sequence
const ZERO_WIDTH = new Set([0x200b, 0x2060, 0xfeff]);
const ZERO_WIDTH_LIMIT = 3;

const isTag = (cp: number): boolean => cp >= 0xe0020 && cp <= 0xe007e;

type Counts = { tags: number; zeroWidth: number };

function count(text: string): Counts {
  const cps: number[] = [];
  for (const ch of text) cps.push(ch.codePointAt(0)!);

  let tags = 0;
  let zeroWidth = 0;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    if (cp === EMOJI_FLAG_BASE) {
      // Tag characters that belong to a flag are legitimate, so skip them
      // along with their terminator. Without a terminator they are counted.
      let j = i + 1;
      while (j < cps.length && isTag(cps[j]!)) j++;
      if (j > i + 1 && cps[j] === CANCEL_TAG) {
        i = j;
        continue;
      }
    }
    if (isTag(cp)) tags++;
    else if (ZERO_WIDTH.has(cp)) zeroWidth++;
  }
  return { tags, zeroWidth };
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function summarize({ tags, zeroWidth }: Counts): string {
  const parts: string[] = [];
  if (tags > 0) parts.push(plural(tags, 'tag character'));
  if (zeroWidth > 0) parts.push(plural(zeroWidth, 'zero-width character'));
  return parts.join(', ');
}

export default defineRule({
  id: 'content.invisible-chars',
  severity: 'warn',
  summary: 'Characters that render as nothing and can carry text a person never sees.',
  check(product: ProductNode): Finding[] {
    const findings: Finding[] = [];
    for (const sample of product.text) {
      const counts = count(sample.text);
      // Zero-width joiners and non-joiners are ordinary in emoji and some scripts, so only the
      // characters that never belong in running text count, and a few of them are needed to fire.
      if (counts.tags < 1 && counts.zeroWidth < ZERO_WIDTH_LIMIT) continue;
      const value = summarize(counts);
      findings.push(sampleFinding(product, sample, 'warn', `text contains invisible characters: ${value}`, value));
    }
    return findings;
  },
});
