// Product text for the content hygiene rules. This module only extracts and
// labels; deciding whether a sample is a problem belongs to the rules.
import type { TextSample } from '@regmark/core';
import { load, type CheerioAPI } from 'cheerio';

export type TextOptions = { descriptionSelectors?: string[]; reviewSelectors?: string[] };

/**
 * Structural view of a parsed node. cheerio does not re-export its node
 * types, and only these few fields are read here.
 */
export type Node = {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: Node[];
  parent?: Node | null;
};

const DEFAULT_DESCRIPTION = [
  '.woocommerce-product-details__short-description',
  '#tab-description',
  '.woocommerce-Tabs-panel--description',
  '.product__description',
  '.product-single__description',
  '[data-product-description]',
  '[itemprop="description"]',
];

const DEFAULT_REVIEW = ['#reviews .comment-text .description', '#reviews .review .description', '.review .review-body', '[itemprop="reviewBody"]'];

// Text inside these is code or fallback markup, never something a person reads.
const SKIP_TEXT = new Set(['script', 'style', 'noscript']);

const HIDDEN_CLASSES = ['screen-reader-text', 'sr-only', 'visually-hidden', 'visuallyhidden'];

/**
 * Collapse ASCII whitespace runs and trim ASCII whitespace only. String#trim
 * would also strip U+FEFF, which a later rule needs to see.
 */
export function tidy(s: string): string {
  return s.replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, '');
}

function isElement(n: Node): boolean {
  return n.type === 'tag' || n.type === 'script' || n.type === 'style';
}

export function hasClass(n: Node, cls: string): boolean {
  return (n.attribs?.class ?? '').split(/\s+/).includes(cls);
}

/** Text of the descendants of `node`, skipping code elements and any subtree `skip` rejects. */
// Elements a browser starts on a new line. Their text must not run into
// their neighbour's: "<p>One</p><p>Two</p>" reads "One Two", not "OneTwo".
const BLOCK = new Set(
  'address article aside blockquote br dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul'.split(' '),
);

export function textContent(node: Node, skip: (n: Node) => boolean = () => false): string {
  let out = '';
  const visit = (n: Node): void => {
    for (const c of n.children ?? []) {
      if (c.type === 'text') out += c.data ?? '';
      else if (isElement(c) && !SKIP_TEXT.has(c.name ?? '') && !skip(c)) {
        const block = BLOCK.has(c.name ?? '');
        if (block) out += ' ';
        visit(c);
        if (block) out += ' ';
      }
    }
  };
  visit(node);
  return out;
}

/** Every element below `node` (not `node` itself) that satisfies `pred`, in document order. */
export function findAll(node: Node, pred: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    for (const c of n.children ?? []) {
      if (isElement(c) && pred(c)) out.push(c);
      visit(c);
    }
  };
  visit(node);
  return out;
}

/** Elements matching a CSS selector, in document order. An invalid selector matches nothing. */
export function select($: CheerioAPI, selector: string): Node[] {
  try {
    return $(selector).toArray();
  } catch {
    return [];
  }
}

/**
 * The product's headline: the first candidate selector with a non-empty
 * match wins. `preferred` is a caller's override and is tried first.
 */
export function productTitle($: CheerioAPI, preferred?: string): { text: string; selector: string } | undefined {
  const candidates = [preferred, 'h1.product_title', 'h1[itemprop="name"]', 'main h1', 'h1'];
  for (const selector of candidates) {
    if (!selector) continue;
    for (const el of select($, selector)) {
      const text = tidy(textContent(el));
      if (text) return { text, selector };
    }
  }
  return undefined;
}

// ── Hidden-text detection ───────────────────────────────────────────────

/**
 * Parse a style attribute into property → value. Values are lowercased, with
 * !important removed and whitespace collapsed to single spaces; later
 * declarations win, as they do in CSS.
 */
function parseStyle(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    if (!prop) continue;
    out.set(prop, tidy(decl.slice(colon + 1).replace(/!\s*important/gi, '')).toLowerCase());
  }
  return out;
}

const compact = (v: string): string => v.replace(/ /g, '');

/** Numeric part of a CSS length, ignoring its unit. Null when the value is not a length. */
function lengthValue(v: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:[a-z]+|%)?$/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Colors compared as #rrggbb, so #fff, white and rgb(255,255,255) are one color. */
function normColor(v: string): string {
  const c = compact(v);
  const named = c === 'white' ? '#ffffff' : c === 'black' ? '#000000' : c;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(named);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/.exec(named);
  if (rgb) return `#${rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return named;
}

/** Fully transparent: the keyword, a 4- or 8-digit hex with a zero alpha, or an rgba/hsla with alpha 0. */
function isTransparent(c: string): boolean {
  return (
    c === 'transparent' ||
    /^#[0-9a-f]{3}0$/.test(c) ||
    /^#[0-9a-f]{6}00$/.test(c) ||
    /^(rgba|hsla)\(.*,0+(\.0+)?%?\)$/.test(c)
  );
}

/** A left/top/text-indent this far negative puts text off the screen. */
function isFarOffscreen(v: string): boolean {
  const n = lengthValue(compact(v));
  return n !== null && n <= -999;
}

/** clip: rect(0,0,0,0) or rect(0 0 0 0), with or without px. */
function isZeroClipRect(v: string): boolean {
  const m = /^rect\((.*)\)$/.exec(v);
  if (!m) return false;
  const parts = (m[1] ?? '').split(/[\s,]+/).filter(Boolean);
  return parts.length === 4 && parts.every((p) => lengthValue(p) === 0);
}

/** Why a person looking at the rendered page would not see this element, or undefined. */
function hiddenReason(el: Node): string | undefined {
  const attribs = el.attribs ?? {};
  const style = parseStyle(attribs.style ?? '');
  const get = (prop: string): string | undefined => style.get(prop);
  const squeezed = (prop: string): string | undefined => {
    const v = get(prop);
    return v === undefined ? undefined : compact(v);
  };
  const isZero = (prop: string): boolean => {
    const v = get(prop);
    return v !== undefined && lengthValue(compact(v)) === 0;
  };

  if (squeezed('display') === 'none') return 'display:none';

  const visibility = squeezed('visibility');
  if (visibility === 'hidden' || visibility === 'collapse') return 'visibility:hidden';

  if (isZero('font-size')) return 'font-size:0';
  if (isZero('opacity')) return 'opacity:0';

  const color = get('color');
  if (color !== undefined && isTransparent(compact(color))) return 'color:transparent';

  const background = get('background-color') ?? get('background');
  if (color !== undefined && background !== undefined && normColor(color) === normColor(background)) {
    return 'color-matches-background';
  }

  const position = squeezed('position');
  if (position === 'absolute' || position === 'fixed') {
    for (const prop of ['left', 'top']) {
      const v = get(prop);
      if (v !== undefined && isFarOffscreen(v)) return 'offscreen';
    }
  }
  const indent = get('text-indent');
  if (indent !== undefined && isFarOffscreen(indent)) return 'offscreen';

  if (squeezed('overflow') === 'hidden' && ['width', 'height', 'max-height'].some(isZero)) return 'zero-size';

  const clip = get('clip');
  if (clip !== undefined && isZeroClipRect(clip)) return 'clipped';
  if (squeezed('clip-path') === 'inset(100%)') return 'clipped';

  if (attribs.hidden !== undefined) return 'hidden-attribute';

  if (HIDDEN_CLASSES.some((cls) => hasClass(el, cls))) return 'a11y-class';

  return undefined;
}

// ── Container analysis ──────────────────────────────────────────────────

type Analysis = {
  visible: string;
  /** Outermost hidden elements with non-empty text, in document order. */
  hidden: { text: string; reason: string }[];
  comments: string[];
  alts: string[];
};

function analyse(root: Node): Analysis {
  const out: Analysis = { visible: '', hidden: [], comments: [], alts: [] };

  // Comments and alt text are collected even inside hidden subtrees, since
  // a machine reads them whether or not a person sees the element. Hidden
  // fragments are recorded only at the outermost level so their text is not
  // reported twice.
  const walk = (n: Node, showText: boolean, inHidden: boolean): void => {
    for (const child of n.children ?? []) {
      if (child.type === 'text') {
        if (showText) out.visible += child.data ?? '';
        continue;
      }
      if (child.type === 'comment') {
        const t = tidy(child.data ?? '');
        if (t) out.comments.push(t);
        continue;
      }
      if (!isElement(child)) continue;

      if (child.name === 'img') {
        const alt = tidy(child.attribs?.alt ?? '');
        if (alt) out.alts.push(alt);
      }

      const reason = hiddenReason(child);
      if (reason !== undefined && !inHidden) {
        const t = tidy(textContent(child));
        if (t) out.hidden.push({ text: t, reason });
        walk(child, false, true);
        continue;
      }
      walk(child, showText && !SKIP_TEXT.has(child.name ?? '') && reason === undefined, inHidden || reason !== undefined);
    }
  };
  walk(root, true, false);
  out.visible = tidy(out.visible);
  return out;
}

// ── Containers ──────────────────────────────────────────────────────────

type Container = { el: Node; selector: string; field: 'description' | 'review' };

/**
 * Elements matched by any of the selectors, one per element, labelled with
 * the first selector that matched it. An element nested inside another match
 * of the same field is dropped so its text is not reported twice.
 */
function containersFor($: CheerioAPI, field: Container['field'], selectors: string[]): Container[] {
  const picked = new Map<Node, string>();
  for (const selector of selectors) {
    for (const el of select($, selector)) {
      if (!picked.has(el)) picked.set(el, selector);
    }
  }
  const out: Container[] = [];
  for (const [el, selector] of picked) {
    let nested = false;
    for (let p = el.parent; p; p = p.parent) {
      if (picked.has(p)) {
        nested = true;
        break;
      }
    }
    if (!nested) out.push({ el, selector, field });
  }
  return out;
}

export function extractText(html: string, pageUrl: string, options: TextOptions = {}): TextSample[] {
  const $ = load(html);
  const out: TextSample[] = [];

  const heading = productTitle($);
  if (heading) out.push({ field: 'title', text: heading.text, hidden: false, locator: `${pageUrl}#css(${heading.selector})` });

  const containers = [
    ...containersFor($, 'description', options.descriptionSelectors ?? DEFAULT_DESCRIPTION),
    ...containersFor($, 'review', options.reviewSelectors ?? DEFAULT_REVIEW),
  ];
  const order = new Map<Node, number>();
  select($, '*').forEach((el, i) => order.set(el, i));
  containers.sort((a, b) => (order.get(a.el) ?? 0) - (order.get(b.el) ?? 0));

  for (const { el, selector, field } of containers) {
    const at = `${pageUrl}#css(${selector})`;
    const a = analyse(el);

    if (a.visible) out.push({ field, text: a.visible, hidden: false, locator: at });

    a.hidden.forEach((h, n) => {
      out.push({ field, text: h.text, hidden: true, hiddenReason: h.reason, locator: `${at} hidden[${n}]` });
    });
    a.comments.forEach((text, n) => {
      out.push({ field, text, hidden: true, hiddenReason: 'html-comment', locator: `${at} comment[${n}]` });
    });
    a.alts.forEach((text, n) => {
      out.push({ field: 'other', text, hidden: true, hiddenReason: 'alt-attribute', locator: `${at} img[${n}]@alt` });
    });
  }

  return out;
}
