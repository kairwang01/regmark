<p align="center">
  <img src="docs/assets/hero.png" alt="Regmark: does your shop agree with itself? Four surfaces printing four different prices, out of register; then all of them matching the checkout, in register." width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/licence-Apache--2.0-21355c"></a>
  <img alt="Node 22 or later" src="https://img.shields.io/badge/node-%E2%89%A5%2022-21355c">
  <img alt="15 rules" src="https://img.shields.io/badge/rules-15-21355c">
  <a href="README.zh-CN.md"><img alt="中文说明" src="https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-c2256e"></a>
</p>

# Regmark

**Check that what your shop tells machines matches what its checkout charges.**

A shop states the same fact in several places: the product page, the JSON-LD
inside it, the Open Graph tags, the merchant feed, the storefront API. A person
sees one of them. Google, price comparison sites and AI shopping agents read
the others, and nothing keeps them in step. Regmark reads every one of them for
the same products, lines them up variant by variant, and reports each place
where one disagrees with the surface that decides what the buyer pays.

No account, no API key, no server. It reads your shop and prints what it found.

## See it in ten seconds

```bash
npx github:kairwang01/regmark demo
```

That audits a small shop bundled with the tool, in which 19 defects have been
planted: a feed with last week's price, JSON-LD that lists one size out of
three, a "free shipping" claim the cart does not honour.

<p align="center"><img src="docs/assets/terminal.png" alt="Terminal output of regmark demo: price.mismatch with three findings, each showing the surface's value, the checkout's value and where the wrong value lives" width="880"></p>

It also writes `regmark-demo.html`, one self-contained file you can open or
send to someone. The headline is the verdict: when the surfaces disagree it
prints out of register, the way a misaligned press sheet does.

<p align="center">
  <img src="docs/assets/report-out-of-register.png" alt="HTML report headed Out of register, the words doubled in cyan, magenta and yellow" width="49%">
  <img src="docs/assets/report-in-register.png" alt="HTML report headed In register, printed clean" width="49%">
</p>

## Audit your own shop

```bash
npx github:kairwang01/regmark audit https://your-shop.example
```

With no flags it works out what the shop runs on, samples 25 products, reads
their pages and the storefront API, and compares. It only reads, it obeys
robots.txt, and it makes one request a second.

Give it more to compare and it finds more:

```bash
# the merchant feed, the surface that goes stale most often
regmark audit https://your-shop.example --feed /feeds/google.xml

# real cart totals, so shipping and tax are checked too (WooCommerce)
REGMARK_OWNERSHIP_TOKEN=… regmark audit https://your-shop.example --feed /feeds/google.xml --checkout

# keep a report
regmark audit https://your-shop.example --html report.html
```

`regmark explain <rule>` tells you what usually causes a finding and where to
fix it. [Every flag and config field](docs/configuration.md).

## Why

Google Merchant Center already runs this comparison on you. It checks the price
in your feed against your landing page and its structured data, requires them
to [match exactly](https://support.google.com/merchants/answer/12159029), and
disapproves the products that do not. It [warns or suspends
accounts](https://support.google.com/merchants/answer/10330822) whose checkout
shows a higher price than the product page. You find out from Google, after the
fact, one product at a time.

Now more readers are arriving. An AI shopping agent quotes whatever your
structured data says, and its user pays whatever your checkout says. If those
are two numbers, that sale and that shopper's trust are gone, and no dashboard
will tell you why.

Regmark runs the comparison first, across every surface at once, and can fail
a build when it finds a difference.

## What it catches

| Rule | | Catches |
|---|---|---|
| `price.mismatch` | error | A surface states a price the checkout does not charge |
| `price.currency-ambiguous` | error | A machine-readable price with no currency, or the wrong one |
| `price.tax-basis` | warn | Two prices exactly one VAT or GST rate apart |
| `price.sale-expired` | warn | A sale end date in the past on a price still being charged |
| `availability.mismatch` | error | In stock on one surface, sold out on the shop, or the reverse |
| `variant.missing` | error | Structured data that lists some variants and omits others |
| `variant.unpurchasable` | error | Everything says it can be bought; the cart refuses |
| `shipping.mismatch` | error | A stated shipping cost the checkout does not charge |
| `shipping.undisclosed` | warn | Shipping cost that only appears at checkout |
| `identity.unmatched` | warn | A feed entry for something the shop no longer sells |
| `identity.gtin-invalid` | warn | A GTIN with a bad check digit, or shared by two variants |
| `policy.return-missing` | info | No machine-readable return policy |
| `content.hidden-text` | warn | Text kept in the page but deliberately kept from the eye |
| `content.instruction-like` | error | Product text written to a language model, not to a shopper |
| `content.invisible-chars` | warn | Zero-width and Unicode tag characters carrying unseen text |

[docs/rules.md](docs/rules.md) says exactly when each one fires and, with as
much care, when it stays silent.

## What it reads

Surfaces are grouped the way a press sheet is separated into plates. The black
plate is the one the others are aligned to, which is why printers call it K,
for key. Here the checkout is the key plate.

| Plate | Surface | Supported |
|---|---|---|
| **C** | The product page: visible price and stock, JSON-LD, microdata, Open Graph | yes |
| **M** | The merchant feed, in Google's format: RSS, Atom or tab-separated | yes |
| **Y** | Agent protocol endpoints: UCP, ACP, MCP | planned |
| **K** | The shop itself: the storefront API, and totals from a real cart | WooCommerce in full; Shopify catalogue, read-only |

Which surface is believed is explicit: the checkout first, then the storefront
API, then the visible page. JSON-LD, feeds and protocol endpoints are never
believed. They are what gets checked.

## In CI

```yaml
# .github/workflows/regmark.yml
on: pull_request
jobs:
  regmark:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0.1.0
        with:
          store: https://staging.your-shop.example
          feed: /feeds/google.xml
```

The job fails when a rule goes over its budget. The findings appear in the job
summary, and the HTML, JSON, SARIF and Markdown reports are kept as an artifact. An error
rule fails on its first finding; warnings never fail a build. For a shop that
already has findings, set each rule's budget to today's count and lower it from
there. [CI guide](docs/ci.md), including GitLab and SARIF upload.

Reports come as a terminal summary and any of `--html`, `--json`, `--sarif`,
`--junit` and `--markdown`. Exit code 0 within budget, 1 over, 2 if the audit
could not run or read no product: a shop that is down fails the build, it does
not pass it.

## The checkout probe

Reading public pages needs nobody's permission. The checkout probe is
different: it puts one unit in a cart, sets a destination, reads the total and
empties the cart. That writes to the shop, so it runs only after you show the
shop is yours.

1. Choose a token of 16 or more letters and digits.
2. Serve the line `regmark-verify=<token>` at `/.well-known/regmark.txt`, or
   publish it as a TXT record at `_regmark.<your-domain>`.
3. Run with `REGMARK_OWNERSHIP_TOKEN=<token>` and `--checkout`.

There is no flag that skips this. The probe never reaches a payment step,
empties the cart after every item, and says so loudly if it could not.

## How it behaves on a site

- It contacts only the hosts you name. A redirect or a link elsewhere is not followed.
- It obeys robots.txt and spaces its requests a second apart.
- It refuses any host that resolves to a private address, so a hostile shop
  cannot turn an audit run inside your network into requests against it.
- It caps response size, counted after decompression.
- It treats everything it reads as untrusted in every report format.
- It sends nothing anywhere. There is no telemetry.

## How it compares

| | Checks | Does not check |
|---|---|---|
| Google Merchant Center diagnostics | Your feed against your page, for products in your feed | Before you publish; other surfaces; your CI |
| Rich Results Test, schema validators | That one page's markup is well formed | Whether its values are true |
| UCP and feed validators | That an endpoint or a file has the right shape | Whether its values match anything else |
| Page-level "AI readiness" scores | What a machine can read from one page | Whether that agrees with your feed or your checkout |
| **Regmark** | That every surface agrees with the checkout, per variant | Markup validity beyond what it needs to read; ranking or visibility |

## Status

Version 0.1.0. It works, it is young, and its rules have met few real shops.

- Close to 700 unit tests and a type check.
- A benchmark that runs the tool against the two shops in this repository. One
  has 19 seeded defects that should give 22 findings; the tool reports those 22
  and nothing else. The other has none; the tool reports nothing.
- A first read-only run against 11 public WooCommerce shops found three classes
  of false alarm in the tool itself. All three are fixed.
  [What that run showed, and what it could not](plan/06-prototype.md).

If Regmark reports something on your shop that is not wrong, that is the most
useful thing you can tell this project:
[report a false alarm](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml).

**Next:** UCP and ACP endpoints as a fourth plate · a Shopify checkout probe ·
Magento and Medusa · feed freshness · a shopping agent that walks the shop and
checks that the total it quotes is the total the cart charges.

## Documentation

- [Configuration and every flag](docs/configuration.md)
- [Running it in CI](docs/ci.md)
- [What each rule means](docs/rules.md)
- [The JSON report](docs/report-format.md)
- [Contributing](CONTRIBUTING.md): a new rule starts as a defect planted in the fixture shop
- [Design notes and roadmap](https://opensource.kairwang.cloud/regmark/), in Chinese

## Hosting

The project site runs on Tencent Cloud.

<a href="https://www.tencentcloud.com/"><img src="docs/assets/tencent-cloud.svg" alt="Tencent Cloud" height="22"></a>

## Licence

Apache-2.0. The Tencent Cloud logo is a trademark of Tencent and is not covered
by this licence; it appears here only to credit the hosting provider.
