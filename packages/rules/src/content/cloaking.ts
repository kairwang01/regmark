// A product page that states one price or stock level to a browser and
// another to a client that identifies as a shopping agent. content.hidden-text
// sees text hidden inside one response; this rule compares two responses.
//
// SKELETON: the comparison is implemented in the cloaking work. Until then it
// reports nothing; the id, severity and skip condition are final.

import { defineRule } from '@regmark/core';

export default defineRule({
  id: 'content.cloaking',
  severity: 'error',
  summary: 'A page tells an agent a different price or stock level than a browser',
  help:
    'The same product page answered a shopping agent with different facts than it gave a browser. Look for user-agent or bot detection in the theme, a CDN or caching rule that serves bots a separate copy, or a plugin that rewrites structured data for crawlers, and serve every client the same offer.',
  requires: (ctx) => (ctx.graph.products.some((p) => p.alternateViews.length > 0) ? undefined : 'needs --cloaking'),
  check: () => [],
});
