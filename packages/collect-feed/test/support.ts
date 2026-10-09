// Shared fixtures for the feed tests. Nothing here touches the network.

export const FEED_URL = 'https://shop.example/feeds/merchant.xml';
export const FETCHED_AT = '2026-10-08T12:00:00.000Z';
/** Fixed clock: a sale window is judged against this instant. */
export const NOW = new Date('2026-10-08T12:00:00.000Z');

export const GOOGLE_NS = 'xmlns:g="http://base.google.com/ns/1.0"';

export function rss(items: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" ${GOOGLE_NS}>`,
    '<channel>',
    '<title>Shop</title>',
    items,
    '</channel>',
    '</rss>',
  ].join('\n');
}

/** Locator of one feed attribute of one item, as the collector writes it. */
export function at(id: string, field: string): string {
  return `${FEED_URL}#item[id="${id}"]/${field}`;
}

export function observation<T>(value: T, raw: string, locator: string) {
  return { value, raw, surface: 'feed' as const, locator, fetchedAt: FETCHED_AT };
}
