# Regmark's positioning

Regmark is an open-source CLI for checking ecommerce product-data consistency. It connects facts about the same product variant across pages, structured data, merchant feeds and supported storefront APIs, then reports conflicting values with their sources. Verified WooCommerce cart probes add checkout observations. The output can be used locally or as a CI regression gate.

This is the project's product direction, grounded in its current implementation. The audience priorities and adoption plan below are hypotheses to validate with users, not measured market share or demand estimates.

## The problem worth owning

A theme renders the current sale price. An SEO plugin writes the regular price into JSON-LD. A feed exporter serves yesterday's value. Each component works independently, and each response can be syntactically valid while the product facts disagree.

Google documents that product price mismatches across feeds, landing pages and structured data can affect approval. This provides a concrete operational reason to check consistency. [Merchant Center's price-mismatch guidance](https://support.google.com/merchants/answer/12159029).

Regmark's useful promise is: **find an observable disagreement, identify the product variant and its source, and make the same check repeatable after a change.** It cannot promise to eliminate disapprovals, recover revenue or influence recommendations; those outcomes depend on more than the facts it checks.

## Start with these users

| Priority | User | Trigger | Useful outcome | Evidence to collect |
|---|---|---|---|---|
| First | WooCommerce developer or agency | Theme/plugin/feed release | A small staging audit that catches a regression and identifies the responsible surface | Reproducible defect, accepted fix, rerun and sustained CI use |
| First | Feed specialist working with an engineering team | Price promotion or stock synchronization change | A shareable report that connects a feed entry to the store value | Time to locate the producer and a confirmed before/after report |
| Next | Shopify storefront developer | Theme or structured-data app update | Public catalogue/page/feed consistency checks | Supported theme samples and confirmed false-positive rate on reviewed findings |
| Later | Teams adopting shopping-agent integrations | Adding protocol-specific product data | The same evidence model extended to another surface | Real endpoint fixtures and a maintained collector; currently roadmap |

Lead with WooCommerce release checks because the implementation can observe both public catalogue data and verified cart behavior there. Treat Shopify as a useful but explicitly read-only workflow. Do not market protocol support before a collector exists.

## Three high-value workflows

### 1. Catch a promotion regression before deployment

Trigger: a theme or pricing plugin changes. Run a small audit on the deployed staging shop, with the staging feed. Inspect `price.mismatch`, `price.currency-ambiguous`, `price.sale-expired` and stock findings. Fix the producing component, then rerun with the same sample and seed.

Success evidence is a reproducible failure followed by a passing audit over the same products. The fixture demo demonstrates this flow; it is not a measurement of production effectiveness.

### 2. Give feed and storefront teams the same evidence

Trigger: a feed and storefront disagree after a scheduled update. Export HTML for human review and JSON for automation. A useful finding includes the rule, variant, both values and both source locations. Keep collection issues visible so an unavailable source is not mistaken for agreement.

The report should make ownership of the fix easier to determine: feed generation, page cache, structured-data plugin, catalogue or cart configuration. Avoid promising a causal diagnosis when the tool only observes a discrepancy.

### 3. Prevent known defects from returning

Trigger: an existing shop has findings that cannot all be fixed in one release. Record reviewed per-rule budgets and lower them as fixes land. Run against a stable staging deployment after each relevant change.

Budgets track counts, not finding identities. A new finding can replace an old one without increasing the count, so review the report diff as well as the exit code. Rotate seeds deliberately for broader exploration; keep a stable seed for comparable regression runs.

## The differentiators to demonstrate

| Capability | Concrete proof in the project | Why it matters |
|---|---|---|
| Variant matching across sources | Offer graph, identity evidence and variant-specific fixtures | Avoids comparing one size's price with another size's stock |
| Explicit baseline | Checkout → platform → page, with configurable `datum` | Makes the comparison explainable and exposes missing authority |
| Source-backed findings | Raw observations and locators in the report model | Lets a maintainer reproduce and fix a discrepancy |
| Optional owned-store cart probing | WooCommerce verification and guarded writes | Adds actual cart observations for the sampled item/destination |
| CI adoption | Per-rule budgets and HTML/JSON/SARIF/JUnit/Markdown outputs | Makes checks repeatable in existing engineering workflows |
| Small local workflow | One bundled CLI and a local fixture demo | Lets users evaluate the project before connecting a shop |

These are implementation characteristics, not claims that no other tool offers them.

## Accurate comparisons

- **Merchant Center diagnostics** remain the authority on Google's processing and policy decisions. Regmark supplies repeatable checks on an operator-selected shop and sample, including staging.
- **Schema and rich-result validators** help assess supported markup requirements. Use them alongside consistency checks; successful parsing does not establish agreement with a cart.
- **Feed validators** vary by product. Compare a particular validator's documented features before publishing a feature matrix; do not label an entire category incapable of parity checks.
- **Browser end-to-end tests** cover interactive journeys and client-rendered behavior that Regmark's static HTML reader does not. Regmark adds ready-made matching, rules and reports.

## Claims we can and cannot substantiate

| Publishable claim | Supporting evidence | Necessary qualification |
|---|---|---|
| 15 rules | [Rule reference](rules.md), `regmark rules` | Some require facts that may be absent or unsupported |
| 19 seeded defects produce 22 findings | `pnpm bench` and local fixture reports | Synthetic benchmark; not a real-world recall estimate |
| Read-only by default | No `checkout` config/flag | A config file can enable checkout; review effective configuration |
| Shopify support | Public catalogue collector and tests | No checkout probe; public endpoint must be accessible |
| CI integration | Action, report writers and example workflows | Coverage and collection issues matter alongside rule budgets |
| No hosted account needed | Local CLI and report generation | Download/install needs network access; live audits contact named hosts |

Avoid “100% accurate,” “all products checked,” “guaranteed Google approval,” “AI-recommended,” “complete prompt-injection defense” and “full WooCommerce/Shopify support.” Public cases should show versions, date, sample scope, confirmed findings and limitations.

## Next proof to earn

Recruit a small number of willing maintainers through appropriate community channels. Ask them to run a read-only sample and share sanitized findings. For each reviewed case, record supported theme/platform version, collection coverage, confirmed findings, false alarms and a minimal regression fixture. Publish only cases whose owners have agreed to attribution.

Prioritize extraction reliability and a usable first report before adding more protocol names. A smaller dependable workflow is easier for users to recommend. The [discovery plan](discoverability.md) turns these proof points into useful launch material and measurable community work.
