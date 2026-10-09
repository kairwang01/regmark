# Discovery, documentation and launch plan

Regmark should be discoverable for a concrete problem: **ecommerce product-data mismatches**. Search visibility and community interest should follow useful examples, reliable checks and easy contribution paths. This plan proposes actions and measurements; it makes no forecast of stars, rankings or AI citations.

Official references were reviewed on 2026-10-09. Recheck platform documentation when publishing a release or changing the website.

## GitHub metadata

Use the same meaning in GitHub About, package metadata and the project landing page. Repository files do not automatically update the GitHub About panel; that setting must also be saved through GitHub or its API. The description and topics below are the recommended values for the 0.2.0 release; the GitHub About panel must be updated by hand.

**Description**

> Catch price, stock and shipping mismatches between product pages, JSON-LD, feeds, AI shopping-agent endpoints (UCP, MCP, ACP) and checkout. CLI and GitHub Action for WooCommerce & Shopify.

**Topics**

```text
ecommerce woocommerce shopify google-merchant-center product-feed
json-ld structured-data schema-org data-quality price-parity cli
github-actions sarif typescript seo agentic-commerce testing
ucp mcp ai-agents
```

These 20 topics describe existing capabilities or the problem domain. `ucp`, `mcp` and `agentic-commerce` refer to the agent-protocol readers; keep the README explicit about the protocol versions they read and that they only read. GitHub supports at most 20 topics, with lowercase letters, numbers and hyphens and at most 50 characters per topic. [GitHub topic documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics).

Keep the homepage at `https://opensource.kairwang.cloud/regmark/` while it remains the maintained project site. Verify the deployed page after metadata changes, and link its primary “Try it” action to the current quickstart.

## Search intent and useful content

| Reader's task | Canonical project content | Useful original evidence |
|---|---|---|
| Diagnose a WooCommerce feed price mismatch | README example plus `price.mismatch` rule documentation | One sanitized feed/API/cart discrepancy with the fix |
| Check JSON-LD prices after a theme update | Quickstart and page extraction configuration | A minimal theme fixture and before/after report |
| Audit Shopify product data and carts | Supported-surface table and the checkout probe | Catalogue, UCP and cart readings with their limits (no tax before checkout) |
| Add ecommerce checks to GitHub Actions | CI guide | A reproducible workflow, artifact and failure log |
| Evaluate product data for shopping assistants | Positioning, the agent endpoints and the cloaking check | What UCP, MCP and ACP feeds tell an agent, compared with the cart |

Use these as editorial topics, not as a mandate to create one page per keyword variation. The documentation should answer a real workflow question and link to the rule, command and reproducible evidence involved.

## Website metadata handoff

The external project website may have its own repository/deployment. The following is an implementation specification for that site, not a claim that it has already been deployed:

| Field | Suggested value or behavior |
|---|---|
| HTML title | `Regmark — Ecommerce data consistency checks for CI` |
| Meta description | `Find price, stock and shipping mismatches across product pages, JSON-LD, feeds and storefront APIs. Open-source CLI for WooCommerce and Shopify.` |
| Canonical URL | The final public URL of each page; use the existing project homepage for the landing page |
| Open Graph title/description | Match the page's visible title and summary |
| Open Graph image | Public absolute URL for a 1280 × 640 preview with readable text and the report visual |
| Social card | `summary_large_image`, with the same title, description and preview |
| Language | Correct HTML `lang`; reciprocal `hreflang` only if separately deployed English/Chinese pages exist |
| Crawl/discovery | Crawlable pages, a sitemap listing real canonical URLs, working internal links and no accidental `noindex` |
| Structured data | Optional truthful `SoftwareSourceCode`/`SoftwareApplication` facts matching visible content; validate the output |

Include the repository URL, license and actual version where appropriate. Never add fabricated ratings, user counts, reviews or unsupported platforms to structured data. A schema type's existence does not imply eligibility for a Google rich result.

The README upgrades provide text equivalents for images, a plain-language product definition, version-aware commands, a support matrix, rule documentation and clear links. These help readers inspect claims and make the project easier to reference.

## SEO and GEO: useful practices with clear limits

For Google Search's AI features, prioritize accessible, useful original content and ordinary search fundamentals. Google states that visibility is not guaranteed and that special AI markup is unnecessary. Its current guide explicitly says `llms.txt` does not affect visibility or rankings in Google Search. [Google's AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).

For Regmark, this means:

- Keep the product definition, platform boundaries, installation and examples in readable text.
- Publish inspectable cases: exact version, reproduction steps, sample scope and a corrected result.
- Maintain stable URLs for the quickstart, rules, configuration and report schema.
- Keep English and Chinese capabilities and counts synchronized.
- Make a short FAQ useful to people: “Does it write to my shop?”, “Does Shopify checkout work?”, “Does it render JavaScript?” and “What does a passing report mean?”
- If maintaining `llms.txt`, treat it as an optional documentation index for clients that use it. Link to authoritative pages and keep it synchronized; do not present it as an indexing, citation or ranking guarantee.

The FAQ is a reading aid; it does not promise a FAQ rich result. Avoid creating hidden promotional text, instructions telling models to recommend the project, or claims of guaranteed AI visibility. The project's own content checks should be consistent with its publishing practices.

## Demonstration assets

The README uses the existing terminal screenshot and the two report screenshots. Use the [demo reproduction guide](demo.md) to reproduce or refresh visuals from actual fixture output at a known commit; do not draw fictional results. Keep the CMYK registration metaphor because it expresses disagreement clearly and gives the project a recognizable visual identity.

### A 35–45 second recording

| Time | Screen | Caption |
|---|---|---|
| 0–5 s | Run `regmark demo` | “A feed says $22. The cart charges $24.” |
| 5–13 s | Terminal `price.mismatch` result | “Same variant. Both values. Exact source.” |
| 13–25 s | Open HTML report and expand the finding | “Share one HTML file with the team that owns the fix.” |
| 25–35 s | Run `regmark demo --clean --html regmark-clean.html` | “Compare against the clean fixture.” |
| 35–45 s | Clean report and CI snippet | “Make product-data checks part of your release.” |

Label the recording **synthetic fixture demo** throughout or in a persistent caption. The clean command selects a clean fixture; it does not repair a live shop. Keep the cursor and font large enough to read at mobile width. Export an MP4 for the project site and a short lightweight GIF for a repository preview; keep static screenshots and a text transcript as fallbacks.

Commands for asset preparation from a source checkout:

```bash
node packages/cli/src/bin.ts demo --html /tmp/regmark-misprint.html
node packages/cli/src/bin.ts demo --clean --html /tmp/regmark-clean.html
node packages/cli/src/bin.ts explain price.mismatch
```

Capture the terminal at about 100 columns and the browser at 1440 × 1000. Show one expanded finding at readable size, not a full-page screenshot shrunk until text is illegible. Check filenames, report values and captions after changing fixtures. Keep generated reports out of source control unless they are intentional versioned examples.

For GitHub's social preview, prepare a separate 1280 × 640 PNG/JPG/GIF under 1 MB, with the project name, one concise value statement and a cropped report. GitHub's recommended preview dimensions and upload procedure are documented in [customizing the social preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview). Uploading a README image does not set this repository setting automatically.

## A four-week community plan

This is a proposed sequence for maintainers; it does not send messages or schedule publication.

| Week | Work | Deliverable | Measure |
|---|---|---|---|
| 1 | Validate onboarding and capture demo | Tested quickstart, current bundle, release notes, 45-second recording | Can new evaluators get a report without maintainer intervention? |
| 2 | Work with willing WooCommerce/feed maintainers | A small set of reviewed, sanitized cases and regression fixtures | Confirmed defects, false alarms and first-response time |
| 3 | Publish one technical case study and a release announcement in relevant channels, following each community's rules | Problem → minimal reproduction → fix → limitations → repository link | Qualified visits, useful issue reports and completed first audits |
| 4 | Improve the most common onboarding/extraction failure and publish the evidence | Follow-up release, fixture additions and contribution opportunities | Repeat use, external contributions and reviewed issue resolution |

Appropriate audiences include WooCommerce developers, ecommerce engineering teams, feed specialists and technical SEO practitioners. Start where the case study solves an active problem. Do not repeat the same promotional message across unrelated communities or use unsolicited bulk outreach.

Possible article titles:

- “The schema was valid. The price was wrong: debugging a WooCommerce feed mismatch.”
- “Checking JSON-LD, merchant feeds and cart totals in one CI job.”
- “What a static Shopify product-data audit can—and cannot—tell you.”

## Measure adoption before optimizing for stars

Track a small weekly scorecard without adding CLI telemetry:

| Metric | Collection method | Interpretation |
|---|---|---|
| Repository visitors and clones | GitHub repository traffic, with available reporting windows noted | Discovery and interest; not confirmed usage |
| Release asset downloads | GitHub release statistics | Distribution signal; not unique active users |
| First successful audit | Voluntary feedback or moderated user sessions | Whether onboarding reaches useful output |
| Confirmed findings / reviewed findings | Label and review submitted cases | Quality of reported cases; subject to reporting bias |
| Time to first maintainer response | Issue timestamps | Contributor experience |
| External contributors and repeat contributions | Repository history | Community participation |
| Weekly star change | GitHub stargazer count | Secondary awareness signal; not product value |

Record a baseline before a launch and compare consistent time windows. Do not invent current values or infer real-world accuracy from the synthetic fixture benchmark. Use the results to decide whether the next release should improve reliability, onboarding or a specific collector.
