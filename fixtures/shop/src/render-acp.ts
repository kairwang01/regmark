// Printing the shop's Agentic Commerce Protocol feed: OpenAI's file-upload
// format as JSON Lines, one record per variant. A pure function of the Shop
// data. The field names and value forms are the spec's own; see
// https://developers.openai.com/commerce/specs/file-upload/products

import { variantUrl } from './render-feed.ts';
import type { ProductSays, Shop, VariantSays } from './shop.ts';

/** "79.99 USD", or the bare amount when the surface gives no currency. */
const money = (amount: string, currency: string | null): string => (currency === null ? amount : `${amount} ${currency}`);

function record(shop: Shop, p: ProductSays, v: VariantSays, origin: string): Record<string, unknown> {
  const optionValues = Object.values(v.options);
  const title = optionValues.length > 0 ? `${p.title} - ${optionValues.join(' / ')}` : p.title;
  // A group needs more than one member, and an id of its own that no item uses.
  const grouped = p.acp.length > 1;
  const out: Record<string, unknown> = { item_id: v.sku };
  if (grouped) {
    out.group_id = p.slug;
    out.listing_has_variations = true;
    out.variant_dict = Object.fromEntries(Object.entries(v.options).map(([name, value]) => [name.toLowerCase(), value]));
  }
  Object.assign(out, {
    title,
    description: p.description,
    url: variantUrl(origin, p, v),
    brand: p.brand,
    seller_name: 'Northfold',
    image_url: `${origin}/images/${p.slug}.jpg`,
  });
  // A sale is written as the regular price plus the sale price; the format has no dates that schedule it.
  if (v.listPrice === null) {
    out.price = money(v.price, v.currency);
  } else {
    out.price = money(v.listPrice, v.currency);
    out.sale_price = money(v.price, v.currency);
  }
  out.availability = v.stock;
  if (v.gtin !== null) out.gtin = v.gtin;
  if (v.mpn !== null) out.mpn = v.mpn;
  if (v.shipping !== null) out.shipping_price = money(v.shipping.cost, shop.currency);
  if (v.returnDays !== null) {
    out.accepts_returns = true;
    out.return_deadline_in_days = v.returnDays;
    out.return_policy = `${origin}/returns/`;
  }
  return out;
}

export function renderAcpFeed(shop: Shop, origin: string): string {
  const lines: string[] = [];
  for (const p of shop.products) {
    for (const v of p.acp) lines.push(JSON.stringify(record(shop, p, v, origin)));
  }
  return lines.map((line) => `${line}\n`).join('');
}
