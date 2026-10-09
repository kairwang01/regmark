# Changelog

Rule ids and the JSON report schema are the two things other people build on.
A change to either is called out here under **Breaking**.

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
  starts without an install step.

### Known limits

- No collector yet for UCP, ACP or MCP endpoints.
- The checkout probe supports WooCommerce only.
- `availability.stale` and `content.cloaking` are specified but not built.
- The rules have been run against few real shops. Reports of false alarms are
  what this release needs most.
