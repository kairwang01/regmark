// Run from the repository with: node scripts/benchmark-page.ts
// Compares the previous five-DOM strategy using today's individual readers
// with extractPage's shared DOM. This is a parsing microbenchmark, not a
// benchmark of network requests, checkout, or an entire audit. It does not
// execute a historical checkout of the project.

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { CollectResult, Sighting } from '../packages/core/src/index.ts';
import {
  extractJsonLd,
  extractMicrodata,
  extractOpenGraph,
  extractPage,
  extractText,
  extractVisible,
} from '../packages/collect-page/src/index.ts';

const pageUrl = 'https://shop.example/p/a';
const fetchedAt = '2026-10-09T00:00:00Z';
const html = `<main><h1>Product</h1><div class="summary"><p class="price">12.00 USD</p></div><div class="product__description">${'<p>A product with some details and <strong>features</strong>.</p>'.repeat(500)}</div><script type="application/ld+json">{"@type":"Product","sku":"A","offers":{"@type":"Offer","price":"12","priceCurrency":"USD"}}</script></main>`;

const warmups = 4;
const pagesPerRound = 12;
const roundCount = 3;

/** Reproduces page aggregation while each of the five readers parses HTML. */
function independentReaders(): CollectResult {
  const jsonld = extractJsonLd(html, pageUrl, fetchedAt);
  const microdata = extractMicrodata(html, pageUrl, fetchedAt);
  const opengraph = extractOpenGraph(html, pageUrl, fetchedAt);
  const currencies = new Set<string>();
  for (const sighting of [...jsonld.sightings, ...microdata.sightings, ...opengraph.sightings]) {
    if (sighting.price?.value.currency) currencies.add(sighting.price.value.currency);
  }
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  const visible = extractVisible(html, pageUrl, fetchedAt, { currency });
  const sightings: Sighting[] = [...visible.sightings, ...jsonld.sightings, ...microdata.sightings, ...opengraph.sightings];
  const text = extractText(html, pageUrl);
  if (text.length > 0) {
    const carrier = visible.sightings[0];
    if (carrier) carrier.text = text;
    else sightings.unshift({ surface: 'page', scope: 'product', ids: { url: pageUrl }, text });
  }
  return { sightings, issues: [...visible.issues, ...jsonld.issues, ...microdata.issues, ...opengraph.issues] };
}

const sharedDom = (): CollectResult => extractPage(html, pageUrl, fetchedAt);
assert.deepEqual(independentReaders(), sharedDom(), 'both strategies must produce the same evidence');

for (let i = 0; i < warmups; i++) {
  independentReaders();
  sharedDom();
}

function measure(run: () => CollectResult): number {
  const start = performance.now();
  for (let page = 0; page < pagesPerRound; page++) run();
  return (performance.now() - start) / pagesPerRound;
}

const samples: { independentReaders: number; sharedDom: number }[] = [];
for (let round = 0; round < roundCount; round++) {
  // Alternate execution order to reduce a consistent warm-cache advantage.
  if (round % 2 === 0) {
    const independent = measure(independentReaders);
    samples.push({ independentReaders: independent, sharedDom: measure(sharedDom) });
  } else {
    const shared = measure(sharedDom);
    samples.push({ independentReaders: measure(independentReaders), sharedDom: shared });
  }
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const rounded = (value: number): number => Number(value.toFixed(2));
const before = median(samples.map((sample) => sample.independentReaders));
const after = median(samples.map((sample) => sample.sharedDom));

console.log(JSON.stringify({
  scope: 'Synthetic HTML parsing only: independent readers versus shared DOM; not a full-audit benchmark or a historical-version comparison.',
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  bytes: Buffer.byteLength(html),
  warmupsPerMethod: warmups,
  pagesPerRound,
  rounds: samples.map((sample, index) => ({
    round: index + 1,
    independentReadersMsPerPage: rounded(sample.independentReaders),
    sharedDomMsPerPage: rounded(sample.sharedDom),
  })),
  median: { independentReadersMsPerPage: rounded(before), sharedDomMsPerPage: rounded(after) },
  beforeAfter: { reductionPercent: rounded((1 - after / before) * 100), ratio: rounded(before / after) },
  validation: 'Equivalent parsed evidence before timing',
}, null, 2));
