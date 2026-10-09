// One audit, start to finish: decide which products to look at, read every
// configured surface for exactly those products, build the graph, run the
// rules.
//
// The order matters. All surfaces must be read for the SAME set of products,
// or a product that one collector sampled and another skipped would look
// like a product missing from a surface. So the sample is fixed first, from
// the most authoritative list available, and every collector is then held
// to it.

import { collectFeed } from '@regmark/collect-feed';
import { collectPages, collectViews } from '@regmark/collect-page';
import type { ClientProfile, PageOptions } from '@regmark/collect-page';
import { collectMcp, collectUcp } from '@regmark/collect-protocol';
import type { ProductRef } from '@regmark/collect-protocol';
import { collectShopifyCatalog, probeShopifyCart } from '@regmark/collect-shopify';
import { collectWooCatalog, probeWooCheckout } from '@regmark/collect-woo';
import type { ProbeTarget } from '@regmark/collect-woo';
import { buildGraph, createFetcher, DEFAULT_DATUM, FetchRefused, runRules, urlKey, verifyOwnership } from '@regmark/core';
import type { AuditResult, CollectContext, CollectIssue, FetchPolicy, Rule, RuleOptions, Sighting, Surface } from '@regmark/core';
import { allRules } from '@regmark/rules';
import { detectPlatform } from './detect.ts';
import { checkConfig, ConfigError, DEFAULT_CLOAKING_PROFILES, parseDuration } from './config.ts';
export { ConfigError } from './config.ts';

export type ShipTo = { country: string; postcode?: string; state?: string; city?: string };

export type ProtocolOption = { url?: string; agentProfile?: string };

export type AuditConfig = {
  /** The shop's origin, such as https://shop.example */
  store: string;
  /** Product feed URL, absolute or relative to the store. */
  feed?: string;
  /** Agentic Commerce Protocol product feed URL, absolute or relative to the store. Read as the `acp` surface. */
  acpFeed?: string;
  /**
   * Read the catalogue from the shop's storefront API. 'auto' finds out which
   * platform the shop runs on with one or two reads. Left unset, no backend is
   * read and the audit works from the pages alone.
   */
  platform?: 'woocommerce' | 'shopify' | 'auto';
  /** Run the checkout probe (WooCommerce or Shopify); needs a verified ownership token. */
  checkout?: { shipTo: ShipTo };
  /**
   * The oldest a surface's own timestamp may be before availability.stale
   * reports it, as "90m", "24h" or "7d". Keyed by surface: feed or acp.
   */
  maxAge?: Partial<Record<'feed' | 'acp', string>>;
  /**
   * Fetch each sampled page again as other clients (by default a browser and
   * a shopping agent) and compare what each was told. Needs a verified
   * ownership token. `true` uses the default profiles.
   */
  cloaking?: boolean | { userAgents: Record<string, string> };
  /**
   * Read the shop's UCP catalogue. `true` discovers it at /.well-known/ucp;
   * `url` names another profile URL. `agentProfile` replaces the agent
   * profile sent with each request.
   */
  ucp?: boolean | ProtocolOption;
  /**
   * Read the shop's storefront MCP server. `true` uses /api/mcp; `url` names
   * another endpoint. `agentProfile` as for `ucp`.
   */
  mcp?: boolean | ProtocolOption;
  /** Product page URLs to audit. Without this the sample comes from the platform, the sitemap or the feed. */
  pages?: string[];
  /** Sitemap to discover product pages from, when there is no platform. Default /sitemap.xml. */
  sitemap?: string;
  page?: PageOptions;
  /** How many products to audit. Default 25. */
  sample?: number;
  /** Fail the audit when any surface could not be collected completely. Default false. */
  strict?: boolean;
  /**
   * Products with more variants than this are left out of the sample. Reading
   * a 200-variant product costs 200 requests on some platforms, and reading
   * only part of one would make the rest look like variants the shop does not
   * have. Default 30.
   */
  maxVariants?: number;
  /** Changes which products the sample picks. Default 1. */
  seed?: number;
  datum?: Surface[];
  budget?: Record<string, number>;
  /** Proves control of the shop; required for the checkout probe. */
  ownershipToken?: string;
  fetch?: Partial<Pick<FetchPolicy, 'minIntervalMs' | 'timeoutMs' | 'allowPrivateNetwork' | 'respectRobots' | 'userAgent'>>;
};

export type AuditDeps = {
  now?: () => Date;
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
  rules?: readonly Rule[];
  version?: string;
};

/** A small deterministic generator, so the same seed audits the same products on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Up to `n` items chosen by a seeded shuffle, returned in their original order. */
export function sample<T>(items: readonly T[], n: number, seed: number): T[] {
  if (items.length <= n) return [...items];
  const random = mulberry32(seed);
  const index = items.map((_, i) => i);
  for (let i = index.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [index[i], index[j]] = [index[j]!, index[i]!];
  }
  return index
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => items[i]!);
}

const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
const decodeXml = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/**
 * Product page URLs from a sitemap. Follows a sitemap index one level down,
 * product sitemaps first, and reads at most four files: this is discovery,
 * not a crawl.
 */
async function discoverFromSitemap(ctx: CollectContext, sitemapUrl: string, issues: CollectIssue[]): Promise<string[]> {
  const locs = async (url: string): Promise<{ index: boolean; urls: string[] }> => {
    const res = await ctx.fetcher.get(url);
    if (res.status < 200 || res.status > 299) throw new Error(`HTTP ${res.status}`);
    return { index: /<sitemapindex[\s>]/i.test(res.body), urls: [...res.body.matchAll(LOC)].map((m) => decodeXml(m[1]!)) };
  };
  try {
    const top = await locs(sitemapUrl);
    let pages = top.urls;
    if (top.index) {
      const children = [...top.urls].sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a))).slice(0, 3);
      pages = [];
      for (const child of children) pages.push(...(await locs(child)).urls);
    }
    const products = pages.filter((u) => /\/products?\//i.test(u));
    return products.length ? products : pages;
  } catch (err) {
    const robots = err instanceof FetchRefused && err.code === 'robots';
    issues.push({ surface: 'page', code: robots ? 'robots-disallowed' : 'fetch-failed', message: `sitemap: ${(err as Error).message}`, locator: sitemapUrl });
    return [];
  }
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

const PAGE_SURFACES: ReadonlySet<Surface> = new Set(['page', 'jsonld', 'microdata', 'opengraph']);

/**
 * What the run already knows about each sampled product, for the protocol
 * collectors: they look up these products and nothing else.
 */
function productRefs(pageUrls: readonly string[], sightings: readonly Sighting[], key: (url: string | undefined) => string | null): ProductRef[] {
  return pageUrls.map((url) => {
    const mine = sightings.filter((s) => key(s.ids.url) === key(url));
    const ref: ProductRef = { url };
    const title = mine.find((s) => s.surface === 'platform' && s.title)?.title ?? mine.find((s) => s.title)?.title;
    if (title) ref.title = title;
    const productId = mine.find((s) => s.surface === 'platform' && s.ids.productId)?.ids.productId;
    if (productId) ref.productId = productId;
    const handle = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (handle) ref.handle = decodeURIComponent(handle);
    const skus = unique(mine.map((s) => s.ids.sku).filter((s): s is string => !!s));
    if (skus.length) ref.skus = skus;
    const variantIds = unique(mine.filter((s) => s.surface === 'platform').map((s) => s.ids.variantId).filter((s): s is string => !!s));
    if (variantIds.length) ref.variantIds = variantIds;
    return ref;
  });
}

/** The endpoint URL a protocol option names, when it names one. */
const endpointUrl = (option: boolean | ProtocolOption | undefined, store: URL): string | undefined =>
  typeof option === 'object' && option.url !== undefined ? new URL(option.url, store).href : undefined;

/** The agent profile a protocol option names, when it names one. */
const agentProfile = (option: boolean | ProtocolOption | undefined): string | undefined =>
  typeof option === 'object' ? option.agentProfile : undefined;

export async function runAudit(config: AuditConfig, deps: AuditDeps = {}): Promise<AuditResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const startedAt = now().toISOString();
  const rules = deps.rules ?? allRules;
  checkConfig(config, rules);

  let store: URL;
  try {
    store = new URL(config.store);
  } catch {
    throw new ConfigError(`store is not a URL: ${config.store}`);
  }
  if (store.protocol !== 'http:' && store.protocol !== 'https:') throw new ConfigError('store must be an http or https URL');
  store = new URL(store.origin);
  if (config.checkout && config.platform === undefined) {
    throw new ConfigError('the checkout probe needs a platform: woocommerce, shopify or auto');
  }
  const size = config.sample ?? 25;

  const feedUrl = config.feed ? new URL(config.feed, store).href : undefined;
  const acpFeedUrl = config.acpFeed ? new URL(config.acpFeed, store).href : undefined;
  const ucpUrl = endpointUrl(config.ucp, store);
  const mcpUrl = endpointUrl(config.mcp, store);
  const hosts = unique([store.hostname, ...[feedUrl, acpFeedUrl, ucpUrl, mcpUrl].filter((u): u is string => !!u).map((u) => new URL(u).hostname)]);
  const fetcher = createFetcher({ ...config.fetch, hosts });
  const ctx: CollectContext = { store, fetcher, now, log };

  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [];
  const key = (url: string | undefined) => urlKey(url, store);

  // 1. The catalogue, when the platform can give one. It is the best source
  //    for the sample because it lists what the shop sells, not what some
  //    other surface claims it sells.
  type Parent = { id: number; permalink: string; variants: number };
  let platform = config.platform === 'auto' ? undefined : config.platform;
  if (config.platform === 'auto') {
    platform = (await detectPlatform(ctx)) ?? undefined;
    log('info', platform ? `platform: ${platform}` : 'platform: none recognised, reading pages only');
  }

  let parents: Parent[] = [];
  let chosen: Parent[] = [];
  const pick = (all: Parent[]): Parent[] => sample(all.filter((p) => p.variants <= (config.maxVariants ?? 30)), size, config.seed ?? 1);
  if (platform === 'woocommerce') {
    let ids: Set<number> | undefined;
    const catalog = await collectWooCatalog(ctx, {
      select: (parent, all) => {
        if (!ids) {
          parents = all.map((p) => ({ id: p.id, permalink: p.permalink, variants: Math.max(1, p.variationIds.length) }));
          chosen = pick(parents);
          ids = new Set(chosen.map((p) => p.id));
        }
        return ids.has(parent.id);
      },
    });
    sightings.push(...catalog.sightings);
    issues.push(...catalog.issues);
  } else if (platform === 'shopify') {
    // One request lists products and their variants together, so the listing
    // is read once and the sample is cut from what it returned.
    const listing = await collectShopifyCatalog(ctx, {});
    issues.push(...listing.issues);
    parents = listing.parents.map((p) => ({ id: p.id, permalink: p.url, variants: Math.max(1, p.variantCount) }));
    chosen = pick(parents);
    const keep = new Set(chosen.map((p) => String(p.id)));
    sightings.push(...listing.sightings.filter((s) => s.ids.productId !== undefined && keep.has(s.ids.productId)));
  }
  if (platform) log('info', `catalogue: ${parents.length} products listed, ${chosen.length} sampled`);

  // 2. The feeds, each read whole (it is one file) and then cut down to the sample.
  let feedSightings: Sighting[] = [];
  if (feedUrl) {
    const feed = await collectFeed(ctx, feedUrl);
    issues.push(...feed.issues);
    feedSightings = feed.sightings;
    log('info', `feed: ${feedSightings.length} items`);
  }
  if (acpFeedUrl) {
    const acp = await collectFeed(ctx, acpFeedUrl, { surface: 'acp' });
    issues.push(...acp.issues);
    feedSightings = [...feedSightings, ...acp.sightings];
    log('info', `acp feed: ${acp.sightings.length} items`);
  }

  // 3. Fix the list of product pages.
  let pageUrls: string[];
  if (config.pages?.length) {
    pageUrls = config.pages.map((u) => new URL(u, store).href);
  } else if (chosen.length) {
    pageUrls = chosen.map((p) => p.permalink);
  } else if (platform) {
    pageUrls = [];
  } else {
    const fromSitemap = await discoverFromSitemap(ctx, new URL(config.sitemap ?? '/sitemap.xml', store).href, issues);
    const candidates = fromSitemap.length ? fromSitemap : unique(feedSightings.map((s) => s.ids.url).filter((u): u is string => !!u));
    pageUrls = sample(unique(candidates), size, config.seed ?? 1);
  }
  const inSample = new Set(pageUrls.map(key));

  // Feed items for a product the platform does not list at all are kept, up
  // to the sample size: either the feed is stale or the catalogue is, and
  // fetching the page settles which.
  if (feedSightings.length) {
    const known = new Set(parents.map((p) => key(p.permalink)));
    const strays = parents.length ? feedSightings.filter((s) => !known.has(key(s.ids.url))) : [];
    const strayUrls = unique(strays.map((s) => s.ids.url).filter((u): u is string => !!u)).slice(0, size);
    for (const url of strayUrls) {
      inSample.add(key(url));
      pageUrls.push(url);
    }
    sightings.push(...feedSightings.filter((s) => inSample.has(key(s.ids.url))));
  }

  // 4. The pages themselves.
  if (pageUrls.length) {
    log('info', `pages: reading ${pageUrls.length}`);
    const pages = await collectPages(ctx, pageUrls, config.page);
    sightings.push(...pages.sightings);
    issues.push(...pages.issues);
  }

  // 5. The endpoints a shopping agent calls directly: the Y plate. Read-only,
  //    and asked about the sampled products only.
  if (config.ucp || config.mcp) {
    const refs = productRefs(pageUrls, sightings, key);
    // The variant ids in the refs come from this platform's storefront API.
    const from = platform === 'woocommerce' || platform === 'shopify' ? platform : undefined;
    if (config.ucp) {
      const ucp = await collectUcp(ctx, { url: ucpUrl, agentProfile: agentProfile(config.ucp), platform: from, products: refs });
      sightings.push(...ucp.sightings);
      issues.push(...ucp.issues);
      log('info', `ucp: ${ucp.sightings.length} statements`);
    }
    if (config.mcp) {
      const mcp = await collectMcp(ctx, { url: mcpUrl, agentProfile: agentProfile(config.mcp), platform: from, products: refs });
      sightings.push(...mcp.sightings);
      issues.push(...mcp.issues);
      log('info', `mcp: ${mcp.sightings.length} statements`);
    }
  }

  // 6. The steps that act as the shop's owner: the checkout probe, which
  //    writes, and the cloaking check, which poses as other clients. Neither
  //    runs until the operator has shown the shop is theirs.
  if (config.checkout || config.cloaking) {
    const ownership = await verifyOwnership(store, config.ownershipToken, fetcher);
    if (!ownership.verified) {
      if (config.checkout) issues.push({ surface: 'checkout', code: 'ownership-not-verified', message: `checkout probe skipped: ${ownership.detail}` });
      if (config.cloaking) issues.push({ surface: 'page', code: 'ownership-not-verified', message: `cloaking check skipped: ${ownership.detail}` });
    } else {
      fetcher.authorizeWrites();
      if (config.checkout) {
        const targets: ProbeTarget[] = sightings
          .filter((s) => s.surface === 'platform' && s.ids.variantId)
          .map((s) => ({ variantId: s.ids.variantId!, productId: s.ids.productId, sku: s.ids.sku, url: s.ids.url }));
        if (platform === 'woocommerce' || platform === 'shopify') {
          log('info', `checkout: probing ${targets.length} variants`);
          const probe = platform === 'woocommerce'
            ? await probeWooCheckout(ctx, targets, { shipTo: config.checkout.shipTo })
            : await probeShopifyCart(ctx, targets, { shipTo: config.checkout.shipTo });
          sightings.push(...probe.sightings);
          issues.push(...probe.issues);
        } else {
          issues.push({ surface: 'checkout', code: 'probe-unsupported', message: 'checkout probe skipped: it needs a WooCommerce or Shopify shop' });
        }
      }
      if (config.cloaking) {
        const read = new Set(sightings.filter((s) => PAGE_SURFACES.has(s.surface)).map((s) => key(s.ids.url)));
        const urls = pageUrls.filter((u) => read.has(key(u)));
        const named = typeof config.cloaking === 'object' ? config.cloaking.userAgents : DEFAULT_CLOAKING_PROFILES;
        const profiles: ClientProfile[] = Object.entries(named).map(([name, userAgent]) => ({ name, userAgent }));
        log('info', `cloaking: reading ${urls.length} pages as ${profiles.map((p) => p.name).join(', ')}`);
        const views = await collectViews(ctx, urls, profiles, config.page);
        sightings.push(...views.sightings);
        issues.push(...views.issues);
      }
    }
  }

  const graph = buildGraph(sightings);
  const datum = config.datum ?? [...DEFAULT_DATUM];
  const maxAgeMs: NonNullable<RuleOptions['maxAgeMs']> = {};
  for (const [surface, text] of Object.entries(config.maxAge ?? {})) {
    const ms = parseDuration(text);
    if (ms !== undefined) maxAgeMs[surface as Surface] = ms;
  }
  const run = runRules(graph, rules, { datum, budget: config.budget, now: now(), options: { maxAgeMs } });
  return {
    schema: 'regmark.audit/v0',
    tool: { name: 'regmark', version: deps.version ?? '0.1.0' },
    store: store.origin,
    startedAt,
    finishedAt: now().toISOString(),
    datum,
    surfaces: graph.surfaces,
    counts: { products: graph.products.length, variants: graph.products.reduce((n, p) => n + p.variants.length, 0) },
    rules: run.rules,
    findings: run.findings,
    issues,
    ok: run.ok && graph.products.length > 0 && (!config.strict || issues.length === 0),
  };
}
