import { load, type CheerioAPI } from 'cheerio';

/** Extractors accept raw HTML or the same read-only document for a whole page. */
export type PageSource = string | CheerioAPI;

export function documentOf(source: PageSource): CheerioAPI {
  return typeof source === 'string' ? load(source) : source;
}
