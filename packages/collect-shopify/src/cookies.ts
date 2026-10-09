// The probe's session cookies. A Shopify storefront cart belongs to the
// browser session that made it, through cookies such as `cart`, and the Ajax
// cart API takes no token a client could send instead. A request without the
// session's cookies reaches a new, empty cart, so the probe keeps them itself:
// the fetcher has no cookie jar, on purpose, because nothing else in a run may
// carry state from one request to the next.

/** Cookie name to value. Only these two matter: every request goes to the shop's own origin, and the jar ends with the run. */
export type CookieJar = Map<string, string>;

// RFC 6265 section 4.1.1: a name is a token, a value is cookie-octets,
// optionally in double quotes. Anything else is not a cookie this jar keeps,
// and could not be sent back in a header anyway.
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const VALUE = /^(?:"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*"|[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*)$/;

/**
 * Takes in the Set-Cookie header of a response. The fetcher keeps several
 * Set-Cookie headers one per line, because their Expires dates contain
 * commas. A cookie set again replaces its value, and one the shop expires is
 * dropped. Attributes other than the expiry are ignored.
 */
export function keepCookies(jar: CookieJar, setCookie: string | undefined, now: Date): void {
  if (setCookie === undefined) return;
  for (const line of setCookie.split('\n')) {
    const [pair = '', ...attributes] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!NAME.test(name) || !VALUE.test(value)) continue;
    if (expired(attributes, now)) jar.delete(name);
    else jar.set(name, value);
  }
}

/** The Cookie header for the next request, or undefined while the jar is empty. */
export function cookieHeader(jar: CookieJar): string | undefined {
  if (jar.size === 0) return undefined;
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Max-Age wins over Expires when both are given (RFC 6265 section 5.3, step 3). */
function expired(attributes: readonly string[], now: Date): boolean {
  let expires: string | undefined;
  for (const attribute of attributes) {
    const eq = attribute.indexOf('=');
    if (eq < 0) continue;
    const key = attribute.slice(0, eq).trim().toLowerCase();
    const value = attribute.slice(eq + 1).trim();
    if (key === 'max-age' && /^-?\d+$/.test(value)) return Number(value) <= 0;
    if (key === 'expires') expires = value;
  }
  if (expires === undefined) return false;
  // An expiry that does not read as a date is ignored, as a browser ignores it.
  const at = Date.parse(expires);
  return !Number.isNaN(at) && at <= now.getTime();
}
