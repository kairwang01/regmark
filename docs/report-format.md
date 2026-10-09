# The JSON report

`--json <file>` writes the audit result as JSON. The file is the `AuditResult`
type in `packages/core/src/types.ts`, printed with two-space indentation and a
final newline. Every other report format is drawn from the same data.

## Schema version

`schema` is `regmark.audit/v0`. Version 0 is not stable: field names, value
sets and locator text may change before 1.0, and each change will be listed
under **Breaking** in the [changelog](../CHANGELOG.md). Check `schema` before a
script reads the rest of the file.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | The format and its version. In this release it is always `regmark.audit/v0`. |
| `tool` | object | `name` is `regmark`. `version` is the version of the tool that wrote the file. |
| `store` | string | The shop's origin, as audited, such as `https://shop.example`. |
| `startedAt` | string, ISO 8601 | When the run started. |
| `finishedAt` | string, ISO 8601 | When the run finished. |
| `datum` | array of surface names | The datum order the run used, most trusted first. |
| `surfaces` | array of surface names | Every surface that gave at least one reading in the run. |
| `counts` | object | `products` is the number of products compared. `variants` is the number of variants across them. |
| `rules` | array of `RuleSummary` | One entry per rule, in the order of the rule catalogue. |
| `findings` | array of `Finding` | Every finding. Sorted by severity (error, then warn, then info), then by rule, product, variant and surface. |
| `issues` | array of `CollectIssue` | Problems in reading the shop. They are not findings about its data. |
| `ok` | boolean | `true` when at least one product was read, every rule is within budget, and the requested collection policy passes. |

An empty audit now has `ok: false`. In strict mode, any collection issue also
sets `ok: false`, independently of finding budgets. In the published 0.1.0
report, an empty audit could have `ok: true`; consumers accepting older reports
must also check `counts.products > 0`. The command line exits 2 for an empty
audit or a strict collection failure. Without strict mode, collection issues
remain diagnostic and do not independently change `ok`.

JUnit includes a collection error when collection alone prevents a passing
audit, and a `system-err` with collection diagnostics. SARIF includes invocation
status and tool execution notifications. A rule-budget failure remains a
finding failure; inspect `issues` as well when an audit has both kinds of problem.

## RuleSummary (`rules[]`)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The rule id, such as `price.mismatch`. |
| `severity` | `error`, `warn` or `info` | The rule's severity. |
| `summary` | string | The rule's one-line summary. |
| `help` | string, optional | The usual cause and the fix. |
| `findings` | integer | How many findings the rule produced. |
| `budget` | integer or null | The largest count that still passes. `null` means there is no limit. |
| `passed` | boolean | `true` when `findings` is within `budget`, or when there is no limit. A skipped rule is `true`. |
| `skipped` | string, optional | Present when the rule did not run. The reason names the surfaces it needed, such as `needs checkout`. |

## Finding (`findings[]`)

| Field | Type | Meaning |
|---|---|---|
| `rule` | string | The rule id. |
| `severity` | `error`, `warn` or `info` | The rule's severity. |
| `message` | string | A short description. For a finding with no evidence, this is the whole description. |
| `product` | string | The product key: the product's URL with the scheme and `www.` removed, and with no trailing slash, query or fragment. For example, `shop.example/product/trail-socks`. When the product has no URL, the key is that of its first variant. |
| `variant` | string, optional | The variant key, when the finding is about one variant. It is the SKU when there is one. Otherwise it is the GTIN, then `#` and the shop's variant id, then the option values such as `color=blue\|size=m`. |
| `surface` | string, optional | The surface at fault. |
| `expected` | Evidence, optional | What the datum says. |
| `actual` | Evidence, optional | What the surface at fault says. |

## Evidence (`expected`, `actual`)

| Field | Type | Meaning |
|---|---|---|
| `surface` | string | The surface that made the statement. |
| `value` | string | The value, normalised for people. For example `39.00 USD` or `in_stock`. |
| `raw` | string | The text as the surface stated it. For JSON-LD, the schema.org URL. For the storefront API, the JSON value. |
| `locator` | string | Where the statement is. A URL, then a pointer into it. See [Locators](#locators). |

Everything in `message`, `value`, `raw` and `locator` came from the shop. Treat
it as untrusted text: escape it before it goes into HTML, a shell command or a
prompt.

## CollectIssue (`issues[]`)

| Field | Type | Meaning |
|---|---|---|
| `surface` | string | The surface being read when the problem happened. |
| `code` | string | A short, stable code. See [Collection issue codes](#collection-issue-codes). |
| `message` | string | What happened. |
| `locator` | string, optional | The URL or the pointer involved. |

## Locators

A locator is a URL followed by `#` and a pointer. The URL is the document the
statement was read from. The pointer says where in that document the statement
is. The SARIF report puts the URL part in the location and keeps the full
locator in `properties`.

| Surface | Shape | Example |
|---|---|---|
| `page`, visible price and stock | `<page URL>#css(<selector>)`. The selector is one of the built-in readers, or the one set in `page.priceSelector` or `page.availabilitySelector`. | `https://shop.example/product/enamel-mug/#css(.summary p.price)` |
| `page`, product text | `<page URL>#css(<selector>)`, then `hidden[n]`, `comment[n]` or `img[n]@alt` | `https://shop.example/product/wool-beanie/#css(.woocommerce-product-details__short-description) hidden[0]` |
| `jsonld` | `<page URL>#jsonld[<script index>]`, then a path into the object | `https://shop.example/product/trail-socks/#jsonld[0]/hasVariant/2/offers/availability` |
| `microdata` | `<page URL>#microdata[<item index>]`, then `/offers[<n>]` and the field name | `https://shop.example/product/enamel-mug/#microdata[0]/offers[1]/price` |
| `opengraph` | `<page URL>#meta[<attribute>="<key>"]` | `https://shop.example/product/enamel-mug/#meta[property="product:price:amount"]` |
| `feed` | `<feed URL>#item[id="<item id>"]/<field>` | `https://shop.example/feeds/google.xml#item[id="TOTE-NAT"]/price` |
| `platform` | `<storefront API URL>#<JSON pointer>` | `https://shop.example/wp-json/wc/store/v1/products/403#/is_in_stock` |
| `checkout` | `<cart API URL>#<JSON pointer>`. A refused add-to-cart has no pointer. | `https://shop.example/wp-json/wc/store/v1/cart/update-customer#/totals/total_shipping` |

## Collection issue codes

| Code | Surface | Meaning |
|---|---|---|
| `collect-failed` | platform | The storefront listing failed as a whole. The message says why. |
| `parse-error` | platform | A storefront response was not JSON, or did not have the expected shape. |
| `parse-error` | feed | The feed is empty, or it is not readable XML. |
| `parse-error` | page | A JSON-LD block is not valid JSON. |
| `extract-failed` | page | Reading the JSON-LD, the microdata or the page failed. |
| `fetch-failed` | platform, feed, page | A request failed: an HTTP error status, a refusal other than robots, a network error, or a sitemap that could not be read. The message starts with the [refusal code](configuration.md#refusals), such as `foreign-host`. |
| `robots-disallowed` | platform, feed, page | robots.txt does not allow the URL. |
| `not-found` | page | The page returned 404 or 410. |
| `feed-item-incomplete` | feed | A feed item has no `id`, or no `link`, so it cannot be matched to a product. |
| `feed-field-unreadable` | feed | A field, such as a price, could not be read as the value it should be. |
| `probe-failed` | checkout | A step of the checkout probe failed. The message names the variant and the step. |
| `no-shipping-rate` | checkout | The shop offered no shipping rate for the destination. |
| `cart-not-emptied` | checkout | The probe could not empty the cart, or could not confirm that it is empty. The message says to check the shop admin. |
| `ownership-not-verified` | checkout | The probe was skipped, because ownership of the shop was not shown. |
| `ownership-not-verified` | page | The cloaking check was skipped, because ownership of the shop was not shown. |
| `view-failed` | page | The cloaking check could not read a page as one client profile: an HTTP error status, a refusal or a network error. The message starts with `as <profile>:`. |
| `view-redirected` | page | A page read as one client profile was answered from another origin, where Regmark does not pose as the profile, so it is not compared. |
| `probe-unsupported` | checkout | The probe was skipped, because the platform is not WooCommerce. |

A collection issue does not change the exit code by itself. It does when it
leaves nothing to check: an audit that read no product exits 2.

## Excerpt

From a run against the bundled shop with defects, with
`--feed /feeds/google.xml` and no checkout probe. The local address of the
fixture is replaced with `shop.example`, and the lists are cut to two rules,
two findings and one issue.

```json
{
  "schema": "regmark.audit/v0",
  "tool": {
    "name": "regmark",
    "version": "0.1.0"
  },
  "store": "https://shop.example",
  "startedAt": "2026-10-09T07:00:13.748Z",
  "finishedAt": "2026-10-09T07:00:14.283Z",
  "datum": [
    "checkout",
    "platform",
    "page"
  ],
  "surfaces": [
    "platform",
    "feed",
    "page",
    "jsonld",
    "opengraph"
  ],
  "counts": {
    "products": 11,
    "variants": 20
  },
  "rules": [
    {
      "id": "availability.mismatch",
      "severity": "error",
      "summary": "A surface says an item can be bought when it cannot, or the reverse.",
      "help": "Stock changed after the surface was written. A feed lags by its export interval, and structured data for a product with variants often copies the parent's status to every variant. Shorten the feed schedule and emit availability per variant.",
      "budget": 0,
      "findings": 2,
      "passed": false
    },
    {
      "id": "policy.return-missing",
      "severity": "info",
      "summary": "No surface gives a return policy for the product in a form a machine can read.",
      "help": "Add hasMerchantReturnPolicy to the Offer or to the organisation's structured data. Search engines read it, and an agent cannot tell a shopper what a PDF or an image says.",
      "budget": null,
      "findings": 1,
      "passed": true
    }
  ],
  "findings": [
    {
      "rule": "availability.mismatch",
      "severity": "error",
      "message": "jsonld says in_stock, platform says out_of_stock",
      "product": "shop.example/product/trail-socks",
      "variant": "SOCK-L",
      "surface": "jsonld",
      "expected": {
        "surface": "platform",
        "value": "out_of_stock",
        "raw": "false",
        "locator": "https://shop.example/wp-json/wc/store/v1/products/403#/is_in_stock"
      },
      "actual": {
        "surface": "jsonld",
        "value": "in_stock",
        "raw": "https://schema.org/InStock",
        "locator": "https://shop.example/product/trail-socks/#jsonld[0]/hasVariant/2/offers/availability"
      }
    },
    {
      "rule": "policy.return-missing",
      "severity": "info",
      "message": "no surface gives a return policy a machine can read",
      "product": "shop.example/product/linen-apron"
    }
  ],
  "issues": [
    {
      "surface": "page",
      "code": "not-found",
      "message": "HTTP 404",
      "locator": "https://shop.example/product/discontinued-scarf/"
    }
  ],
  "ok": false
}
```

## Reading it from a script

The per-rule counts, which are what a budget is set from:

```bash
jq -r '.rules[] | select(.findings > 0) | "\(.id)=\(.findings)"' regmark.json
```

Every wrong price, with where the wrong value lives:

```bash
jq -r '.findings[] | select(.rule == "price.mismatch")
       | [.variant, .actual.value, .expected.value, .actual.locator] | @tsv' regmark.json
```
