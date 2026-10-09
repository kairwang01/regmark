// A surface whose own timestamp says it is older than the refresh interval
// the operator set for it. A feed that happens to be right today but was
// generated nine days ago will be wrong tomorrow; availability.mismatch cannot
// see that, because today the values still agree.
//
// SKELETON: the check is implemented in the feed-freshness work. Until then it
// reports nothing; the id, severity and skip condition are final.

import { defineRule } from '@regmark/core';

export default defineRule({
  id: 'availability.stale',
  severity: 'warn',
  summary: 'A feed is older than the refresh interval set for it',
  help:
    'The feed file was generated longer ago than the maxAge configured for it, so whatever it says about price and stock is that old. Check the feed exporter or its scheduled job, and make sure the feed URL serves the latest export rather than a cached copy.',
  needsAny: ['feed', 'acp'],
  requires: (ctx) => (Object.keys(ctx.options.maxAgeMs ?? {}).length ? undefined : 'needs maxAge, such as --max-age feed=24h'),
  check: () => [],
});
