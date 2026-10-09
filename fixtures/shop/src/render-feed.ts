// Printing the shop's merchant feed in Google's RSS 2.0 format. A pure
// function of the Shop data.

import type { ProductSays, Shop, VariantSays } from './shop.ts';

/** Text content only needs the three characters that open markup or start an entity. */
function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A price with its currency, or the bare number when the surface gives no currency. */
function money(amount: string, currency: string | null): string {
  return xml(currency === null ? amount : `${amount} ${currency}`);
}

function variantUrl(origin: string, p: ProductSays, v: VariantSays): string {
  const base = `${origin}/product/${p.slug}/`;
  const entries = Object.entries(v.options);
  if (entries.length === 0) return base;
  const query = entries
    .map(([name, value]) => `attribute_pa_${encodeURIComponent(name.toLowerCase())}=${encodeURIComponent(value.toLowerCase())}`)
    .join('&');
  return `${base}?${query}`;
}

function priceLines(shop: Shop, v: VariantSays): string[] {
  if (v.listPrice === null) return [`<g:price>${money(v.price, v.currency)}</g:price>`];
  const lines = [
    `<g:price>${money(v.listPrice, v.currency)}</g:price>`,
    `<g:sale_price>${money(v.price, v.currency)}</g:sale_price>`,
  ];
  if (v.saleEnds !== null) {
    // The window opens a week before the shop's clock, so a sale that started recently still validates.
    const start = `${isoDate(new Date(shop.now.getTime() - 7 * 86_400_000))}T00:00:00Z`;
    lines.push(`<g:sale_price_effective_date>${start}/${v.saleEnds}T23:59:59Z</g:sale_price_effective_date>`);
  }
  return lines;
}

function variantItem(shop: Shop, p: ProductSays, v: VariantSays, origin: string): string {
  const optionValues = Object.values(v.options);
  const title = optionValues.length > 0 ? `${p.title} - ${optionValues.join(' / ')}` : p.title;
  // Google groups variants under one item_group_id only when there is a group to join.
  const grouped = p.feed.length > 1;

  const lines = [
    `<g:id>${xml(v.sku)}</g:id>`,
    `<g:title>${xml(title)}</g:title>`,
    `<g:link>${xml(variantUrl(origin, p, v))}</g:link>`,
    ...priceLines(shop, v),
    `<g:availability>${v.stock}</g:availability>`,
    '<g:condition>new</g:condition>',
  ];
  if (v.gtin !== null) lines.push(`<g:gtin>${xml(v.gtin)}</g:gtin>`);
  if (v.mpn !== null) lines.push(`<g:mpn>${xml(v.mpn)}</g:mpn>`);
  lines.push(`<g:brand>${xml(p.brand)}</g:brand>`);
  if (grouped) lines.push(`<g:item_group_id>${xml(p.slug)}</g:item_group_id>`);
  for (const [name, value] of Object.entries(v.options)) {
    const tag = `g:${name.toLowerCase()}`;
    lines.push(`<${tag}>${xml(value)}</${tag}>`);
  }
  if (v.shipping !== null) {
    lines.push(
      `<g:shipping><g:country>${xml(v.shipping.country)}</g:country><g:service>Standard</g:service>` +
        `<g:price>${xml(v.shipping.cost)} ${xml(shop.currency)}</g:price></g:shipping>`,
    );
  }
  return lines.join('\n');
}

function ghostItem(shop: Shop, origin: string, g: Shop['feedGhosts'][number]): string {
  return [
    `<g:id>${xml(g.id)}</g:id>`,
    `<g:title>${xml(g.title)}</g:title>`,
    `<g:link>${xml(`${origin}/product/${g.slug}/`)}</g:link>`,
    `<g:price>${xml(g.price)} ${xml(shop.currency)}</g:price>`,
    `<g:availability>${g.stock}</g:availability>`,
    '<g:condition>new</g:condition>',
    `<g:gtin>${xml(g.gtin)}</g:gtin>`,
    '<g:brand>Northfold</g:brand>',
  ].join('\n');
}

export function renderFeed(shop: Shop, origin: string): string {
  const items: string[] = [];
  for (const p of shop.products) {
    for (const v of p.feed) items.push(variantItem(shop, p, v, origin));
  }
  for (const g of shop.feedGhosts) items.push(ghostItem(shop, origin, g));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    '<title>Northfold</title>',
    `<link>${xml(origin)}/</link>`,
    '<description>Northfold product feed</description>',
    // toUTCString writes the RFC 822 form RSS asks for: "Fri, 09 Oct 2026 12:00:00 GMT".
    `<lastBuildDate>${shop.feedBuiltAt.toUTCString()}</lastBuildDate>`,
    ...items.map((body) => `<item>\n${body}\n</item>`),
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}
