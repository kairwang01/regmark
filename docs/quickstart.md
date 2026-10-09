# Quickstart

Run a known example first, then audit a small sample of your shop. The bundled CLI requires Node.js 22 or later. Source development requires Node.js 22.18 or later for native TypeScript execution.

## 1. See a finding without connecting a shop

```bash
npx --allow-git=all github:kairwang01/regmark demo
```

This installs from the project's GitHub repository, starts a temporary local fixture shop, audits it and closes it. Open `regmark-demo.html` in your browser. The fixture has 19 planted defects that produce 22 findings; for example, its feed says `22.00 USD` while its cart charges `24.00 USD` for the same variant.

```bash
npx --allow-git=all github:kairwang01/regmark demo --clean --html regmark-clean.html
```

The clean fixture should produce zero findings. Both demo commands exit `0`: they demonstrate the reports, including an intentionally failing shop. Use `audit` for a CI gate.

The first run needs network access to obtain the package. The installed demo itself uses only its local fixture. `--allow-git=all` explicitly permits Git installation in npm versions that require it; if an older npm warns about that option, omit it.

## 2. Choose how to run it

| Method | Use when | Command |
|---|---|---|
| GitHub package | Trying the current repository bundle | `npx --allow-git=all github:kairwang01/regmark demo` |
| Global command | Running audits repeatedly | `npm install --global --allow-git=all github:kairwang01/regmark` |
| Release file | Pinning a version in another CI system | Download and run `regmark.mjs` below |
| Source checkout | Developing or trying changes before release | See [Development](#development) |

For a pinned release, download both files from the same release:

```bash
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.1.0/regmark.mjs
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.1.0/regmark.mjs.sha256
sha256sum -c regmark.mjs.sha256
node regmark.mjs demo
```

On macOS, use `shasum -a 256 -c regmark.mjs.sha256` for verification. The release bundle has no runtime package installation step. New source features become available in release downloads when the maintainers publish a version containing them. Use the configuration reference from the same tag as your pinned release.

The remaining examples use the globally installed `regmark`; you can replace it with `node regmark.mjs` or the `npx` invocation.

## 3. Audit your shop with read-only requests

```bash
regmark audit https://shop.example --sample 5 --html report.html --json report.json
```

Replace `https://shop.example` with the shop you want to inspect. Add the feed if you know its URL:

```bash
regmark audit https://shop.example --feed /feeds/google.xml \
  --sample 5 --html report.html --json report.json
```

A relative feed URL is resolved against the shop's origin. An absolute feed URL on another host is allowed because you explicitly named it. `--feed` expects a URL, not a local filesystem path.

Regmark tries WooCommerce, then Shopify. It reads the public catalogue when available, and the server-returned HTML for each sampled product. It does not execute JavaScript. The default baseline is the platform API, falling back to the visible page. What a real cart charges is only read when a verified checkout probe runs, on WooCommerce or Shopify.

Each host is paced at one request per second by default, so catalogue, page and variation reads can take minutes. Use `--verbose` for progress in a CI log. Start with a small sample before increasing coverage.

## 4. Read the report and fix one disagreement

1. Check the collected surfaces, product/variant counts, collection issues and skipped rules. A source that could not be read cannot establish that its data is correct.
2. Read a finding's `actual` and `expected` values. The expected value identifies the observation chosen as the baseline.
3. Follow the source locator: a feed item, JSON-LD path, meta tag or API field.
4. Read the rule's explanation and fix the data producer, cache or configuration it identifies.
5. Repeat the same audit with the same sample and seed to compare results.

```bash
regmark explain price.mismatch
regmark rules
```

For example, a feed price of `22.00 USD` against a platform price of `24.00 USD` points to a disagreement with the platform; it does not establish that checkout charges `24.00 USD`. Add a verified probe when that distinction matters.

A normal `audit` exits `1` when an error rule exceeds its default zero budget. This is a useful result: its report files are still written. Exit `2` means a configuration/execution problem or no readable products. Current source also provides `--strict`, which makes any collection issue exit `2`; check your installed version before using this option. [Exit codes and collection issues](configuration.md#exit-codes).

## 5. Save the setup

```bash
regmark init https://shop.example
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
regmark audit --html report.html --json report.json
```

CLI flags override matching file fields. Budgets merge per rule. A `checkout` object in the config turns on cart probing, even without `--checkout`; keep a separate read-only config if you use both modes. Prefer the environment variable for the ownership token. [Full precedence rules](configuration.md#precedence).

## Optional: a cart probe

Use a staging shop you control. Create a token containing 16–128 letters, digits, `_` or `-`, serve `regmark-verify=<token>` at `/.well-known/regmark.txt`, and put that token in the `REGMARK_OWNERSHIP_TOKEN` environment variable or CI secret. DNS TXT verification is also supported.

```bash
regmark audit https://staging.shop.example --platform woocommerce \
  --feed /feeds/google.xml --checkout --ship-to US:94103 --html report.html
```

On a Shopify shop, use `--platform shopify`.

The probe creates cart/session state, adds one unit per tested variant, sets the destination, reads totals and attempts to empty the cart after each variant. It does not place an order or pay. Verify that the report includes checkout observations and review any cleanup or ownership issue. On Shopify the probe reads the line price and the cheapest shipping rate, but no total, because Shopify works out tax only at checkout, which the probe never reaches. [What the probe reads](configuration.md#the-checkout-probe) · [Verification details](configuration.md#writes).

## Common problems

| Symptom | What to check or do |
|---|---|
| `regmark` command not found | Use the full `npx` command, the release file, or install globally |
| TypeScript source fails before running | Use Node 22.18+ for source development; the bundled release supports Node 22+ |
| Nothing is printed in a CI log for a while | Add `--verbose`; request pacing applies to catalogue and page reads |
| No product could be read | Inspect collection issues; set `--platform`, or use `--platform none --page /product/example/` |
| Theme price is absent | Check the raw HTML; configure `page.priceSelector` and `page.currency` if needed |
| Price only appears after JavaScript runs | Regmark reads static response HTML; provide server-rendered facts or use browser testing alongside it |
| Private-address request refused | For your local/staging network, explicitly add `--allow-private-network` |
| Ownership check or probe is skipped | Check the store hostname, served token, environment variable and WooCommerce platform detection |
| Report passes with collection issues | Default mode preserves partial results; current source's `--strict` rejects any collection issue |
| Too few variants were checked | Inspect catalogue limits, `sample`, `maxVariants` and missing/blocked source issues |
| A finding seems wrong | Attach the rule, values, locators and a minimal sanitized fixture to a [false-alarm issue](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml) |

To inspect a particular static page without sampling a platform catalogue:

```bash
regmark audit https://shop.example --platform none --page /product/example/ \
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

The source demo and tests need no platform credentials. `pnpm bundle` builds the single-file CLI. See [Contributing](../CONTRIBUTING.md) before changing rules or collectors, and the [CI guide](ci.md) to adopt a recurring audit.
