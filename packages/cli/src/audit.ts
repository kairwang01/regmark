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
import { collectPages } from '@regmark/collect-page';
import type { PageOptions } from '@regmark/collect-page';
import { collectShopifyCatalog } from '@regmark/collect-shopify';
import { collectWooCatalog, probeWooCheckout } from '@regmark/collect-woo';
import type { ProbeTarget } from '@regmark/collect-woo';
import { buildGraph, createFetcher, DEFAULT_DATUM, FetchRefused, runRules, urlKey, verifyOwnership } from '@regmark/core';
import type { AuditResult, CollectContext, CollectIssue, FetchPolicy, Rule, Sighting, Surface } from '@regmark/core';
import { allRules } from '@regmark/rules';
import { detectPlatform } from './detect.ts';

export type ShipTo = { country: string; postcode?: string; state?: string; city?: string };

export type AuditConfig = {
  /** The shop's origin, such as https://shop.example */
  store: string;
  /** Product feed URL, absolute or relative to the store. */
  feed?: string;
  /**
   * Read the catalogue from the shop's storefront API. 'auto' finds out which
   * platform the shop runs on with one or two reads. Left unset, no backend is
   * read and the audit works from the pages alone.
   */
  platform?: 'woocommerce' | 'shopify' | 'auto';
  /** Run the checkout probe. WooCommerce only in this release; needs a verified ownership token. */
  checkout?: { shipTo: ShipTo };
  /** Product page URLs to audit. Without this the sample comes from the platform, the sitemap or the feed. */
  pages?: string[];
  /** Sitemap to discover product pages from, when there is no platform. Default /sitemap.xml. */
  sitemap?: string;
  page?: PageOptions;
  /** How many products to audit. Default 25. */
  sample?: number;
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

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

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

export async function runAudit(config: AuditConfig, deps: AuditDeps = {}): Promise<AuditResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const startedAt = now().toISOString();

  let store: URL;
  try {
    store = new URL(config.store);
  } catch {
    throw new ConfigError(`store is not a URL: ${config.store}`);
  }
  if (store.protocol !== 'http:' && store.protocol !== 'https:') throw new ConfigError('store must be an http or https URL');
  store = new URL(store.origin);
  if (config.checkout && config.platform !== 'woocommerce' && config.platform !== 'auto') {
    throw new ConfigError('the checkout probe needs platform "woocommerce" in this release');
  }
  const size = config.sample ?? 25;
  if (!Number.isInteger(size) || size < 1) throw new ConfigError('sample must be a positive whole number');

  const feedUrl = config.feed ? new URL(config.feed, store).href : undefined;
  const hosts = unique([store.hostname, ...(feedUrl ? [new URL(feedUrl).hostname] : [])]);
  const fetcher = createFetcher({ hosts, ...config.fetch });
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
    const listing = await collectWooCatalog(ctx, { select: () => false });
    issues.push(...listing.issues);
    parents = listing.parents.map((p) => ({ id: p.id, permalink: p.permalink, variants: Math.max(1, p.variationIds.length) }));
    chosen = pick(parents);
    if (chosen.length) {
      const ids = new Set(chosen.map((p) => p.id));
      const catalog = await collectWooCatalog(ctx, { select: (p) => ids.has(p.id) });
      sightings.push(...catalog.sightings);
      issues.push(...catalog.issues.filter((i) => !listing.issues.some((l) => l.code === i.code && l.locator === i.locator)));
    }
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

  // 2. The feed, read whole (it is one file) and then cut down to the sample.
  let feedSightings: Sighting[] = [];
  if (feedUrl) {
    const feed = await collectFeed(ctx, feedUrl);
    issues.push(...feed.issues);
    feedSightings = feed.sightings;
    log('info', `feed: ${feedSightings.length} items`);
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

  // 5. The checkout probe: the only step that writes, and only after the
  //    operator has shown the shop is theirs.
  if (config.checkout && platform !== 'woocommerce') {
    issues.push({ surface: 'checkout', code: 'probe-unsupported', message: 'checkout probe skipped: it needs a WooCommerce shop in this release' });
  } else if (config.checkout) {
    const ownership = await verifyOwnership(store, config.ownershipToken, fetcher);
    if (!ownership.verified) {
      issues.push({ surface: 'checkout', code: 'ownership-not-verified', message: `checkout probe skipped: ${ownership.detail}` });
    } else {
      fetcher.authorizeWrites();
      const targets: ProbeTarget[] = sightings
        .filter((s) => s.surface === 'platform' && s.ids.variantId)
        .map((s) => ({ variantId: s.ids.variantId!, productId: s.ids.productId, sku: s.ids.sku, url: s.ids.url }));
      log('info', `checkout: probing ${targets.length} variants`);
      const probe = await probeWooCheckout(ctx, targets, { shipTo: config.checkout.shipTo });
      sightings.push(...probe.sightings);
      issues.push(...probe.issues);
    }
  }

  const graph = buildGraph(sightings);
  const datum = config.datum ?? [...DEFAULT_DATUM];
  const run = runRules(graph, deps.rules ?? allRules, { datum, budget: config.budget, now: now() });
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
    ok: run.ok,
  };
}
