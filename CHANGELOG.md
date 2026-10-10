# Changelog

Rule ids and the JSON report schema are the two things other people build on.
A change to either is called out here under **Breaking**.

## Unreleased

### Fixed

- Preserve per-product uncertainty when WooCommerce variant details cannot be
  read, so incomplete collection cannot imply that a feed variant no longer
  exists. Metadata-only coverage does not count as a successfully read product.
- Match raw Unicode robots.txt paths against UTF-8 percent-encoded URLs,
  preserving wildcard, anchor and reserved-escape semantics.
- Resolve relative sitemap entries against the final response URL after redirects.
- Keep successful sitemap children when a sibling cannot be fetched, report
  the failed child, and retain strict-mode collection failures.
- Use explicit Unicode escapes in the JUnit XML sanitizer so TypeScript 7
  accepts its character ranges; preserve legal astral text and strip isolated
  surrogates and disallowed XML characters.

### Documentation

- Lead the English and Chinese quickstarts with a pinned, checksum-verified
  standalone release. The npm package was unavailable when checked.
- Clarify the read-only baseline and optional owner-verified cart evidence.

## 0.2.0 (2026-10-09)

Regmark now reads what shopping agents read, checks two things it could only
describe before, probes Shopify carts, and installs from npm.

### What it reads

- **The Y plate.** `--ucp` discovers a shop's Universal Commerce Protocol
  profile at `/.well-known/ucp` and reads its catalogue for the sampled
  products. `--mcp` asks the shop's storefront MCP server about the same
  products. `--acp-feed <url>` reads an Agentic Commerce Protocol product feed.
  All three only read, and each is a surface the existing rules check: a stale
  price, a sold-out variant offered as available, or a catalogue that lists
  only some sizes is reported like any other disagreement.
- **Shopify carts.** `--checkout` now works on Shopify through the storefront
  cart endpoints: whether the cart accepts each variant, the line price and
  the cheapest shipping rate to the probe destination. Tax is known only at
  checkout, so the Shopify probe reports no landed total. The same guarantees
  as on WooCommerce: ownership verified first, no payment step, the cart
  emptied after every item.
- Feeds record when they say they were generated: RSS `lastBuildDate` or
  `pubDate`, Atom `updated`, else the `Last-Modified` header.

### What it reports

- `availability.stale` (warn): a feed older than the age you allow it with
  `--max-age feed=24h`. Reported once per feed, not once per item. Skipped,
  visibly, when no age is set or the feed carries no timestamp.
- `content.cloaking` (error): a product page that tells a shopping agent a
  different price or stock level than it tells a browser. `--cloaking` reads
  each sampled page again as a browser and as an agent and compares the facts
  each was told, never the markup. Text that only agents are shown is also
  checked by the other content rules.
- Seventeen rules in all. The fixture shop has 27 planted defects that
  should give 31 findings; the benchmark requires every one of them and
  nothing else, and nothing at all from the clean shop.

### Running it

- `npx regmark` from the npm registry, instead of a git install.
- The GitHub Action, now **Regmark ecommerce audit** on Marketplace, gains
  inputs for every new check (`acp-feed`, `ucp`, `mcp`, `cloaking`,
  `max-age`, `pages`, `strict`), outputs with the counts (`findings`,
  `errors`, `warnings`, `products`, `exit-code`) and report paths, an
  optional pull request comment that is updated in place (`comment: 'true'`)
  and `upload-report: 'false'` to skip the artifact. CI runs the Action
  itself against both fixture shops.
- `--strict`, `strict: true` and the Action's `strict` input: any collection
  issue fails the audit with exit code 2. Reports keep the diagnostics;
  partial collection is still allowed by default.
- The bundle is 1 MB instead of 2.7 MB: only cheerio's parser is included,
  not the HTTP client and character-set library Regmark never calls.
- The User-Agent names the running version.
- `regmark demo` writes every report format it is asked for (`--json`,
  `--sarif`, `--junit`, `--markdown`), so each can be tried without a shop.
- Releases are cut by a workflow: a `vX.Y.Z` tag on main is verified, released
  as a draft with the bundle and its SHA-256, published to npm with
  provenance, and the `v0` tag is moved to it.

### Fixed

- Validate nested configuration before requests; preserve fetch defaults when
  optional JavaScript properties are explicitly `undefined`.
- Reject unsafe IPv6 translation destinations and redirect URL credentials;
  drop caller headers across origins and close aborted/decompressed responses.
- Stop checkout probing after failed cart cleanup and reject responses for the
  wrong variant. Keep query-based WooCommerce product identities distinct.
- Fix currency and shipping disclosure blind spots, oversized hidden-text
  crashes, malformed TSV handling and delimiter collisions in SARIF identities.
- Keep variants that share one SKU, as shops that put the style number on
  every size do, apart by their backend ids, instead of comparing each with
  the first.
- Read prices in BIF, DJF, GNF, KMF, RWF, UYI and VUV (no minor unit) and CLF
  and UYW (four digits) by their ISO 4217 exponent.
- Resolve a sitemap `<loc>` written as a path against the sitemap's URL. A
  collector that stops on something it cannot read now costs that surface
  only (`collect-failed`), not the whole run.

### Performance

- Parse each product page's DOM once for all five readers.
- Reuse the WooCommerce catalogue listing when selecting sampled variants.

### Compatibility notes

- **New rule ids:** `availability.stale` and `content.cloaking`. Both are
  skipped unless asked for. An existing configuration otherwise reports what
  it did, apart from the corrections listed here, which can move the counts a
  budget is set from: fewer false alarms from related-product markup (a
  product under `isRelatedTo`, `isSimilarTo`, `isAccessoryOrSparePartFor`,
  `isConsumableFor` or an `itemListElement` is no longer read as the page's
  own), and a Google feed `shipping` entry with transit days, such as
  `US:CA:Overnight:16.00 USD:1:1:2:3`, read as `16.00 USD` instead of `3`.
- **New surfaces in reports:** `acp`, `ucp` and `mcp` appear in `surfaces`,
  findings and issues when those collectors run. The JSON schema identifier
  stays `regmark.audit/v0`.
- **Breaking behaviour correction:** an empty audit now has JSON `ok: false`.
  JUnit and SARIF now expose collection failures instead of presenting an
  empty run as successful.
- **Identity correction:** product keys retain `p`, `product_id` and `product`
  query parameters. Affected alert identities can change once after upgrading.
- Invalid nested configuration now fails before network access. TypeScript
  optional values remain supported, but strings cannot stand in for booleans.
- `--checkout` with `--platform none` is now a configuration error; with
  `shopify` it runs the new Shopify probe.

## 0.1.0 (2026-10-09)

The first release.

### What it reads

- Product pages: the visible price and stock (WooCommerce markup and Shopify
  Dawn-family themes), JSON-LD including `ProductGroup` with `hasVariant`,
  microdata, Open Graph, and the product's text.
- Merchant feeds in Google's format: RSS 2.0, Atom and tab-separated text.
- WooCommerce: the Store API catalogue, and a checkout probe that reads real
  cart totals after the shop's ownership is verified.
- Shopify: the public catalogue endpoint, read-only.

### What it reports

- Fifteen rules: twelve compare surfaces (price, currency, tax basis, sale
  dates, availability, variants, shipping, identifiers, return policy) and
  three read product text (hidden text, text addressed to a language model,
  invisible characters). `docs/rules.md` defines each one.
- Every rule carries the usual cause and the fix: `regmark explain <rule>`.
- Reports: terminal, HTML, JSON, SARIF, JUnit and Markdown.
- Budgets per rule, and an exit code a CI job can act on.
- A mistake stops the run before it starts. A misspelt field in the config
  file, a platform or surface that does not exist, a budget for a rule that
  does not exist: each is exit code 2 with a message naming it.
- An audit that reads no product exits 2. A shop that is down, or one robots.txt
  closes entirely, is not reported as a pass.

### Running it

- `regmark demo` audits a shop bundled with the tool, with 19 defects planted
  in it.
- `regmark audit <url>` recognises the platform by itself.
- `regmark init <url>` writes a starter config file.
- A GitHub Action that writes the findings to the job summary and keeps the
  reports as an artifact.
- One bundled file, `dist/regmark.mjs`, so `npx github:kairwang01/regmark`
  starts without an install step. The same file is attached to each release,
  for running the tool with no package manager at all.

### Known limits

- No collector yet for UCP, ACP or MCP endpoints.
- The checkout probe supports WooCommerce only.
- `availability.stale` and `content.cloaking` are specified but not built.
- The rules have been run against few real shops. Reports of false alarms are
  what this release needs most.
