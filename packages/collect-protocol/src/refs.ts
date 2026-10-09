// What the audit already knows about each sampled product, handed to the
// protocol collectors so they look up exactly those products and nothing
// else. Every sighting a protocol collector returns carries the ref's `url`,
// so the graph joins it to the same product as the page, the feed and the
// storefront API.

export type ProductRef = {
  /** The product page URL as the sample has it. */
  url: string;
  title?: string;
  /** The storefront API's product id, when a platform was read. */
  productId?: string;
  /** The URL handle or slug, when known. */
  handle?: string;
  skus?: string[];
  /** The storefront API's variant ids, when a platform was read. */
  variantIds?: string[];
};

export type EndpointOptions = {
  /** The endpoint or discovery URL, when the operator gave one. Otherwise the collector's default for the store. */
  url?: string;
  products: readonly ProductRef[];
};
