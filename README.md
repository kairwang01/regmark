<p align="center">
  <img src="docs/assets/hero.png" alt="Regmark: does your shop agree with itself? Four surfaces printing four different prices, out of register; then every surface matching the checkout, in register." width="100%">
</p>

<p align="center">
  <a href="https://github.com/kairwang01/regmark/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/kairwang01/regmark/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/regmark"><img alt="npm" src="https://img.shields.io/npm/v/regmark?color=21355c"></a>
  <a href="#use-it-in-github-actions"><img alt="GitHub Action: kairwang01/regmark@v0" src="https://img.shields.io/badge/action-kairwang01%2Fregmark%40v0-21355c?logo=githubactions&logoColor=white"></a>
  <a href="docs/rules.md"><img alt="17 rules" src="https://img.shields.io/badge/rules-17-21355c"></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-21355c"></a>
  <a href="README.zh-CN.md"><img alt="中文说明" src="https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-c2256e"></a>
</p>

<h1 align="center">Regmark</h1>

<p align="center"><b>Does your shop agree with itself?</b><br>
Catch price, stock and shipping mismatches between product pages, structured data, merchant feeds, AI-agent endpoints and the checkout, locally or in CI.</p>

<p align="center">
  <a href="#try-it-in-ten-seconds">Demo</a> ·
  <a href="docs/quickstart.md">Quickstart</a> ·
  <a href="#use-it-in-github-actions">GitHub Action</a> ·
  <a href="docs/rules.md">Rules</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

Your feed says **$22**. Your cart charges **$24**. The JSON-LD still carries last month's sale price, and the shopping assistant that quoted your shop believed it. Every one of those files is valid. The shop just disagrees with itself, and nothing tells you until Google disapproves the product or a customer gets a different total.

Regmark reads every place a shop states a product fact: the page a person sees, its JSON-LD, microdata and Open Graph tags, your Google and ACP feeds, your UCP catalogue and storefront MCP server, the storefront API, and a real cart. It lines them up variant by variant and reports each disagreement with both values and exactly where each one lives. In CI it can fail the build before the mismatch ships.

- **Read-only by default.** No account, no API key, no hosted service, no telemetry. It obeys `robots.txt` and paces itself.
- **Evidence, not scores.** Every finding names the variant, both values, their raw text and a locator: a JSON-LD path, a feed item, an API field.
- **Made for CI.** Exit codes, per-rule budgets, a pull request comment, SARIF for code scanning, JUnit, JSON, Markdown and a one-file HTML report.
- **Checks what agents read.** UCP catalogues, storefront MCP servers, ACP product feeds, and pages that tell a shopping agent something different from what they tell a browser.

## Try it in ten seconds

```bash
npx regmark demo
```

That audits a small shop bundled with the tool, with 27 defects planted in it: a feed with last week's price, JSON-LD that lists one size out of three, a "free shipping" claim the cart does not honour, a UCP catalogue that lags the cart, a page that quotes agents a lower price than browsers. Nothing leaves your machine.

<p align="center"><img src="docs/assets/terminal.png" alt="Terminal output of regmark demo: price.mismatch findings, each showing the surface's value, the checkout's value and where the wrong value lives" width="880"></p>

It also writes `regmark-demo.html`, one self-contained file you can open or send to someone. When the surfaces disagree the headline prints out of register, the way a misaligned press sheet does; run `npx regmark demo --clean` for the same shop with nothing wrong in it.

<p align="center">
  <img src="docs/assets/report-out-of-register.png" alt="HTML report headed Out of register, the words doubled in cyan, magenta and yellow" width="49%">
  <img src="docs/assets/report-in-register.png" alt="HTML report headed In register, printed clean" width="49%">
</p>

Node.js 22 or later is the only requirement. No npm? The whole tool is one file:

```bash
curl -fsSLO https://github.com/kairwang01/regmark/releases/latest/download/regmark.mjs
node regmark.mjs demo
```

## Audit your own shop

```bash
npx regmark audit https://your-shop.example --html report.html
```

With no flags it works out whether the shop runs WooCommerce or Shopify, samples 25 products, reads their pages and the storefront API, and compares. Give it more to compare and it finds more:

```bash
# the merchant feed, the surface that goes stale most often, and how old it may be
npx regmark audit https://your-shop.example --feed /feeds/google.xml --max-age feed=24h

# what AI shopping agents read: the UCP catalogue, the storefront MCP server, an ACP feed
npx regmark audit https://your-shop.example --ucp --mcp --acp-feed /feeds/acp.jsonl.gz

# real cart totals and the cloaking check, on a shop you have shown is yours
REGMARK_OWNERSHIP_TOKEN=… npx regmark audit https://staging.your-shop.example --checkout --cloaking
```

`npx regmark explain <rule>` says what usually causes a finding and where to fix it. `npm install -D regmark` pins it in a project like any other dev tool. [Every flag and config field](docs/configuration.md) · [Quickstart and troubleshooting](docs/quickstart.md)

## Use it in GitHub Actions

```yaml
# .github/workflows/regmark.yml
name: Regmark
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0
        with:
          store: https://staging.your-shop.example
          feed: /feeds/google.xml
          comment: 'true'
```

The job fails when a rule goes over its budget. The findings appear in the job summary and, with `comment: 'true'`, as one pull request comment that is updated on every push. The HTML, JSON, SARIF and Markdown reports are kept as an artifact, and the counts are step outputs. An error rule fails on its first finding; warnings never fail a build unless you give them a budget. For a shop that already has findings, set each rule's budget to today's count and lower it from there.

[Every input and output](docs/ci.md#inputs), SARIF upload to code scanning, GitLab and any other CI: [docs/ci.md](docs/ci.md).

| Exit | Meaning |
|---|---|
| `0` | Products were read and every rule is within its budget |
| `1` | At least one rule is over its budget |
| `2` | The audit could not run, read no product, or (with `--strict`) a surface could not be collected |

A shop that is down fails the build. It does not pass it.

## Why

Google Merchant Center already runs this comparison on you. It checks the price in your feed against your landing page and its structured data, requires them to [match](https://support.google.com/merchants/answer/12159029), and disapproves the products that do not. You find out from Google, after the fact, one product at a time.

Now more readers are arriving. An AI shopping agent quotes whatever your structured data, your UCP catalogue or your MCP server says, and its user pays whatever your checkout says. If those are two numbers, that sale and that shopper's trust are gone, and no dashboard will tell you why.

Regmark runs the comparison first, across every surface at once, on staging or production, and can fail a build when it finds a difference.

## What it reads

Surfaces are grouped the way a press sheet is separated into plates. The black plate is the one the others are aligned to, which is why printers call it K, for key. Here the checkout is the key plate.

| Plate | Surface | Supported |
|---|---|---|
| **C** | The product page: visible price and stock, JSON-LD, microdata, Open Graph, product text | Any shop that renders its facts in HTML |
| **M** | The merchant feed, in Google's format: RSS, Atom or tab-separated | Any feed you can give a URL for |
| **Y** | What agents read directly: the UCP catalogue (`/.well-known/ucp`), the storefront MCP server and the ACP product feed | Read-only; UCP 2026-08-25 |
| **K** | The shop itself: the storefront API, and a real cart | WooCommerce and Shopify; the cart after ownership is verified |

Which surface is believed is explicit: the checkout first, then the storefront API, then the visible page. Structured data, feeds and agent endpoints are never believed. They are what gets checked. [Exact sampling and coverage](docs/configuration.md#which-products-get-audited)

## What it catches

| Rule | | Catches |
|---|---|---|
| `price.mismatch` | error | A surface states a price the checkout does not charge |
| `price.currency-ambiguous` | error | A machine-readable price with no currency, or the wrong one |
| `price.tax-basis` | warn | Two prices exactly one VAT or GST rate apart |
| `price.sale-expired` | warn | A sale end date in the past on a price still being charged |
| `availability.mismatch` | error | In stock on one surface, sold out on the shop, or the reverse |
| `availability.stale` | warn | A feed older than the refresh interval you set for it |
| `variant.missing` | error | Structured data or an agent endpoint that lists some variants and omits others |
| `variant.unpurchasable` | error | Everything says it can be bought; the cart refuses |
| `shipping.mismatch` | error | A stated shipping cost the checkout does not charge |
| `shipping.undisclosed` | warn | Shipping cost that only appears at checkout |
| `identity.unmatched` | warn | A feed entry for something the shop no longer sells |
| `identity.gtin-invalid` | warn | A GTIN with a bad check digit, or shared by two variants |
| `policy.return-missing` | info | No machine-readable return policy |
| `content.hidden-text` | warn | Text kept in the page but deliberately kept from the eye |
| `content.instruction-like` | error | Product text written to a language model, not to a shopper |
| `content.invisible-chars` | warn | Zero-width and Unicode tag characters carrying unseen text |
| `content.cloaking` | error | A page that tells a shopping agent a different price or stock level than a browser |

[docs/rules.md](docs/rules.md) says exactly when each one fires and, with as much care, when it stays silent. Content checks are heuristics, not a complete prompt-injection defence.

## Checks that need proof the shop is yours

Reading public pages needs nobody's permission. Two checks are different. The **checkout probe** puts one unit in a cart, sets a destination, reads the price and shipping and empties the cart: that writes to the shop. The **cloaking check** fetches each page again as a browser and as a shopping agent: that poses as other clients. Both run only after you show the shop is yours.

1. Choose a token of 16 or more letters, digits, `_` or `-`.
2. Serve the line `regmark-verify=<token>` at `/.well-known/regmark.txt`, or publish it as a TXT record at `_regmark.<your-domain>`.
3. Run with `REGMARK_OWNERSHIP_TOKEN=<token>` and `--checkout`, `--cloaking` or both.

There is no flag that skips this. The probe never reaches a payment step, empties the cart after every item, and says so loudly if it could not. On WooCommerce it reads the full total including tax; on Shopify it reads the line price, purchasability and shipping, because tax is only known at checkout.

## How it behaves on a site

- It contacts only the hosts you name. A redirect or a link elsewhere is not followed.
- It obeys `robots.txt` and spaces its requests a second apart.
- It refuses any host that resolves to a private address, so a hostile shop cannot turn an audit run inside your network into requests against it.
- It caps response size, counted after decompression.
- It treats everything it reads as untrusted, in every report format.
- It sends nothing anywhere. There is no telemetry.

## How it compares

| | Checks | Does not check |
|---|---|---|
| Google Merchant Center diagnostics | Your feed against your page, for products in your feed | Before you publish; other surfaces; your CI |
| Rich Results Test, schema validators | That one page's markup is well formed | Whether its values are true |
| UCP, ACP and feed validators | That an endpoint or a file has the right shape | Whether its values match anything else |
| Page-level "AI readiness" scores | What a machine can read from one page | Whether that agrees with your feed or your checkout |
| **Regmark** | That every surface agrees with the checkout, per variant | Markup validity beyond what it needs to read; rankings or visibility |

These tools answer different questions and work well together. [Positioning and use cases](docs/positioning.md)

## FAQ

**Does it change anything on my shop?** Not unless you ask. A plain `audit` only reads. `--checkout` writes to a cart, and only after ownership is verified; it never places an order.

**Does it run JavaScript?** No. It reads the HTML the server returns, as most crawlers and agents do. A price that only appears after scripts run is invisible to it, and often to them.

**Which platforms?** WooCommerce and Shopify are read through their storefront APIs and can be probed at the cart. Any other shop can be audited from its pages, sitemap and feeds, with the visible page as the reference. [More platforms](https://github.com/kairwang01/regmark/issues/7) are welcome contributions.

**Does `--ucp` work on Shopify?** Yes. Shopify serves the UCP catalogue from the shop's `myshopify.com` host, so when you audit the shop's own domain, add that host by setting `ucp.url` to `https://<shop>.myshopify.com/.well-known/ucp` in the config file; the issue Regmark reports says exactly that. `--mcp` on Shopify reports that `/api/mcp` has no catalogue tools: Shopify moved them under UCP. [The agent endpoints](docs/configuration.md#the-agent-endpoints)

**What does a passing report mean?** That the products in the sample agree within your budgets. Read the collection issues and skipped rules alongside it: a surface that could not be read cannot be shown to be right. `--strict` turns any collection issue into a failure.

**Does it send my data anywhere?** No. Reports are files on your disk. There is no telemetry and no hosted service.

## Status

Version 0.2.0. It works, it is young, and its rules have met few real shops.

- More than 1,100 unit tests, a type check, and CI on Node 22 and 24 that also runs the Action itself.
- A benchmark that runs the tool against the two shops in this repository. One has 27 seeded defects that should give 31 findings; the tool reports those 31 and nothing else. The other has none; the tool reports nothing.
- A first read-only run against 11 public WooCommerce shops found three classes of false alarm in the tool itself. All three are fixed. [What that run showed](plan/06-prototype.md).

If Regmark reports something on your shop that is not wrong, that is the most useful thing you can tell this project: [report a false alarm](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml).

**Next:** [more platforms](https://github.com/kairwang01/regmark/issues/7) · [the visible price on more themes](https://github.com/kairwang01/regmark/issues/6) · checkout sessions over UCP · a shopping agent that walks the shop and checks that the total it quotes is the total the cart charges.

## Contributing

[Recognising the visible price on one more theme](https://github.com/kairwang01/regmark/issues/6) is a small, separate first contribution, and [what the tool did on your shop](https://github.com/kairwang01/regmark/issues/1) is worth more than code right now. A new rule starts as a defect planted in the fixture shop; [CONTRIBUTING.md](CONTRIBUTING.md) walks through it.

```bash
git clone https://github.com/kairwang01/regmark && cd regmark
pnpm install
node packages/cli/src/bin.ts demo     # the CLI, straight from the TypeScript sources
pnpm test && pnpm bench && pnpm typecheck
```

If Regmark saved you a disapproval or a confused customer, a ⭐ helps other shops find it.

## Documentation

- [Quickstart and troubleshooting](docs/quickstart.md)
- [Configuration: every command, flag and config field](docs/configuration.md)
- [Running it in CI](docs/ci.md)
- [What each rule means](docs/rules.md)
- [The JSON report](docs/report-format.md)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Changelog](CHANGELOG.md)
- [Design notes and roadmap](https://opensource.kairwang.cloud/regmark/), in Chinese

## Licence and hosting

Apache-2.0. The project site runs on Tencent Cloud.

<a href="https://www.tencentcloud.com/"><img src="docs/assets/tencent-cloud.svg" alt="Tencent Cloud" height="22"></a>

The Tencent Cloud logo is a trademark of Tencent and is not covered by this licence; it appears here only to credit the hosting provider.
