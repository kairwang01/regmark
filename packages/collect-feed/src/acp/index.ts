// Agentic Commerce Protocol product feeds: read.ts splits the file into
// records, flat.ts reads OpenAI's one-row-per-variant format, nested.ts the
// protocol's Product and Variant model.

import type { CollectIssue, Sighting } from '@regmark/core';
import type { MapContext } from '../map.ts';
import { mapFlat } from './flat.ts';
import { mapProduct } from './nested.ts';
import { readAcp } from './read.ts';

/** Pure. The sightings and issues of one ACP feed, or why the file as a whole cannot be read. */
export function parseAcp(text: string, ctx: MapContext): { sightings: Sighting[]; issues: CollectIssue[] } | { error: string } {
  const read = readAcp(text, ctx.feedUrl);
  if ('error' in read) return read;
  const sightings: Sighting[] = [];
  const issues: CollectIssue[] = [...read.issues];
  for (const record of read.records) {
    if (record.kind === 'flat') {
      const mapped = mapFlat(record, read.profile, ctx);
      if (mapped.sighting) sightings.push(mapped.sighting);
      issues.push(...mapped.issues);
    } else {
      const mapped = mapProduct(record, ctx);
      sightings.push(...mapped.sightings);
      issues.push(...mapped.issues);
    }
  }
  return { sightings, issues };
}
