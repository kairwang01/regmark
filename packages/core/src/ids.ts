// Normalizing the identifiers that tie one variant to itself across surfaces.

/**
 * Digits of a GTIN-8, -12, -13 or -14, or null when the text is not one.
 * Spaces and hyphens are dropped; nothing is padded.
 */
export function normalizeGtin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d+$/.test(digits) && [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

/** GS1 mod-10 check over the digits of a normalized GTIN. */
export function isValidGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += (digits.charCodeAt(i) - 48) * weight;
  }
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(digits.length - 1) - 48;
}

/** A GTIN of any length compared as GTIN-14, so a UPC-A matches its EAN-13 form. */
export function gtinKey(digits: string): string {
  return digits.padStart(14, '0');
}

/** SKUs are compared case-insensitively and without surrounding space. */
export function skuKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * One product page, one key: host without "www.", path without a trailing
 * slash, no query and no fragment. Returns null for anything that is not an
 * http(s) URL.
 */
export function urlKey(raw: string | null | undefined, base?: URL): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const port = u.port ? `:${u.port}` : '';
  let path: string;
  try {
    path = decodeURI(u.pathname);
  } catch {
    path = u.pathname;
  }
  path = path.replace(/\/+$/, '');
  return `${host}${port}${path}`;
}

const OPTION_NAME_ALIASES: Readonly<Record<string, string>> = { colour: 'color', couleur: 'color', taille: 'size', grösse: 'size' };

/** "attribute_pa_Size" → "size". Storefronts decorate option names; this strips the decoration. */
export function optionName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^attribute_/, '')
    .replace(/^pa_/, '')
    .replace(/[\s_-]+/g, ' ');
  return OPTION_NAME_ALIASES[name] ?? name;
}

/** A stable signature for a set of options: "color=blue|size=m". Empty string when there are none. */
export function optionsKey(options: Record<string, string> | undefined): string {
  if (!options) return '';
  return Object.entries(options)
    .map(([k, v]) => `${optionName(k)}=${v.trim().toLowerCase()}`)
    .sort()
    .join('|');
}
