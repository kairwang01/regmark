# Quickstart

Run a known example first, then audit a small sample of your shop. The bundled CLI requires Node.js 22 or later. Source development requires Node.js 22.18 or later for native TypeScript execution.

## 1. Download and verify a pinned release

Start in an empty directory with Node.js 22 or later. Download both files from the official [v0.2.0 release](https://github.com/kairwang01/regmark/releases/tag/v0.2.0):

```bash
mkdir regmark-try && \
cd regmark-try && \
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.2.0/regmark.mjs && \
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.2.0/regmark.mjs.sha256 && \
sha256sum -c regmark.mjs.sha256 && \
node regmark.mjs --help
```

Expect `regmark.mjs: OK`. On macOS, replace the checksum command with `shasum -a 256 -c regmark.mjs.sha256`. Do not run the bundle if verification fails. The release is a single file with no runtime package-installation step. The download needs network access; the local demo does not contact a live shop.

**npm availability:** `https://registry.npmjs.org/regmark/latest` returned HTTP 404 on 2026-10-10. `npx regmark` and `npm install regmark` are not verified installation paths. Use the release file above; the examples below consistently use `node regmark.mjs`.

The checksum and clean-directory `--help`, `demo` and `demo --clean` commands were verified with the published v0.2.0 bundle on Node 24.19.0. A pinned release keeps its original implementation, including any limitations fixed later in source. Read the [configuration reference at v0.2.0](https://github.com/kairwang01/regmark/blob/v0.2.0/docs/configuration.md) for that release; use a [source checkout](#development) for unreleased changes. The [GitHub Action](ci.md) is another installation path.

## 2. See a finding without connecting a shop

```bash
node regmark.mjs demo
```

This starts a temporary local synthetic fixture shop, audits it and closes it. Open `regmark-demo.html` in your browser. The 27 seeded defects produce 31 findings: for example, its feed says `22.00 USD` while its fixture cart charges `24.00 USD` for the same variant. The demo deliberately enables the fixture's cart and cloaking probes; a normal audit does not. No shop credentials are needed.

```bash
node regmark.mjs demo --clean --html regmark-clean.html
```

Open `regmark-clean.html` for the zero-finding control. Both demo commands exit `0`, including the intentionally defective fixture. Use `audit` for a CI gate. The two fixtures demonstrate output; switching to the clean one is not evidence of a real shop being fixed or a measured accuracy rate.

## 3. Audit your shop with read-only requests

```bash
node regmark.mjs audit https://shop.example --sample 5 --html report.html --json report.json
```

Replace `https://shop.example` with the shop you want to inspect. Add the feed if you know its URL:

```bash
node regmark.mjs audit https://shop.example --feed /feeds/google.xml \
  --sample 5 --html report.html --json report.json
```

A relative feed URL is resolved against the shop's origin. An absolute feed URL on another host is allowed because you explicitly named it. `--feed` expects a URL, not a local filesystem path.

Regmark tries WooCommerce, then Shopify. It reads the public catalogue when available, and the server-returned HTML for each sampled product. It does not execute JavaScript. With no checkout configuration, the default baseline is the platform API, falling back to the visible page. What a real cart charges is only read when a verified checkout probe runs, on WooCommerce or Shopify.

Add the surfaces shopping agents read when the shop has them. They are read-only too:

```bash
node regmark.mjs audit https://shop.example --ucp --mcp --acp-feed /feeds/acp.jsonl.gz \
  --sample 5 --html report.html
```

`--ucp` discovers the shop's Universal Commerce Protocol profile at `/.well-known/ucp` and reads its catalogue; `--mcp` asks the shop's storefront MCP server about the same products; `--acp-feed` reads an Agentic Commerce Protocol product feed. Give the feed's age limit with `--max-age feed=24h` to have a stale feed reported. [What each reads](configuration.md).

Each host is paced at one request per second by default, so catalogue, page and variation reads can take minutes. Use `--verbose` for progress in a CI log. Start with a small sample before increasing coverage.

## 4. Read the report and fix one disagreement

1. Check the collected surfaces, product/variant counts, collection issues and skipped rules. A source that could not be read cannot establish that its data is correct.
2. Read a finding's `actual` and `expected` values. The expected value identifies the observation chosen as the baseline.
3. Follow the source locator: a feed item, JSON-LD path, meta tag or API field.
4. Read the rule's explanation and fix the data producer, cache or configuration it identifies.
5. Repeat the same audit with the same sample and seed to compare results.

```bash
node regmark.mjs explain price.mismatch
node regmark.mjs rules
```

For example, a feed price of `22.00 USD` against a platform price of `24.00 USD` points to a disagreement with the platform; it does not establish that checkout charges `24.00 USD`. Add a verified probe when that distinction matters.

A normal `audit` exits `1` when an error rule exceeds its default zero budget. This is a useful result: its report files are still written. Exit `2` means a configuration/execution problem or no readable products. `--strict` also makes any collection issue exit `2`. [Exit codes and collection issues](configuration.md#exit-codes).

## 5. Save the setup

```bash
node regmark.mjs init https://shop.example
```

Edit the generated `regmark.config.json`:

```json
{
  "store": "https://shop.example",
  "platform": "auto",
  "feed": "/feeds/google.xml",
  "sample": 25,
  "seed": 1,
  "budget": {
    "price.mismatch": 0
  }
}
```

```bash
node regmark.mjs audit --html report.html --json report.json
```

CLI flags override matching file fields. Budgets merge per rule. A `checkout` object in the config turns on cart probing, even without `--checkout`; keep a separate read-only config if you use both modes. Prefer the environment variable for the ownership token. [Full precedence rules](configuration.md#precedence).

## Optional: the cart probe and the cloaking check

These checks are optional. Use a staging shop you control; do not add them to the read-only trial above. Create a token containing 16–128 letters, digits, `_` or `-`, serve `regmark-verify=<token>` at `/.well-known/regmark.txt`, and put that token in the `REGMARK_OWNERSHIP_TOKEN` environment variable or CI secret. DNS TXT verification is also supported.

```bash
node regmark.mjs audit https://staging.shop.example --feed /feeds/google.xml \
  --checkout --ship-to US:94103 --cloaking --html report.html
```

On a Shopify shop, use `--platform shopify`.

The probe creates cart/session state, adds one unit per tested variant, sets the destination, reads the price, shipping and (on WooCommerce) the total, and empties the cart after each variant. It does not place an order or pay. On Shopify, tax is only known at checkout, so the probe reads the line price, whether the cart accepts the variant, and the shipping estimate. The cloaking check fetches each sampled page again as a browser and as a shopping agent and reports a page that tells them different prices or stock levels; it costs one extra request per page per client. Verify that the report includes checkout observations and review any cleanup or ownership issue. [Verification details](configuration.md#writes).

## Common problems

| Symptom | What to check or do |
|---|---|
| `regmark` command not found, or npm returns 404 | Run `node regmark.mjs` from the directory where you downloaded and verified the bundle |
| Cannot find `regmark.mjs` | Change to the download directory, or use its absolute path after `node` |
| Checksum verification fails | Stop; re-download the bundle and checksum from the same pinned official release and verify again |
| TypeScript source fails before running | Use Node 22.18+ for source development; the bundled release supports Node 22+ |
| Nothing is printed in a CI log for a while | Add `--verbose`; request pacing applies to catalogue and page reads |
| No product could be read | Inspect collection issues; set `--platform`, or use `--platform none --page /product/example/` |
| Theme price is absent | Check the raw HTML; configure `page.priceSelector` and `page.currency` if needed |
| Price only appears after JavaScript runs | Regmark reads static response HTML; provide server-rendered facts or use browser testing alongside it |
| Private-address request refused | For your local/staging network, explicitly add `--allow-private-network` |
| Ownership check or probe is skipped | Check the store hostname, served token, environment variable and platform detection |
| Report passes with collection issues | Default mode preserves partial results; `--strict` rejects any collection issue |
| `--ucp` or `--mcp` reports a version or not-found issue | The shop may not offer that endpoint, or may speak a protocol version Regmark does not read yet; the issue names which |
| Too few variants were checked | Inspect catalogue limits, `sample`, `maxVariants` and missing/blocked source issues |
| A finding seems wrong | Attach the rule, values, locators and a minimal sanitized fixture to a [false-alarm issue](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml) |

To inspect a particular static page without sampling a platform catalogue:

```bash
node regmark.mjs audit https://shop.example --platform none --page /product/example/ \
  --html page-report.html
```

`--page` alone changes the page list, but still allows the platform sample to be read. Pair it with `--platform none` when you want only the named pages. [Coverage details](configuration.md#what---page-does).

## Development

Use the pnpm version in `package.json`:

```bash
git clone https://github.com/kairwang01/regmark.git
cd regmark
pnpm install --frozen-lockfile
node packages/cli/src/bin.ts demo
pnpm test
pnpm bench
pnpm typecheck
```

For a source checkout, use Node.js 22.18 or later. The source demo and tests need no platform credentials. `pnpm bundle` builds the single-file CLI. See [Contributing](../CONTRIBUTING.md) before changing rules or collectors, and the [CI guide](ci.md) to adopt a recurring audit.
