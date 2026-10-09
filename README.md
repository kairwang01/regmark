# Regmark

Check that what a shop tells machines matches what its checkout charges.

A shop states the same fact in several places: the product page, the JSON-LD
inside it, the Open Graph tags, the merchant feed, the storefront API. A person
only ever sees one of them. A shopping agent, a search engine or a price
comparison site reads the others, and nothing keeps them in step. Regmark reads
each of them for the same products, lines them up, and reports every place
where they disagree with the one that decides what the buyer pays.

```
$ regmark audit https://shop.example --feed /feeds/google.xml --platform woocommerce --checkout

  shop.example    20 variants    41s
  C page jsonld opengraph    M feed    Y –    K platform checkout

  ✗ price.mismatch              3 findings
      TOTE-NAT     M feed 22.00 USD  ≠  K checkout 24.00 USD
                   https://shop.example/feeds/google.xml#item[id="TOTE-NAT"]/price
      TEE-BLU-M    C jsonld 45.00 USD  ≠  K checkout 39.00 USD
                   https://shop.example/product/classic-tee/#jsonld[0]/hasVariant/1/offers/price
      enamel-mug   C opengraph 14.00 USD  ≠  K checkout 16.00 USD
                   https://shop.example/product/enamel-mug/#meta[property="product:price:amount"]
  ✗ shipping.mismatch           1 finding
      TEE-BLU-S    M feed free  ≠  K checkout 6.20 USD
                   https://shop.example/feeds/google.xml#item[id="TEE-BLU-S"]/shipping
  …
  12 errors, 9 warnings, 1 note. 7 rules over budget.
```

This is not a new problem waiting for AI agents. Google Merchant Center
already compares a feed's price with the landing page and its structured data,
requires them to match exactly, and disapproves products that do not; it warns
or suspends accounts whose checkout shows a higher price than the product
page. Merchants learn about it from Google, after the fact. Regmark runs the
same kind of comparison first, across every surface, in CI.

The name is a printer's word. A registration mark is the small cross printed
in the margin of a sheet to show whether the colour plates line up. The black
plate is the one the others are aligned to, which is why it is called K, for
key. Here the checkout is the key plate.

## Status

A working prototype, version 0.0.1. Not yet published to npm.

- 606 unit tests, a type check, and an end-to-end benchmark, all passing.
- The benchmark runs the tool against two small shops that ship with this
  repository. One has 19 seeded defects that should produce 22 findings; the
  tool reports 22 of 22 and nothing else. The other has none; the tool reports
  nothing.
- It has been run read-only against a small sample of public WooCommerce
  shops. See [what the first real run showed](#what-the-first-real-run-showed).

## What it reads

Surfaces are grouped the way a press sheet is separated into plates.

| Plate | Surface | In this release |
|---|---|---|
| C | Product page: visible price and stock, JSON-LD, microdata, Open Graph | yes |
| M | Merchant feed in Google's format: RSS, Atom or tab-separated | yes |
| Y | Agent protocol endpoints: UCP, ACP, MCP | not yet |
| K | The shop itself: storefront API, and totals from a real cart | WooCommerce; Shopify catalogue, read-only |

Which surface is believed is explicit: checkout first, then the storefront
API, then the visible page. JSON-LD, feeds and protocol endpoints are never
believed. They are what gets checked.

## What it reports

Fifteen rules. [docs/rules.md](docs/rules.md) defines exactly when each fires.

| Rule | Level | Catches |
|---|---|---|
| `price.mismatch` | error | A surface states a price the datum does not back up |
| `price.currency-ambiguous` | error | A machine-readable price with no currency, or the wrong one |
| `price.tax-basis` | warn | Two prices exactly one tax rate apart |
| `price.sale-expired` | warn | A sale end date in the past on a price still charged |
| `availability.mismatch` | error | In stock on one surface, sold out on the datum, or the reverse |
| `variant.missing` | error | A surface lists some variants of a product and omits others |
| `variant.unpurchasable` | error | Everything says buyable; the cart refuses |
| `shipping.mismatch` | error | A stated shipping cost the checkout does not charge |
| `shipping.undisclosed` | warn | Shipping cost only discoverable at checkout |
| `identity.unmatched` | warn | A listed product or variant the shop does not sell |
| `identity.gtin-invalid` | warn | A GTIN with a bad check digit, or shared by two variants |
| `policy.return-missing` | info | No machine-readable return policy |
| `content.hidden-text` | warn | Text kept in the page but deliberately kept from the eye |
| `content.instruction-like` | error | Product text addressed to a language model |
| `content.invisible-chars` | warn | Zero-width and Unicode tag characters carrying unseen text |

Each rule has a budget. An error rule fails the run on its first finding;
warnings and notes never do. Set a rule's budget to its current count and
lower it from there: `--budget price.mismatch=3`.

## Running it

Requires Node 22.18 or later. From a clone:

```bash
pnpm install
node packages/cli/src/bin.ts audit https://your-shop.example \
  --feed /feeds/google.xml \
  --platform woocommerce \
  --html report.html --sarif regmark.sarif
```

There is no build step: Node runs the TypeScript sources directly.

Reports: a summary on the terminal, and any of `--json`, `--sarif`, `--junit`,
`--html`. The HTML report is one self-contained file with no scripts and no
external requests. The exit code is 0 within budget, 1 over budget, 2 if the
audit could not run.

### The checkout probe

Reading public pages needs no permission. The checkout probe is different: it
puts one unit in a cart, sets a destination, reads the total, and empties the
cart. That writes to the shop, so it only runs after you show the shop is
yours.

1. Choose a token of 16 or more letters, digits, `_` or `-`.
2. Serve the line `regmark-verify=<token>` at `/.well-known/regmark.txt`, or
   publish it as a TXT record at `_regmark.<your-domain>`.
3. Run with `REGMARK_OWNERSHIP_TOKEN=<token>` and `--checkout`.

There is no flag that skips this. The probe never reaches a payment step,
empties the cart after every item, and reports loudly if it could not.

## How it behaves on someone's site

- Only the hosts you name are contacted. A redirect or a link elsewhere is
  not followed.
- robots.txt is obeyed.
- Requests to one host are spaced a second apart by default.
- A host that resolves to a private address is refused, so pointing the tool
  at a hostile shop from inside a network cannot be turned into requests
  against that network.
- Responses are capped in size, counted after decompression.
- Everything read from the shop is treated as untrusted in every report format.

## What the first real run showed

On 9 October 2026 the tool was run read-only against public WooCommerce shops:
their storefront API and five product pages each. No feed, no cart.

Sixteen shops were tried. Five could not be read: two answered with rate
limiting or a block, one with a server error, one redirected to another host,
and one disallows the API in robots.txt. The tool stopped at each.

For the other 11 shops, 55 products and 125 variants:

| Finding | Count | Shops |
|---|---|---|
| Stock status contradicted between a page tag and the storefront API | 2 | 2 |
| JSON-LD price with no usable currency (malformed `priceSpecification`) | 2 | 1 |
| Page and JSON-LD price exactly one GST rate below the API price | 10 | 1 |
| No machine-readable return policy | 55 of 55 products | 11 of 11 |

This is a small convenience sample and says nothing about how common these
problems are in general. It could only look at the page side: feeds are not
public and the checkout probe needs the owner. Those are the two plates where
disagreement is most expected and they cannot be measured from outside. What
the run did do is find three classes of false alarm in the tool itself, all
since fixed and covered by tests: a tax difference read as a price difference,
a backend id written as a SKU, and carousel slides read as hidden text.

Shopify shops could not be sampled from the machine this was run on: Shopify's
edge answers a data-centre address with HTTP 429, and the tool does not work
around a refusal.

## Layout

```
packages/
  core/            types, money, identifiers, the offer graph, the rule runner,
                   the guarded fetcher, ownership verification
  collect-page/    visible price and stock, JSON-LD, microdata, Open Graph, text
  collect-feed/    Google Merchant feeds
  collect-woo/     WooCommerce Store API and the checkout probe
  collect-shopify/ Shopify public catalogue, read-only
  rules/           the fifteen rules
  report/          terminal, JSON, SARIF, JUnit, HTML
  cli/             the command line and the audit itself
fixtures/shop/     the two test shops: one misprinted, one clean
e2e/               the benchmark
docs/rules.md      what each rule means
```

Dependencies only point one way: `core` knows no collector, collectors know
no rule, rules know no reporter.

## Developing

```bash
pnpm test        # unit tests
pnpm bench       # the benchmark against the two fixture shops
pnpm typecheck
node fixtures/shop/src/serve.ts --mode misprint --port 4010   # a broken shop to poke at
```

A new rule starts as a new defect in `fixtures/shop/src/shop.ts`, with the
finding it should produce. The benchmark then fails until the rule finds it,
and fails again if the rule also fires on the clean shop.

## 中文简介

Regmark 检查一家店对机器说的话，和它结账时实际收的钱，是不是一回事。它把商品页、JSON-LD、Open Graph、商品 feed、店铺后台接口上的价格、库存、运费读出来，按商品对齐，逐项和结账实算的结果比对，对不上就报出来，并且可以让 CI 失败。

项目背景、设计取舍和路线图见 <https://opensource.kairwang.cloud/regmark/>。

## Hosting

The project site, <https://opensource.kairwang.cloud/regmark/>, runs on Tencent Cloud.

<a href="https://www.tencentcloud.com/"><img src="docs/assets/tencent-cloud.svg" alt="Tencent Cloud" height="22"></a>

## Licence

Apache-2.0. The Tencent Cloud logo is a trademark of Tencent and is not
covered by this licence; it appears here only to credit the hosting provider.
