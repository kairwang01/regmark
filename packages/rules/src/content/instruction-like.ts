// Product text written to a language model rather than to a shopper. This is
// an error-level rule, so every pattern is kept narrow: each one needs a model
// noun or a command verb to fire, and each gap is bounded so that matching
// stays linear on hostile input. Gaps stop at sentence ends so a match never
// spans two sentences.

import { defineRule } from '@regmark/core';
import type { Finding, ProductNode } from '@regmark/core';
import { INSPECT_MAX, sampleFinding, windowAround } from './shared.ts';

export type InstructionPattern = { name: string; re: RegExp };

// Words that address a model directly, and the imperatives that make the
// address a command. Used by the addressed-to-model pattern.
const NOUN_FORM = String.raw`\b(?:AI\s+(?:assistants?|agents?|models?)|language\s+models?|LLMs?|chatbots?|shopping\s+(?:agents?|assistants?))\b`;
// Bare brand names fire only when they are clearly being addressed ("Claude,
// please ..."), so "Claude-compatible cable, please check the size" stays silent.
const BARE_NAME = String.raw`\b(?:ChatGPT|Gemini|Claude|Copilot)\s?[,:]`;
const MARKER = String.raw`\b(?:must|should|shall|always|never|please|recommend|tell|say|rank|ignore|do\s+not|don['’]t|note)\b`;
const LEAD_IN = String.raw`\b(?:note\s+to|message\s+to|attention|instructions?\s+for|dear)\b[^.!?\n]{0,30}?`;

const ADDRESSED = new RegExp(
  String.raw`(?:${NOUN_FORM}|${BARE_NAME})[^.!?\n]{0,80}?${MARKER}|${LEAD_IN}(?:${NOUN_FORM}|${BARE_NAME})`,
  'i',
);

/**
 * The patterns, in the order they are tried. The first one that matches names
 * the finding. Exported so each can be tested on its own.
 */
export const PATTERNS: readonly InstructionPattern[] = [
  {
    name: 'override',
    re: /\b(?:ignore|disregard|forget|override)\b[^.!?\n]{0,40}?\b(?:all|any|previous|prior|above|earlier|preceding)\b[^.!?\n]{0,30}?\b(?:instructions?|prompts?|directions?|rules?|guidelines?)\b/i,
  },
  { name: 'addressed-to-model', re: ADDRESSED },
  {
    name: 'system-prompt',
    // "you are now" and "from now on you" are common in sales copy, so they
    // only fire with a role noun or a command after them.
    re: /\bsystem\s+prompt\b|\bnew\s+instructions\s*:|\byou\s+are\s+now\b[^.!?\n]{0,60}?\b(?:assistant|agent|bot|chatbot|AI|model|persona|salesperson|advisor|representative)s?\b|\bfrom\s+now\s+on\s+you\b[^.!?\n]{0,60}?\b(?:must|should|shall|always|never|recommend|tell|say|rank|ignore)\b/i,
  },
  {
    name: 'tell-the-user',
    re: /\b(?:tell|inform|assure|convince)\s{1,10}(?:the\s{1,10})?(?:user|customer|shopper|buyer)\s{1,10}(?:that|to)\b/i,
  },
  {
    name: 'zh-override',
    re: /(?:忽略|无视|不要理会)[^。！？\n]{0,10}?(?:之前|以上|前面|先前|上面|所有)[^。！？\n]{0,10}?(?:指令|提示|要求|规则|指示)/,
  },
  {
    name: 'zh-addressed-to-model',
    re: /(?:AI ?助手|智能助手|大模型|语言模型|AI ?代理|购物助手)[^。！？\n]{0,30}?(?:请|必须|务必|应当|应该|一定要)/i,
  },
];

export default defineRule({
  id: 'content.instruction-like',
  severity: 'error',
  summary: 'Product text addressed to a language model rather than to a shopper.',
  help: 'Remove it and find out how it got there. In a review it is user content to moderate. In a description it came from a supplier\'s data or from someone with access they should not have.',
  check(product: ProductNode): Finding[] {
    const findings: Finding[] = [];
    for (const sample of product.text) {
      // Only the start of a sample is inspected; a command buried past
      // 20,000 characters is not worth the time it would take to find.
      const head = sample.text.slice(0, INSPECT_MAX);
      for (const { name, re } of PATTERNS) {
        const m = re.exec(head);
        if (!m) continue;
        const value = windowAround(head, m.index, m.index + m[0].length);
        findings.push(
          sampleFinding(product, sample, 'error', `text addressed to a language model (${name}): "${value}"`, value),
        );
        break;
      }
    }
    return findings;
  },
});
