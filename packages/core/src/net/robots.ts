// robots.txt, per RFC 9309.
//
// The types and signatures below are the contract net/fetcher.ts is written
// against; change them and the fetcher has to change with them.

export type RobotsGroup = {
  /** Lowercased user-agent product tokens this group applies to. '*' is the wildcard group. */
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
};

export type Robots = {
  groups: RobotsGroup[];
  /** Sitemap URLs listed in the file, in order. */
  sitemaps: string[];
};

// RFC 9309 only requires parsers to handle 500 KiB; a hostile file can be far
// larger, so anything past this many UTF-8 bytes is ignored.
const MAX_BYTES = 512 * 1024;

const KNOWN_KEYS = new Set(['user-agent', 'allow', 'disallow', 'sitemap']);

export function parseRobots(text: string): Robots {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const source = capUtf8(body, MAX_BYTES);

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // Consecutive user-agent lines share one group. Any allow/disallow line ends
  // that run, so a later user-agent line opens a fresh group.
  let inAgentRun = false;

  for (const raw of source.split(/\r\n|\n|\r/)) {
    const hash = raw.indexOf('#');
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (line === '') continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    // Unknown keys are skipped before touching grouping state, so they do not
    // split a group.
    if (!KNOWN_KEYS.has(key)) continue;

    if (key === 'sitemap') {
      if (value !== '') sitemaps.push(value);
      continue;
    }

    if (key === 'user-agent') {
      if (current === null || !inAgentRun) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      inAgentRun = true;
      const token = agentToken(value);
      if (token !== '') current.agents.push(token);
      continue;
    }

    inAgentRun = false;
    // Rules before the first user-agent line belong to no group.
    if (current === null || value === '') continue;
    current.rules.push({ allow: key === 'allow', pattern: value });
  }

  return { groups: groups.filter((g) => g.agents.length > 0), sitemaps };
}

/**
 * Whether `agent` may fetch `pathAndQuery`. `agent` is a product token such
 * as "Regmark", matched case-insensitively.
 */
export function isAllowed(robots: Robots, agent: string, pathAndQuery: string): boolean {
  const path = normalisePercent(pathAndQuery === '' ? '/' : pathAndQuery);
  if (path === '/robots.txt') return true;

  // A group naming the agent replaces the wildcard group entirely.
  let rules = rulesFor(robots, agent.toLowerCase());
  if (rules === null) rules = rulesFor(robots, '*');
  if (rules === null) return true;

  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    const pattern = normalisePercent(rule.pattern);
    if (!matches(pattern, path)) continue;
    // Longest pattern wins; on a tie, allow beats disallow.
    if (best === null || pattern.length > best.length || (pattern.length === best.length && rule.allow)) {
      best = { allow: rule.allow, length: pattern.length };
    }
  }
  return best === null ? true : best.allow;
}

function capUtf8(text: string, limit: number): string {
  let used = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let size = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    let step = 1;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size = 4;
        step = 2;
      }
    }
    if (used + size > limit) return text.slice(0, i);
    used += size;
    i += step - 1;
  }
  return text;
}

function agentToken(value: string): string {
  const lower = value.toLowerCase();
  if (lower === '*') return '*';
  // Version suffixes and trailing product comments are dropped.
  const match = /^[a-z0-9_-]*/.exec(lower);
  return match ? match[0] : '';
}

function rulesFor(robots: Robots, token: string): RobotsGroup['rules'] | null {
  const matched = robots.groups.filter((g) => g.agents.includes(token));
  if (matched.length === 0) return null;
  return matched.flatMap((g) => g.rules);
}

/** Uppercases escape hex digits and decodes escapes of unreserved characters. */
function normalisePercent(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (_escape: string, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return /^[A-Za-z0-9\-._~]$/.test(ch) ? ch : '%' + hex.toUpperCase();
  });
}

/**
 * Prefix match with `*` wildcards and an optional trailing `$` anchor. Written
 * as a greedy scan over the literal segments rather than a RegExp, so a hostile
 * pattern costs linear-ish time instead of backtracking.
 */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split('*');

  if (parts.length === 1) return anchored ? path === body : path.startsWith(body);

  const first = parts[0];
  if (!path.startsWith(first)) return false;
  let pos = first.length;

  for (let i = 1; i < parts.length - 1; i++) {
    const at = path.indexOf(parts[i], pos);
    if (at < 0) return false;
    pos = at + parts[i].length;
  }

  const last = parts[parts.length - 1];
  if (anchored) return path.length - last.length >= pos && path.endsWith(last);
  return path.indexOf(last, pos) >= 0;
}
