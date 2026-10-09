// Printing the shop's page-side surfaces: the product page with its visible
// price, JSON-LD and Open Graph tags, plus the home page, sitemap and
// robots.txt. Pure functions of the Shop data: no state, no defects of
// their own.

import type { Client, ProductSays, Shop, VariantSays } from './shop.ts';

const SITE = 'Northfold';
const CONTEXT = 'https://schema.org';

/** Escapes text and double-quoted attribute values alike. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function productUrl(origin: string, slug: string): string {
  return `${origin}/product/${slug}/`;
}

/** Option names and values reach the URL lowercased, as the storefront writes them. */
function variantUrl(origin: string, p: ProductSays, v: VariantSays): string {
  const entries = Object.entries(v.options);
  if (entries.length === 0) return productUrl(origin, p.slug);
  const query = entries
    .map(([name, value]) => `attribute_pa_${encodeURIComponent(name.toLowerCase())}=${encodeURIComponent(value.toLowerCase())}`)
    .join('&');
  return `${productUrl(origin, p.slug)}?${query}`;
}

/** Option names in first-seen order across the given variants. */
function optionNames(variants: VariantSays[]): string[] {
  const names: string[] = [];
  for (const v of variants) {
    for (const name of Object.keys(v.options)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Drops null and undefined properties, so the JSON never says "gtin13": null. */
function withoutNulls(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

/** Serialised JSON with "<" escaped, so no value can close the script element around it. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function identity(v: VariantSays): Record<string, unknown> {
  return withoutNulls({ sku: v.sku, gtin13: v.gtin, mpn: v.mpn });
}

function offer(shop: Shop, origin: string, p: ProductSays, v: VariantSays): Record<string, unknown> {
  return withoutNulls({
    '@type': 'Offer',
    url: variantUrl(origin, p, v),
    price: v.price,
    priceCurrency: v.currency,
    availability: v.stock === 'in_stock' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    priceValidUntil: v.saleEnds,
    shippingDetails: v.shipping
      ? {
          '@type': 'OfferShippingDetails',
          shippingRate: { '@type': 'MonetaryAmount', value: v.shipping.cost, currency: shop.currency },
          shippingDestination: { '@type': 'DefinedRegion', addressCountry: v.shipping.country },
        }
      : null,
    hasMerchantReturnPolicy:
      v.returnDays === null
        ? null
        : {
            '@type': 'MerchantReturnPolicy',
            applicableCountry: 'US',
            returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
            merchantReturnDays: v.returnDays,
          },
  });
}

function jsonLd(shop: Shop, p: ProductSays, origin: string): Record<string, unknown> {
  const brand = { '@type': 'Brand', name: p.brand };
  const url = productUrl(origin, p.slug);

  if (p.jsonldShape === 'single') {
    const v = p.jsonld[0];
    return withoutNulls({
      '@context': CONTEXT,
      '@type': 'Product',
      name: p.title,
      ...(v ? identity(v) : {}),
      brand,
      url,
      offers: v ? offer(shop, origin, p, v) : null,
    });
  }

  if (p.jsonldShape === 'offers') {
    return {
      '@context': CONTEXT,
      '@type': 'Product',
      name: p.title,
      brand,
      url,
      offers: p.jsonld.map((v) => ({ ...offer(shop, origin, p, v), ...identity(v) })),
    };
  }

  return {
    '@context': CONTEXT,
    '@type': 'ProductGroup',
    name: p.title,
    productGroupID: p.slug,
    brand,
    url,
    variesBy: optionNames(p.jsonld).map((name) => `https://schema.org/${name.toLowerCase()}`),
    hasVariant: p.jsonld.map((v) => {
      const values = Object.values(v.options);
      const props = Object.fromEntries(Object.entries(v.options).map(([name, value]) => [name.toLowerCase(), value]));
      return withoutNulls({
        '@type': 'Product',
        name: values.length > 0 ? `${p.title} - ${values.join(' / ')}` : p.title,
        ...identity(v),
        ...props,
        offers: offer(shop, origin, p, v),
      });
    }),
  };
}

function money(amount: string): string {
  return `<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>${esc(amount)}</bdi></span>`;
}

function priceMarkup(p: ProductSays): string {
  const { price, listPrice } = p.page;
  if (listPrice === null) return `<p class="price">${money(price)}</p>`;
  return (
    `<p class="price"><del aria-hidden="true">${money(listPrice)}</del> ` +
    `<span class="screen-reader-text">Original price was: ${esc(listPrice)}.</span>` +
    `<ins aria-hidden="true">${money(price)}</ins>` +
    `<span class="screen-reader-text">Current price is: ${esc(price)}.</span></p>`
  );
}

/** The variations form is built from the storefront API, which knows the options but not GTIN or shipping. */
function variationsForm(p: ProductSays): string {
  const names = optionNames(p.platform);
  if (names.length === 0) return '';
  const rows = names.map((name) => {
    const lower = esc(name.toLowerCase());
    const values: string[] = [];
    for (const v of p.platform) {
      const value = v.options[name];
      if (value !== undefined && !values.includes(value)) values.push(value);
    }
    const options = [
      '<option value="">Choose an option</option>',
      ...values.map((value) => `<option value="${esc(value.toLowerCase())}">${esc(value)}</option>`),
    ].join('');
    return (
      `<tr><th class="label"><label for="pa_${lower}">${esc(name)}</label></th>` +
      `<td class="value"><select id="pa_${lower}" name="attribute_pa_${lower}">${options}</select></td></tr>`
    );
  });
  return `<form class="variations_form cart"><table class="variations">${rows.join('')}</table></form>`;
}

/** Two other products, the next ones in catalogue order, wrapping round to the start. */
function relatedSection(shop: Shop, index: number, origin: string): string {
  const n = shop.products.length;
  const picks = [1, 2].map((k) => (index + k) % n).filter((i) => i !== index);
  const items = picks.map((i) => {
    const other = shop.products[i]!;
    return (
      `<li class="product"><a href="${esc(productUrl(origin, other.slug))}">` +
      `<h2 class="woocommerce-loop-product__title">${esc(other.title)}</h2>` +
      `<span class="price">${money(other.page.price)}</span></a></li>`
    );
  });
  return `<section class="related products"><h2>Related products</h2><ul class="products">${items.join('')}</ul></section>`;
}

/** The product as its page states it to this client. Only a page with an `agent` override tells agents anything else. */
function asSeenBy(p: ProductSays, client: Client): ProductSays {
  if (client !== 'agent' || !p.agent) return p;
  return { ...p, jsonld: p.agent.jsonld ?? p.jsonld, page: { ...p.page, reviews: p.agent.reviews ?? p.page.reviews } };
}

/** The product page, or null when the shop has no such product (the server answers 404). */
export function renderProductPage(shop: Shop, slug: string, origin: string, client: Client = 'person'): string | null {
  const index = shop.products.findIndex((x) => x.slug === slug);
  if (index === -1) return null;
  const p = asSeenBy(shop.products[index]!, client);
  const url = productUrl(origin, p.slug);
  const ld = embedJson(jsonLd(shop, p, origin));
  const inStock = p.page.stock === 'in_stock';
  const reviews = p.page.reviews.map(
    (text) => `<li class="review"><div class="comment-text"><div class="description"><p>${esc(text)}</p></div></div></li>`,
  );

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${esc(p.page.title)} | ${SITE}</title>`,
    `<link rel="canonical" href="${esc(url)}">`,
    '<meta property="og:type" content="product">',
    `<meta property="og:title" content="${esc(p.page.title)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="product:price:amount" content="${esc(p.og.price)}">`,
    `<meta property="product:price:currency" content="${esc(p.og.currency)}">`,
    `<meta property="product:availability" content="${p.og.stock === 'in_stock' ? 'in stock' : 'out of stock'}">`,
    `<script type="application/ld+json">${ld}</script>`,
    '</head>',
    '<body>',
    '<main>',
    '<div class="product">',
    '  <div class="summary entry-summary">',
    `    <h1 class="product_title entry-title">${esc(p.page.title)}</h1>`,
    `    ${priceMarkup(p)}`,
    inStock
      ? '    <p class="stock in-stock">In stock</p>'
      : '    <p class="stock out-of-stock">Out of stock</p>',
    `    ${variationsForm(p)}`,
    `    <div class="woocommerce-product-details__short-description">${p.page.descriptionHtml}</div>`,
    '  </div>',
    `  <div id="reviews"><ol class="commentlist">${reviews.join('')}</ol></div>`,
    `  ${relatedSection(shop, index, origin)}`,
    '</div>',
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function renderHome(shop: Shop, origin: string): string {
  const links = shop.products
    .map((p) => `<li><a href="${esc(productUrl(origin, p.slug))}">${esc(p.title)}</a></li>`)
    .join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${SITE}</title>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${SITE}</h1>`,
    '<ul>',
    links,
    '</ul>',
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function renderSitemap(shop: Shop, origin: string): string {
  const urls = shop.products.map((p) => `<url><loc>${esc(productUrl(origin, p.slug))}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function renderRobots(origin: string): string {
  return [
    'User-agent: *',
    'Disallow: /cart/',
    'Disallow: /checkout/',
    'Disallow: /my-account/',
    'Disallow: /*?add-to-cart=',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}
