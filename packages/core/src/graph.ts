// Identity resolution: deciding which statements, read from different
// surfaces, are about the same product and the same variant.
//
// Two passes of union-find. The first groups sightings into products, mostly
// by page URL because every surface carries one. The second groups each
// product's variant sightings into variants by SKU, GTIN, backend id or
// option set.
//
// The rule that keeps this honest: an identifier is only used to join if it
// is unambiguous in the data at hand. A GTIN that two SKUs both claim cannot
// tell them apart, so it joins nothing, and the duplicate is left for a rule
// to report. Without that, one bad barcode would silently fold two variants
// into one and every comparison after it would be wrong.

import { gtinKey, normalizeGtin, optionsKey, skuKey, urlKey } from './ids.ts';
import type { Offer, OfferGraph, ProductNode, Sighting, Surface, TextSample, VariantIds } from './types.ts';

class Union {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = x;
    for (let p = this.parent.get(root); p !== undefined && p !== root; p = this.parent.get(root)) root = p;
    for (let cur = x; cur !== root; ) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    if (!this.parent.has(root)) this.parent.set(root, root);
    return root;
  }

  join(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const BACKEND: ReadonlySet<Surface> = new Set(['platform', 'checkout']);

/** When several surfaces name the same thing, whose spelling is kept. */
const NAMING_ORDER: readonly Surface[] = ['platform', 'checkout', 'jsonld', 'microdata', 'feed', 'ucp', 'acp', 'mcp', 'page', 'opengraph'];
const byNamingOrder = (a: Sighting, b: Sighting) => NAMING_ORDER.indexOf(a.surface) - NAMING_ORDER.indexOf(b.surface);

type Ambiguous = {
  gtins: Set<string>;
  /** SKUs that cannot join products: each appears under more than one product URL. */
  skus: Set<string>;
  /** SKUs that cannot join variants: a backend gives each to more than one of its variants. */
  variantSkus: Set<string>;
};

/** What a surface calls a variant: its SKU, else its first alias. */
const localName = (s: Sighting): string | null => (s.ids.sku ? skuKey(s.ids.sku) : s.ids.aliases?.[0] ? skuKey(s.ids.aliases[0]) : null);

/**
 * A GTIN that one surface puts on two different variants, or a SKU that
 * appears under more than one product URL, identifies nothing. Nor, between
 * variants, does a SKU that a backend gives to several of its own variants,
 * as shops that put the style number on every size do.
 *
 * The checks are per surface on purpose. Two surfaces may name the same
 * variant differently (a SKU here, a backend id there) and that is not a
 * conflict; one surface giving two of its own entries the same barcode is.
 */
function findAmbiguous(sightings: readonly Sighting[]): Ambiguous {
  const gtinToNames = new Map<string, { gtin: string; names: Set<string> }>();
  const skuToUrls = new Map<string, Set<string>>();
  const skuToVariants = new Map<string, { sku: string; ids: Set<string> }>();
  sightings.forEach((s, i) => {
    if (s.ids.sku && s.ids.variantId && BACKEND.has(s.surface)) {
      const k = `${s.surface}|${skuKey(s.ids.sku)}`;
      if (!skuToVariants.has(k)) skuToVariants.set(k, { sku: skuKey(s.ids.sku), ids: new Set() });
      skuToVariants.get(k)!.ids.add(s.ids.variantId);
    }
    const gtin = normalizeGtin(s.ids.gtin);
    if (gtin && s.scope === 'variant') {
      const k = `${s.surface}|${gtinKey(gtin)}`;
      if (!gtinToNames.has(k)) gtinToNames.set(k, { gtin: gtinKey(gtin), names: new Set() });
      gtinToNames.get(k)!.names.add(localName(s) ?? `#${i}`);
    }
    const sku = s.ids.sku ? skuKey(s.ids.sku) : null;
    const url = urlKey(s.ids.url);
    if (sku && url) {
      if (!skuToUrls.has(sku)) skuToUrls.set(sku, new Set());
      skuToUrls.get(sku)!.add(url);
    }
  });
  return {
    gtins: new Set([...gtinToNames.values()].filter((v) => v.names.size > 1).map((v) => v.gtin)),
    skus: new Set([...skuToUrls].filter(([, urls]) => urls.size > 1).map(([sku]) => sku)),
    variantSkus: new Set([...skuToVariants.values()].filter((v) => v.ids.size > 1).map((v) => v.sku)),
  };
}

function productKeys(s: Sighting, amb: Ambiguous): string[] {
  const keys: string[] = [];
  const url = urlKey(s.ids.url);
  if (url) keys.push(`u:${url}`);
  if (s.ids.sku && !amb.skus.has(skuKey(s.ids.sku))) keys.push(`sku:${skuKey(s.ids.sku)}`);
  const gtin = normalizeGtin(s.ids.gtin);
  if (gtin && !amb.gtins.has(gtinKey(gtin))) keys.push(`gtin:${gtinKey(gtin)}`);
  if (BACKEND.has(s.surface)) {
    if (s.ids.productId) keys.push(`pid:${s.ids.productId}`);
    if (s.ids.variantId) keys.push(`vid:${s.ids.variantId}`);
  }
  // A grouping id means something only on the surface that issued it.
  if (s.ids.groupId) keys.push(`g:${s.surface}:${s.ids.groupId}`);
  return keys;
}

function variantKeys(s: Sighting, amb: Ambiguous): string[] {
  const keys: string[] = [];
  const sku = s.ids.sku && !amb.variantSkus.has(skuKey(s.ids.sku)) ? s.ids.sku : undefined;
  if (sku) keys.push(`sku:${skuKey(sku)}`);
  const gtin = normalizeGtin(s.ids.gtin);
  if (gtin && !amb.gtins.has(gtinKey(gtin))) keys.push(`gtin:${gtinKey(gtin)}`);
  if (BACKEND.has(s.surface) && s.ids.variantId) keys.push(`vid:${s.ids.variantId}`);
  // WooCommerce, for one, writes the backend id into the JSON-LD "sku" when a
  // product has no SKU of its own. Inside one product that is safe to follow.
  if (!BACKEND.has(s.surface) && sku && /^\d+$/.test(sku.trim())) keys.push(`vid:${sku.trim()}`);
  // An alias may be a SKU or a backend id on some other surface. Inside one
  // product the chance of an accidental match is negligible.
  for (const alias of s.ids.aliases ?? []) keys.push(`sku:${skuKey(alias)}`, `vid:${alias}`);
  if (s.ids.brand && s.ids.mpn) keys.push(`mpn:${s.ids.brand.trim().toLowerCase()}|${s.ids.mpn.trim().toLowerCase()}`);
  const opts = optionsKey(s.ids.options);
  if (opts) keys.push(`opt:${opts}`);
  return keys;
}

function mergeIds(sightings: readonly Sighting[]): VariantIds {
  const out: VariantIds = {};
  for (const s of [...sightings].sort(byNamingOrder)) {
    for (const field of ['gtin', 'sku', 'mpn', 'brand', 'url', 'options'] as const) {
      if (out[field] === undefined && s.ids[field] !== undefined) (out as Record<string, unknown>)[field] = s.ids[field];
    }
    if (BACKEND.has(s.surface)) {
      out.variantId ??= s.ids.variantId;
      out.productId ??= s.ids.productId;
    }
  }
  return out;
}

type Fact = 'price' | 'listPrice' | 'priceValidUntil' | 'availability' | 'shipping' | 'returnPolicy' | 'purchasable' | 'landedTotal';

function gather<K extends Fact>(sightings: readonly Sighting[], field: K): Offer[K] {
  const out: unknown[] = [];
  for (const s of sightings) {
    if (s[field] !== undefined) out.push(s[field]);
  }
  return out as Offer[K];
}

const uniqueSurfaces = (sightings: readonly Sighting[]): Surface[] => [...new Set(sightings.map((s) => s.surface))];

function toOffer(sightings: Sighting[], fallbackKey: string, amb: Ambiguous): Offer {
  const ids = mergeIds(sightings);
  // A SKU several variants share would give them all one key.
  const sku = ids.sku && !amb.variantSkus.has(skuKey(ids.sku)) ? ids.sku : undefined;
  const key = sku ?? ids.gtin ?? (ids.variantId ? `#${ids.variantId}` : null) ?? (optionsKey(ids.options) || fallbackKey);
  return {
    key,
    ids,
    title: [...sightings].sort(byNamingOrder).find((s) => s.title)?.title,
    surfaces: uniqueSurfaces(sightings),
    sightings: [...sightings].sort(byNamingOrder),
    price: gather(sightings, 'price'),
    listPrice: gather(sightings, 'listPrice'),
    priceValidUntil: gather(sightings, 'priceValidUntil'),
    availability: gather(sightings, 'availability'),
    shipping: gather(sightings, 'shipping'),
    returnPolicy: gather(sightings, 'returnPolicy'),
    purchasable: gather(sightings, 'purchasable'),
    landedTotal: gather(sightings, 'landedTotal'),
  };
}

function toProduct(sightings: Sighting[], amb: Ambiguous, index: number): ProductNode {
  const variantScope = sightings.filter((s) => s.scope === 'variant');
  const productLevel = sightings.filter((s) => s.scope === 'product');

  const union = new Union();
  const keyless: Sighting[] = [];
  variantScope.forEach((s, i) => {
    const keys = variantKeys(s, amb);
    if (keys.length === 0) keyless.push(s);
    for (const k of keys) union.join(`s:${i}`, k);
  });
  const clusters = new Map<string, Sighting[]>();
  variantScope.forEach((s, i) => {
    if (keyless.includes(s)) return;
    const root = union.find(`s:${i}`);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(s);
  });
  // A variant sighting with nothing to identify it can only be placed when
  // the product has a single variant. Otherwise it stands alone, and the
  // identity rule will say so.
  if (keyless.length) {
    if (clusters.size === 1) [...clusters.values()][0]!.push(...keyless);
    else keyless.forEach((s, i) => clusters.set(`keyless:${i}`, [s]));
  }

  // A surface that states one offer for a product with several variants (a
  // JSON-LD Offer carrying the parent SKU is the usual case) is describing
  // the product, not a variant the shop fails to list. If none of a surface's
  // sightings could be tied to a variant the backend knows, they are treated
  // as product-level statements. A surface that did tie some of its sightings
  // to real variants keeps its unmatched ones: those are worth reporting.
  const isReal = (cluster: Sighting[]) => cluster.some((s) => BACKEND.has(s.surface));
  if ([...clusters.values()].some(isReal)) {
    const tied = new Set<Surface>();
    for (const cluster of clusters.values()) if (isReal(cluster)) for (const s of cluster) tied.add(s.surface);
    for (const [key, cluster] of [...clusters]) {
      if (isReal(cluster)) continue;
      const loose = cluster.filter((s) => !tied.has(s.surface));
      if (loose.length === 0) continue;
      productLevel.push(...loose.map((s): Sighting => ({ ...s, scope: 'product' })));
      const rest = cluster.filter((s) => tied.has(s.surface));
      if (rest.length) clusters.set(key, rest);
      else clusters.delete(key);
    }
  }

  const variants = [...clusters.values()].map((c, i) => toOffer(c, `variant-${i + 1}`, amb)).sort((a, b) => a.key.localeCompare(b.key));
  const named = [...sightings].sort(byNamingOrder);
  const url = named.find((s) => s.ids.url)?.ids.url;
  const text: TextSample[] = sightings.flatMap((s) => s.text ?? []);
  return {
    key: urlKey(url) ?? variants[0]?.key ?? `product-${index + 1}`,
    url,
    title: [...sightings].sort((a, b) => Number(b.scope === 'product') - Number(a.scope === 'product') || byNamingOrder(a, b)).find((s) => s.title)?.title,
    surfaces: uniqueSurfaces(sightings),
    variants,
    productLevel,
    text,
    alternateViews: [],
  };
}

/**
 * Hands each alternate view (a sighting with `via`) to the product whose own
 * sightings carry the same page URL. A view joins no identity and states no
 * offer fact; it is kept for the cloaking rule to compare. Its text is added
 * to the product's text only where the view says something the ordinary
 * fetch did not, so the content rules see what only that client was shown,
 * without counting the same sentence twice.
 */
function attachViews(products: ProductNode[], views: readonly Sighting[]): void {
  const byUrl = new Map<string, ProductNode>();
  for (const product of products) {
    for (const s of [...product.productLevel, ...product.variants.flatMap((v) => v.sightings)]) {
      const key = urlKey(s.ids.url);
      if (key && !byUrl.has(key)) byUrl.set(key, product);
    }
    const key = urlKey(product.url);
    if (key && !byUrl.has(key)) byUrl.set(key, product);
  }
  for (const view of views) {
    const key = urlKey(view.ids.url);
    const product = key ? byUrl.get(key) : undefined;
    if (!product) continue;
    product.alternateViews.push(view);
    for (const sample of view.text ?? []) {
      const seen = product.text.some((t) => t.field === sample.field && t.text === sample.text);
      if (!seen) product.text.push({ ...sample, locator: `${sample.locator} [via ${view.via}]` });
    }
  }
}

export function buildGraph(all: readonly Sighting[]): OfferGraph {
  const sightings = all.filter((s) => s.via === undefined);
  const views = all.filter((s) => s.via !== undefined);
  const amb = findAmbiguous(sightings);
  const union = new Union();
  sightings.forEach((s, i) => {
    union.find(`s:${i}`);
    for (const k of productKeys(s, amb)) union.join(`s:${i}`, k);
  });
  const clusters = new Map<string, Sighting[]>();
  sightings.forEach((s, i) => {
    const root = union.find(`s:${i}`);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(s);
  });
  const products = [...clusters.values()].map((c, i) => toProduct(c, amb, i)).sort((a, b) => a.key.localeCompare(b.key));
  attachViews(products, views);
  return { products, surfaces: uniqueSurfaces(sightings) };
}
