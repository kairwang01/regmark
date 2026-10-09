// The Universal Commerce Protocol catalogue: the shop's business profile at
// /.well-known/ucp, and the catalogue capability it declares, read for the
// sampled products only. Read-only: no cart and no checkout session is
// created, and no tool but the two catalogue reads is ever called.
//
// The steps follow the spec's own order (ucp.dev, release 2026-08-25):
//   1. read the business profile;
//   2. pick the newest protocol version both sides speak, fetching the
//      version's own profile when it is an older one the shop still offers;
//   3. find the shopping service for that version, REST if offered, else MCP;
//   4. check the profile declares catalogue lookup or search;
//   5. ask about the sampled products (catalog.ts).

import type { CollectContext, CollectIssue, CollectResult, Fetched } from '@regmark/core';
import { readCatalogue } from './catalog.ts';
import { rpcSession } from './jsonrpc.ts';
import type { EndpointOptions } from './refs.ts';
import { restAsk, toolAsk } from './transports.ts';
import { clip, isOk, isRecord, issue, parseJson, refusalIssue, statusIssue } from './util.ts';

/** The protocol versions this collector reads, newest first. Both have the catalogue capability with the fields read here. */
export const UCP_VERSIONS = ['2026-08-25', '2026-04-08'] as const;
export type UcpVersion = (typeof UCP_VERSIONS)[number];

/**
 * The agent profile sent with each request, per version. UCP has every call
 * name the caller's profile, which the shop fetches to learn what the caller
 * understands. These are the example profiles Shopify publishes for agents
 * (also the default of its own UCP command line tool): public, cacheable,
 * and declaring the catalogue capabilities and Shopify's catalogue
 * extension. `agentProfile` replaces them.
 */
export const AGENT_PROFILES: Readonly<Record<UcpVersion, string>> = {
  '2026-08-25': 'https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json',
  '2026-04-08': 'https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json',
};

const SHOPPING = 'dev.ucp.shopping';
const LOOKUP = 'dev.ucp.shopping.catalog.lookup';
const SEARCH = 'dev.ucp.shopping.catalog.search';
/** Shopify's extension of the catalogue. It defines filters.available, which keeps sold-out variants in an answer. */
const SHOPIFY_CATALOG = 'dev.shopify.catalog';

const VERSION_TEXT = /^\d{4}-\d{2}-\d{2}$/;

type Profile = { ucp: Record<string, unknown>; url: string };
type Read<T> = ({ ok: true } & T) | { ok: false; issue: CollectIssue };

export async function collectUcp(ctx: CollectContext, options: EndpointOptions): Promise<CollectResult> {
  if (options.products.length === 0) return { sightings: [], issues: [] };
  const fail = (found: CollectIssue): CollectResult => ({ sightings: [], issues: [found] });

  const discovery = options.url ?? new URL('/.well-known/ucp', ctx.store).href;
  const top = await readProfile(ctx, discovery, 'business profile');
  if (!top.ok) return fail(top.issue);

  const chosen = await negotiate(ctx, top);
  if (!chosen.ok) return fail(chosen.issue);
  const { version, profile } = chosen;

  const binding = shoppingBinding(profile.ucp, version);
  if (!binding) {
    return fail(issue('ucp', 'not-supported', `the profile offers no REST or MCP endpoint for ${SHOPPING} ${version}`, profile.url));
  }
  const lookup = declares(profile.ucp, LOOKUP, version);
  const search = declares(profile.ucp, SEARCH, version);
  if (!lookup && !search) {
    return fail(issue('ucp', 'not-supported', `the profile declares no catalogue capability (${LOOKUP} or ${SEARCH}) for ${version}`, profile.url));
  }

  const agentProfile = options.agentProfile ?? AGENT_PROFILES[version];
  ctx.log('debug', `ucp: ${version} over ${binding.transport} at ${binding.endpoint}`);
  const ask = binding.transport === 'rest'
    ? restAsk(ctx, 'ucp', binding.endpoint, agentProfile)
    : toolAsk(ctx, rpcSession('ucp', binding.endpoint), agentProfile);
  const result = await readCatalogue(ask, {
    surface: 'ucp',
    refs: options.products,
    platform: options.platform,
    lookup,
    search,
    includeUnavailable: Object.hasOwn(capabilities(profile.ucp), SHOPIFY_CATALOG),
  });
  return { sightings: result.sightings, issues: result.issues.map((found) => offHost(found, binding.endpoint)) };
}

async function readProfile(ctx: CollectContext, url: string, what: string): Promise<Read<{ profile: Profile }>> {
  let res: Fetched;
  try {
    res = await ctx.fetcher.get(url, { headers: { accept: 'application/json' } });
  } catch (err) {
    return { ok: false, issue: refusalIssue('ucp', err, url, what) };
  }
  if (!isOk(res.status)) {
    const found = statusIssue('ucp', res.status, url, what);
    return { ok: false, issue: found.code === 'not-found' ? { ...found, message: `${what}: HTTP ${res.status}; the shop publishes no UCP profile here` } : found };
  }
  const parsed = parseJson(res.body);
  const ucp = parsed && isRecord(parsed.value) ? parsed.value.ucp : undefined;
  if (!isRecord(ucp) || typeof ucp.version !== 'string') {
    return { ok: false, issue: issue('ucp', 'parse-error', `${what}: not a UCP profile (no ucp.version)`, url) };
  }
  return { ok: true, profile: { ucp, url: res.url } };
}

/**
 * The newest version both sides speak. The profile's own `ucp.version` is the
 * shop's current one; `supported_versions` maps each older one it still
 * offers to that version's complete profile, which must say it is that
 * version.
 */
async function negotiate(ctx: CollectContext, top: { profile: Profile }): Promise<Read<{ version: UcpVersion; profile: Profile }>> {
  const { ucp, url } = top.profile;
  const older = isRecord(ucp.supported_versions) ? ucp.supported_versions : {};
  for (const version of UCP_VERSIONS) {
    if (ucp.version === version) return { ok: true, version, profile: top.profile };
    const leafUrl = Object.hasOwn(older, version) ? older[version] : undefined;
    if (typeof leafUrl !== 'string') continue;
    let target: string;
    try {
      target = new URL(leafUrl, url).href;
    } catch {
      return { ok: false, issue: issue('ucp', 'parse-error', `the profile for ${version} is not at a URL: ${clip(leafUrl, 80)}`, url) };
    }
    const leaf = await readProfile(ctx, target, `profile for ${version}`);
    if (!leaf.ok) return leaf;
    if (leaf.profile.ucp.version !== version) {
      return { ok: false, issue: issue('ucp', 'parse-error', `the profile for ${version} says it is ${clip(String(leaf.profile.ucp.version), 40)}`, target) };
    }
    return { ok: true, version, profile: leaf.profile };
  }
  const offered = [ucp.version, ...Object.keys(older)].filter((v): v is string => typeof v === 'string' && VERSION_TEXT.test(v));
  // A profile may name any number of versions; a message names a few.
  const listed = offered.length ? `${offered.slice(0, 6).join(', ')}${offered.length > 6 ? ', …' : ''}` : 'no version Regmark can read';
  return { ok: false, issue: issue('ucp', 'version-unsupported', `the shop offers UCP ${listed}; Regmark reads ${UCP_VERSIONS.join(' and ')}`, url) };
}

type Binding = { transport: 'rest' | 'mcp'; endpoint: string };

/**
 * The shopping service's endpoint for this version: REST when the shop offers
 * it, otherwise MCP. Entries for another version are ignored, as the spec
 * says they must be.
 */
function shoppingBinding(ucp: Record<string, unknown>, version: string): Binding | undefined {
  const services = isRecord(ucp.services) ? ucp.services[SHOPPING] : undefined;
  const entries = Array.isArray(services) ? services.filter(isRecord).filter((entry) => entry.version === version) : [];
  for (const transport of ['rest', 'mcp'] as const) {
    const entry = entries.find((e) => e.transport === transport && typeof e.endpoint === 'string');
    if (!entry) continue;
    let endpoint: URL;
    try {
      endpoint = new URL(entry.endpoint as string);
    } catch {
      continue;
    }
    if (endpoint.protocol === 'https:' || endpoint.protocol === 'http:') return { transport, endpoint: endpoint.href };
  }
  return undefined;
}

function capabilities(ucp: Record<string, unknown>): Record<string, unknown> {
  return isRecord(ucp.capabilities) ? ucp.capabilities : {};
}

/** A capability counts only with an entry for the version being spoken. */
function declares(ucp: Record<string, unknown>, name: string, version: string): boolean {
  const entries = Object.hasOwn(capabilities(ucp), name) ? capabilities(ucp)[name] : undefined;
  return Array.isArray(entries) && entries.some((entry) => isRecord(entry) && entry.version === version);
}

/**
 * A profile may name an endpoint on a host the run does not contact: Shopify
 * names the shop's myshopify.com host even when the audit names the shop's
 * own domain. The refusal is kept, with what to do about it.
 */
function offHost(found: CollectIssue, endpoint: string): CollectIssue {
  if (found.code !== 'fetch-failed' || !found.message.includes(': foreign-host: ')) return found;
  const host = new URL(endpoint).host;
  const hint = host.endsWith('.myshopify.com')
    ? `Shopify serves the same profile there: set ucp.url to https://${host}/.well-known/ucp to read it`
    : 'Regmark contacts only the hosts the configuration names';
  return { ...found, message: `${found.message}; the profile names an endpoint on ${host}. ${hint}` };
}
