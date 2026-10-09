// The vocabulary every other package speaks. Nothing in this file does any
// work; it only says what the pieces are called and what shape they have.

/** Where a statement about a product was read from. */
export type Surface =
  | 'page' // text a person sees on the product page
  | 'jsonld' // schema.org JSON-LD embedded in the page
  | 'microdata' // schema.org microdata embedded in the page
  | 'opengraph' // og: and product: meta tags
  | 'feed' // merchant product feed
  | 'ucp'
  | 'acp'
  | 'mcp'
  | 'platform' // the shop backend's own storefront API
  | 'checkout'; // totals computed by a real cart

/**
 * The four plates. Surfaces are grouped the way a press sheet is separated:
 * C is the page, M the feed, Y the protocol endpoints, and K the key plate,
 * the one the other three are registered against.
 */
export type Plate = 'C' | 'M' | 'Y' | 'K';

export const PLATE_OF: Readonly<Record<Surface, Plate>> = {
  page: 'C',
  jsonld: 'C',
  microdata: 'C',
  opengraph: 'C',
  feed: 'M',
  ucp: 'Y',
  acp: 'Y',
  mcp: 'Y',
  platform: 'K',
  checkout: 'K',
};

/**
 * Which surface to believe, most trusted first. JSON-LD, feeds and protocol
 * endpoints are never in this list: they are what gets checked.
 */
export const DEFAULT_DATUM: readonly Surface[] = ['checkout', 'platform', 'page'];

/**
 * An amount of money as an integer count of 1/10000 of the major unit, so
 * 39.00 is 390000. Integers make equality exact; four places cover every
 * ISO 4217 currency. `currency` is null when the source did not say.
 */
export type Money = { units: number; currency: string | null };

export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'discontinued' | 'unknown';

export type ShippingQuote = {
  /** True when the surface says shipping costs nothing. */
  free: boolean;
  /** The stated cost, or null when the surface gives no number. */
  cost: Money | null;
  /** ISO 3166-1 alpha-2 destination the quote applies to, when stated. */
  country?: string;
  /** True when the surface attaches a condition, such as a minimum spend. */
  conditional?: boolean;
};

export type ReturnPolicy = { present: boolean; days?: number; url?: string };

/**
 * One surface's statement of one fact at one moment. A fact is never stored
 * as a bare value: every value keeps the exact text it was read from and a
 * pointer back to where that text lives.
 */
export type Observation<T> = {
  value: T;
  /** The source text, unmodified. */
  raw: string;
  surface: Surface;
  /** URL plus a pointer into it: a JSON pointer, a CSS path, a feed item id. */
  locator: string;
  /** ISO 8601. */
  fetchedAt: string;
};

/** Everything a surface offers for telling one variant from another. */
export type VariantIds = {
  gtin?: string;
  sku?: string;
  mpn?: string;
  brand?: string;
  /** The backend's id for this exact variant. Only platform and checkout set it. */
  variantId?: string;
  /** The backend's id for the parent product. Only platform and checkout set it. */
  productId?: string;
  /** A surface-local grouping id, such as a feed's item_group_id. */
  groupId?: string;
  /** The product page URL as the surface states it. */
  url?: string;
  /** Option name to option value, such as { size: 'M', color: 'Blue' }. */
  options?: Record<string, string>;
  /**
   * Other identifiers that might equal a SKU or a backend id on another
   * surface. A feed's `id` is the usual case: merchants fill it with either.
   */
  aliases?: string[];
};

/** A piece of product text, kept for the content hygiene rules. */
export type TextSample = {
  field: 'title' | 'description' | 'review' | 'other';
  text: string;
  /** True when a person looking at the rendered page would not see this text. */
  hidden: boolean;
  /** Why it is considered hidden, such as "display:none" or "font-size:0". */
  hiddenReason?: string;
  locator: string;
};

/**
 * What one surface says about one variant, or about a product as a whole.
 * Collectors produce these; the graph builder merges them.
 */
export type Sighting = {
  surface: Surface;
  /**
   * 'variant' when the surface is talking about one specific variant.
   * 'product' when it gives a single statement for the whole product, as a
   * page's headline price or an og:price tag does.
   */
  scope: 'variant' | 'product';
  ids: VariantIds;
  title?: string;
  /** The price a buyer pays now, so the sale price while a sale is on. */
  price?: Observation<Money>;
  /** The regular price, when the surface also states one. */
  listPrice?: Observation<Money>;
  /** The date after which `price` stops applying, ISO 8601. */
  priceValidUntil?: Observation<string>;
  availability?: Observation<Availability>;
  shipping?: Observation<ShippingQuote>;
  returnPolicy?: Observation<ReturnPolicy>;
  /** Checkout only: whether one unit could be put in a cart. */
  purchasable?: Observation<boolean>;
  /** Checkout only: one unit plus shipping and tax to the probe destination. */
  landedTotal?: Observation<Money>;
  /** Page only. */
  text?: TextSample[];
};

/** One variant, with every surface's statements gathered per fact. */
export type Offer = {
  /** Stable within a run: the SKU when there is one, else another identifier. */
  key: string;
  ids: VariantIds;
  title?: string;
  surfaces: Surface[];
  /** The variant-scope sightings that were merged into this offer, one per surface that saw it. */
  sightings: Sighting[];
  price: Observation<Money>[];
  listPrice: Observation<Money>[];
  priceValidUntil: Observation<string>[];
  availability: Observation<Availability>[];
  shipping: Observation<ShippingQuote>[];
  returnPolicy: Observation<ReturnPolicy>[];
  purchasable: Observation<boolean>[];
  landedTotal: Observation<Money>[];
};

export type ProductNode = {
  key: string;
  url?: string;
  title?: string;
  surfaces: Surface[];
  variants: Offer[];
  /** Product-scope sightings: they describe the product, not one variant. */
  productLevel: Sighting[];
  text: TextSample[];
};

export type OfferGraph = {
  products: ProductNode[];
  /** Every surface that contributed at least one sighting. */
  surfaces: Surface[];
};

export type Severity = 'error' | 'warn' | 'info';

/** One side of a disagreement, ready to print. */
export type Evidence = {
  surface: Surface;
  /** The normalized value, formatted for people: "39.00 USD", "in_stock". */
  value: string;
  raw: string;
  locator: string;
};

export type Finding = {
  rule: string;
  severity: Severity;
  message: string;
  /** ProductNode.key */
  product: string;
  /** Offer.key, when the finding is about one variant. */
  variant?: string;
  /** The surface at fault. */
  surface?: Surface;
  /** What the datum says. */
  expected?: Evidence;
  /** What the surface at fault says. */
  actual?: Evidence;
};

export type RuleContext = {
  /** Datum order for this run, most trusted first. */
  datum: readonly Surface[];
  /** Every surface that was collected in this run. */
  collected: ReadonlySet<Surface>;
  /** The whole graph, for the few rules that have to look across products. */
  graph: OfferGraph;
  now: Date;
  /** Returns the observation from the most trusted surface, if any. */
  pick<T>(observations: readonly Observation<T>[]): Observation<T> | undefined;
};

export type Rule = {
  /** Dotted and stable: "price.mismatch". Never renamed once released. */
  id: string;
  severity: Severity;
  /** One line, shown in reports next to the id. */
  summary: string;
  /** The rule is skipped unless at least one of these was collected. */
  needsAny?: readonly Surface[];
  /** The rule is skipped unless every one of these was collected. */
  needsAll?: readonly Surface[];
  /** Pure: no I/O, no clock other than ctx.now, same input gives same output. */
  check(product: ProductNode, ctx: RuleContext): Finding[];
};

export type RuleSummary = {
  id: string;
  severity: Severity;
  summary: string;
  findings: number;
  /** Largest count that still passes. null means unlimited. */
  budget: number | null;
  passed: boolean;
  /** Set when the rule did not run, with the reason. */
  skipped?: string;
};

/** A problem collecting, as opposed to a problem with the shop's data. */
export type CollectIssue = {
  surface: Surface;
  /** Short and stable: "fetch-failed", "robots-disallowed", "parse-error". */
  code: string;
  message: string;
  locator?: string;
};

export type AuditResult = {
  schema: 'regmark.audit/v0';
  tool: { name: 'regmark'; version: string };
  store: string;
  startedAt: string;
  finishedAt: string;
  datum: Surface[];
  surfaces: Surface[];
  counts: { products: number; variants: number };
  rules: RuleSummary[];
  findings: Finding[];
  issues: CollectIssue[];
  /** True when every rule is within its budget. */
  ok: boolean;
};

// ── Collecting ──────────────────────────────────────────────────────────

export type Fetched = {
  /** The URL that produced this response, after any redirects. */
  url: string;
  status: number;
  /** Header names lowercased. */
  headers: Record<string, string>;
  body: string;
  fetchedAt: string;
};

export type RequestOptions = { headers?: Record<string, string> };

/**
 * The only way a collector touches the network. The implementation in
 * net/fetcher.ts enforces the host allowlist, robots.txt, pacing, size and
 * time limits, and refuses private addresses.
 */
export interface Fetcher {
  get(url: string, options?: RequestOptions): Promise<Fetched>;
  /**
   * A request that changes state on the shop. Rejects unless ownership of
   * the shop was verified for this run.
   */
  send(method: 'POST' | 'PUT' | 'DELETE', url: string, options?: RequestOptions & { json?: unknown }): Promise<Fetched>;
}

export type CollectContext = {
  /** The shop's origin, such as https://shop.example */
  store: URL;
  fetcher: Fetcher;
  now(): Date;
  log(level: 'debug' | 'info' | 'warn', message: string): void;
};

export type CollectResult = { sightings: Sighting[]; issues: CollectIssue[] };
