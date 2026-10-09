// Validate runtime configuration before opening a socket. TypeScript types do
// not protect a JSON config or a JavaScript caller from misspelled safety options.
import { PLATE_OF } from '@regmark/core';
import type { Rule } from '@regmark/core';
import type { AuditConfig } from './audit.ts';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function configObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${name} must be an object`);
  }
}

function fields(value: unknown, name: string, allowed: readonly string[]): asserts value is Record<string, unknown> {
  configObject(value, name);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ConfigError(`unknown ${name} field "${key}"; the fields are ${allowed.join(', ')}`);
  }
}

function text(value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) throw new ConfigError(`${name} must be a non-empty string`);
}

function whole(value: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max}; got ${JSON.stringify(value)}`);
  }
}

function boolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new ConfigError(`${name} must be a boolean`);
}

function strings(value: unknown, name: string): void {
  if (!Array.isArray(value) || !value.every((s) => typeof s === 'string' && s.trim() !== '')) {
    throw new ConfigError(`${name} must be a list of non-empty strings`);
  }
}

function httpUrl(value: unknown, name: string, base?: URL): URL {
  text(value, name);
  let url: URL;
  try { url = new URL(value as string, base); }
  catch { throw new ConfigError(`${name} is not a URL`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError(`${name} must be an http or https URL`);
  if (url.username || url.password) throw new ConfigError(`${name} must not contain URL credentials`);
  return url;
}

/** Surfaces that carry a timestamp of their own, and so can be given a maxAge. */
export const AGEABLE_SURFACES = ['feed', 'acp'] as const;

/**
 * A duration as written in a config file or on the command line: a whole
 * number followed by m, h or d, such as "90m", "24h" or "7d". Returns
 * milliseconds, or undefined when the text is not one.
 */
export function parseDuration(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined;
  const m = /^\s*(\d{1,6})\s*(m|h|d)\s*$/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const ms = n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
  return ms > 0 ? ms : undefined;
}

/** The default client profiles for the cloaking check: a desktop browser, and a shopping agent. */
export const DEFAULT_CLOAKING_PROFILES: Readonly<Record<string, string>> = {
  browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  agent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
};

function endpoint(value: unknown, name: string, store: URL): void {
  if (value === undefined || typeof value === 'boolean') return;
  fields(value, name, ['url', 'agentProfile']);
  if (value.url !== undefined) httpUrl(value.url, `${name}.url`, store);
  // The shop fetches the agent profile, so it must be a public HTTPS URL
  // written in full; it is never resolved against the store.
  if (value.agentProfile !== undefined) {
    const profile = httpUrl(value.agentProfile, `${name}.agentProfile`);
    if (profile.protocol !== 'https:') throw new ConfigError(`${name}.agentProfile must be an https URL`);
  }
}

/**
 * `partial` is for a config file checked on its own, before the command line
 * is merged into it: a field the flags may still supply, such as the feed a
 * maxAge applies to, is not required yet.
 */
export function checkConfig(config: AuditConfig, rules: readonly Rule[], { partial = false }: { partial?: boolean } = {}): void {
  fields(config, 'config', [
    'store', 'feed', 'acpFeed', 'platform', 'checkout', 'pages', 'sitemap', 'page', 'sample', 'maxVariants', 'seed', 'strict',
    'datum', 'budget', 'maxAge', 'cloaking', 'ucp', 'mcp', 'ownershipToken', 'fetch',
  ]);
  const store = httpUrl(config.store, 'store');
  const platforms = ['woocommerce', 'shopify', 'auto'];
  if (config.platform !== undefined && !platforms.includes(config.platform)) {
    throw new ConfigError(`unknown platform "${String(config.platform)}"; choose one of ${platforms.join(', ')}, none`);
  }
  whole(config.sample, 'sample', 1);
  whole(config.maxVariants, 'maxVariants', 1);
  whole(config.seed, 'seed', 0);
  boolean(config.strict, 'strict');
  text(config.ownershipToken, 'ownershipToken');
  for (const key of ['feed', 'acpFeed', 'sitemap'] as const) {
    if (config[key] !== undefined) httpUrl(config[key], key, store);
  }
  if (config.maxAge !== undefined) {
    fields(config.maxAge, 'maxAge', AGEABLE_SURFACES);
    // A limit for a feed the run does not read would check nothing, and the
    // report would not say so.
    const source = { feed: ['feed', '--feed'], acp: ['acpFeed', '--acp-feed'] } as const;
    for (const [surface, value] of Object.entries(config.maxAge)) {
      if (parseDuration(value) === undefined) throw new ConfigError(`maxAge.${surface} must be a duration such as "90m", "24h" or "7d"; got ${JSON.stringify(value)}`);
      const [field, flag] = source[surface as keyof typeof source];
      if (!partial && config[field] === undefined) throw new ConfigError(`maxAge.${surface} is set, but no ${surface} is read; give ${flag} or the ${field} field`);
    }
  }
  if (config.cloaking !== undefined && typeof config.cloaking !== 'boolean') {
    fields(config.cloaking, 'cloaking', ['userAgents']);
    configObject(config.cloaking.userAgents, 'cloaking.userAgents');
    const profiles = Object.entries(config.cloaking.userAgents);
    if (profiles.length === 0) throw new ConfigError('cloaking.userAgents must name at least one client');
    for (const [name, ua] of profiles) {
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw new ConfigError(`cloaking.userAgents: "${name}" must be a short lower-case name such as "agent"`);
      if (typeof ua !== 'string' || ua.trim() === '') throw new ConfigError(`cloaking.userAgents.${name} must be a non-empty string`);
      if (/[^\x20-\x7e]/.test(ua)) throw new ConfigError(`cloaking.userAgents.${name} must contain printable ASCII only`);
    }
    // "browser" is the view the others are held to. On its own it is compared
    // with nothing, and the check would pass without having looked.
    if (profiles.every(([name]) => name === 'browser')) throw new ConfigError('cloaking.userAgents needs a client to compare with the browser, such as "agent"');
  }
  endpoint(config.ucp, 'ucp', store);
  endpoint(config.mcp, 'mcp', store);
  if (config.pages !== undefined) {
    strings(config.pages, 'pages');
    config.pages.forEach((url, i) => httpUrl(url, `pages[${i}]`, store));
  }
  if (config.datum !== undefined) {
    strings(config.datum, 'datum');
    if (config.datum.length === 0) throw new ConfigError('datum must name at least one surface');
    for (const surface of config.datum) {
      if (!Object.hasOwn(PLATE_OF, surface)) throw new ConfigError(`unknown surface "${String(surface)}" in datum`);
    }
  }
  if (config.budget !== undefined) {
    configObject(config.budget, 'budget');
    const known = new Set(rules.map((r) => r.id));
    for (const [id, allowed] of Object.entries(config.budget)) {
      if (!known.has(id)) throw new ConfigError(`budget names a rule that does not exist: "${id}"; regmark rules lists them`);
      whole(allowed, `the budget for ${id}`, 0);
    }
  }
  if (config.fetch !== undefined) {
    fields(config.fetch, 'fetch', ['minIntervalMs', 'timeoutMs', 'allowPrivateNetwork', 'respectRobots', 'userAgent']);
    // Node timers clamp larger delays to 1ms, which would defeat request pacing.
    whole(config.fetch.minIntervalMs, 'fetch.minIntervalMs', 0, 2_147_483_647);
    whole(config.fetch.timeoutMs, 'fetch.timeoutMs', 1, 2_147_483_647);
    boolean(config.fetch.allowPrivateNetwork, 'fetch.allowPrivateNetwork');
    boolean(config.fetch.respectRobots, 'fetch.respectRobots');
    text(config.fetch.userAgent, 'fetch.userAgent');
    if (config.fetch.userAgent && /[^\x20-\x7e]/.test(config.fetch.userAgent)) throw new ConfigError('fetch.userAgent must contain printable ASCII only');
  }
  if (config.page !== undefined) {
    fields(config.page, 'page', ['priceSelector', 'availabilitySelector', 'titleSelector', 'currency', 'descriptionSelectors', 'reviewSelectors']);
    for (const key of ['priceSelector', 'availabilitySelector', 'titleSelector'] as const) text(config.page[key], `page.${key}`);
    for (const key of ['descriptionSelectors', 'reviewSelectors'] as const) {
      if (config.page[key] !== undefined) strings(config.page[key], `page.${key}`);
    }
    if (config.page.currency !== undefined && config.page.currency !== null && (typeof config.page.currency !== 'string' || !/^[A-Z]{3}$/.test(config.page.currency))) {
      throw new ConfigError('page.currency must be a three-letter uppercase currency code or null');
    }
  }
  if (config.checkout !== undefined) {
    fields(config.checkout, 'checkout', ['shipTo']);
    fields(config.checkout.shipTo, 'checkout.shipTo', ['country', 'postcode', 'state', 'city']);
    const { country } = config.checkout.shipTo;
    if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) throw new ConfigError('checkout.shipTo.country must be a two-letter country code');
    for (const key of ['postcode', 'state', 'city'] as const) text(config.checkout.shipTo[key], `checkout.shipTo.${key}`);
  }
}
