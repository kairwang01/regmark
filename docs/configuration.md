# Configuration

Every command, flag, config field and environment variable that Regmark reads,
with the defaults the code sets. Start with the [quickstart](quickstart.md) for
a first audit. This reference describes the current source; `--strict` and the
expanded nested-field validation are new since the `v0.1.0` release. Use the
reference from your release tag when running a pinned bundle.

[Commands](#command-line) · [Config fields](#fields) · [Sampling](#which-products-get-audited) · [Baseline](#which-surface-is-believed) · [Budgets](#budgets) · [Request policy](#how-requests-are-made) · [Ownership](#writes)

Unknown flags, unknown top-level or nested config fields, invalid field types,
invalid HTTP(S) URLs and unknown platform, surface or budget rule names stop
the run with exit code 2 before collection. URLs may not contain credentials.
Numeric settings must be safe integers; request intervals are 0–2,147,483,647 ms
and timeouts are 1–2,147,483,647 ms. CSS selectors must be non-empty strings;
selector parsing happens when pages are read.

The words used here (surface, plate, datum, sighting, budget) are defined in
[docs/rules.md](rules.md#words-used-below).

## Command line

### regmark audit

```
regmark audit [store-url] [flags]
```

The store URL can come from the config file, as `store`. A URL on the command
line replaces it.

#### Surfaces

| Flag | Value | Default | What it does |
|---|---|---|---|
| `--feed` | URL, absolute or relative to the store | none | Reads a product feed in Google Merchant format: RSS, Atom or tab-separated text. The file is read once, whole. |
| `--platform` | `woocommerce`, `shopify`, `auto` or `none` | `auto` | The storefront API to read. `auto` tries WooCommerce, then Shopify. `none` reads no storefront API. The pages, and the feed if one is given, are still read. |
| `--checkout` | switch | off | Runs the checkout probe. Needs `--platform woocommerce` or `auto`, and a verified ownership token. Any other platform value stops the run with exit 2. With `auto`, a shop that is not WooCommerce gets a `probe-unsupported` issue and no probe. |
| `--ship-to` | `CC` or `CC:postcode` | the config file's `checkout.shipTo`, else `US` | The destination for the probe. The country must be two letters; this is checked even when no probe runs. The text after the colon is sent as the postcode. It takes effect when the probe runs: with `--checkout`, or with `checkout` in the config file. |
| `--page` | product page URL | none | Reads this page instead of the sampled page list. Repeat the flag for more pages. See [Which products get audited](#which-products-get-audited). |

#### Scope

| Flag | Value | Default | What it does |
|---|---|---|---|
| `--sample` | whole number, 1 or more | `25` | How many products to audit. |
| `--seed` | whole number, 0 or more | `1` | Changes which products the sample picks. The same seed on the same catalogue picks the same products. |
| `--datum` | surface names, comma-separated | `checkout,platform,page` | The surfaces to believe, most trusted first. See [Which surface is believed](#which-surface-is-believed). |
| `--budget` | `rule=n`, repeatable | see [Budgets](#budgets) | The most findings allowed for one rule. The rule must exist (`regmark rules` lists them) and the value is a whole number. Replaces the same rule in the config file. |
| `--strict` | switch | off | Treat any collection issue as an incomplete audit: set report `ok` to `false` and exit `2`. Reports are still written when collection completes. New since `v0.1.0`; use a current source build until released. |

#### Output

| Flag | Value | Default | What it does |
|---|---|---|---|
| `--html <file>` | path | none | Writes the HTML report. |
| `--json <file>` | path | none | Writes the JSON report. See [docs/report-format.md](report-format.md). |
| `--sarif <file>` | path | none | Writes a SARIF 2.1.0 log. |
| `--junit <file>` | path | none | Writes JUnit XML, with one test case per rule. |
| `--markdown <file>` | path | none | Writes a Markdown summary, for a comment or a job summary. |
| `--quiet` | switch | off | Prints no summary on stdout. Progress lines on stderr are also off, unless `--verbose` is given. Report files are still written. |
| `--no-color` | switch | off | Turns colour off in the terminal summary. |
| `--verbose` | switch | off | Prints every progress line on stderr, including debug lines. |

Progress lines go to stderr when stderr is a terminal and `--quiet` is not
given. Without a terminal, nothing is printed unless `--verbose` is given.

#### Other

| Flag | Value | Default | What it does |
|---|---|---|---|
| `--config <file>` | path | `regmark.config.json`, if it exists in the working directory | The config file. See [The config file](#the-config-file). |
| `--interval <ms>` | whole number | `1000` | The minimum gap between two requests to the same host. `0` removes the gap. |
| `--allow-private-network` | switch | off | Lets the run contact hosts that resolve to private or loopback addresses. Use it for a shop on your own machine or network. See [Private addresses](#private-addresses). |
| `--help`, `-h` | switch | | Prints the usage and exits 0. |
| `--version` | switch | | Prints the version and exits 0. |

### regmark demo

Audits a fixture shop that ships with the tool. The shop runs on a local port
for the length of the run. The settings are fixed in code: the WooCommerce
platform, a feed, the checkout probe and a sample of 50. The config file is
not read.

| Flag | Default | What it does |
|---|---|---|
| `--html <file>` | `regmark-demo.html` | Where the HTML report is written. |
| `--clean` | off | Audits the same shop with no defects, to show what a passing report looks like. |
| `--no-color` | off | Turns colour off in the terminal summary. |

### regmark explain <rule>

Prints the rule's summary, its usual cause and fix, and a link to its entry in
[docs/rules.md](rules.md). With no rule, or an unknown one, it lists every rule
id on stderr and exits 2. It takes no flags.

### regmark rules

Lists every rule with its id, severity and summary. It takes no flags.

### regmark init <store-url>

Writes `regmark.config.json` in the working directory. The file holds the
origin of the URL, `"platform": "auto"`, `"sample": 25` and an empty `budget`.
If the file already exists, `init` does not overwrite it and exits 2. It takes
no flags.

```json
{
  "store": "https://shop.example",
  "platform": "auto",
  "sample": 25,
  "budget": {}
}
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Products were read, every rule is within its budget, and strict mode (when enabled) found no collection issue. Also returned by `demo`, `rules`, a successful `explain`, `init`, `--help` and `--version`. |
| `1` | The audit ran and at least one rule is over its budget. The report files are written before the code is set. |
| `2` | The audit could not run, it ran and read no product, or `--strict` found a collection issue. The first covers a bad flag or value, a config error, a store that is not an http or https URL, an unknown command or rule, an `init` that would overwrite a file, and any other error. Also returned when no command is given. |

In default mode, a collection problem does not change the exit code by itself.
A probe that was skipped, or one page that could not be read, is recorded as an issue, and the
run still exits 0 if every rule passes. Check the `issues` list in the JSON
report, or the collection issue line in the summary. See
[Collection issue codes](report-format.md#collection-issue-codes).

With `--strict` or `"strict": true`, any collection issue causes exit `2` and
`ok: false` in the report, even if the rule budgets pass. This includes a failed
feed read, a refused page, an unsupported probe, unverified ownership and cart
cleanup failures. Strict mode does not prove full catalogue coverage: sampling
and unsupported collectors still apply, and a skipped rule alone is not a
collection issue.

In either mode, an audit that read no product at all also exits `2`: the shop
was not recognised and had no sitemap, or robots.txt refused every path. Every rule is
then within budget because there was nothing to check. Regmark exits 2, and no
report calls that run a pass.

### Environment variables

| Variable | Read by | Meaning |
|---|---|---|
| `REGMARK_OWNERSHIP_TOKEN` | `audit` | The ownership token for the checkout probe. A non-empty value replaces `ownershipToken` from the config file. An empty one is ignored, which is what a CI job passes when the secret is not set. |
| `NO_COLOR` | `audit`, `demo` | Turns colour off when set to any non-empty value. |
| `FORCE_COLOR` | `audit`, `demo` | Turns colour on when stdout is not a terminal, as in a CI log. `NO_COLOR` and `--no-color` win over it. |

## The config file

### Where it is read

1. The file named by `--config`, if the flag is given. A relative path is
   relative to the working directory.
2. Otherwise `regmark.config.json` in the working directory, if it exists.
3. Otherwise no file is read. Parent directories are not searched.

### Formats

- A file whose name ends in `.json` is read as JSON.
- Any other file is imported as an ES module, and its default export must be
  an object. Name the file `.mjs` so that Node reads it as a module.

Here is a module example:

```js
// regmark.config.mjs
export default {
  store: 'https://shop.example',
  platform: 'woocommerce',
  feed: '/feeds/google.xml',
  sample: 40,
  budget: { 'price.mismatch': 0 },
  fetch: { minIntervalMs: 2000 },
};
```

### Precedence

A flag replaces the file's value, one field at a time:

- `store`: a URL on the command line replaces the file's `store`.
- `platform`, `feed`, `sample`, `seed` and `datum`: a flag replaces the file's
  value. `--page` replaces the file's `pages`.
- `strict`: `--strict` sets it to true. No CLI flag sets a configured true value back to false.
- `budget`: the file's entries are kept. Each rule given with `--budget`
  replaces its own entry.
- `fetch`: the file's entries are kept. `--interval` replaces
  `fetch.minIntervalMs`. `--allow-private-network` sets
  `fetch.allowPrivateNetwork` to true. No flag sets it back to false.
- `checkout`: the probe runs when `--checkout` is given or the file has a
  `checkout` key. Its destination is `--ship-to` when that is given, otherwise
  the file's `checkout.shipTo`, otherwise `US`. No flag turns off a probe the
  file asks for.
- `ownershipToken`: a non-empty `REGMARK_OWNERSHIP_TOKEN` replaces the file's
  value.

Values in the file are checked as strictly as flags. A field that is not in the
table below, a `platform` that does not exist, a surface in `datum` that does
not exist, a `budget` for a rule that does not exist: each stops the run with
exit code 2 and a message naming the mistake.

### Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `store` | string, URL | none. Required from the file or the command line. | The shop's origin, such as `https://shop.example`. Only the origin is used; a path is dropped. Must be http or https. |
| `feed` | string | none | A feed URL, absolute or relative to `store`. Same as `--feed`. The feed's host is added to the host allowlist. |
| `platform` | `"woocommerce"`, `"shopify"`, `"auto"` or `"none"` | `auto` when neither the flag nor the file sets it | The storefront API to read. `"none"` reads no API. Same as `--platform`. |
| `checkout` | object: `{ "shipTo": ShipTo }` | off | Turns on the checkout probe. The key's presence in the file is enough. |
| `checkout.shipTo` | `ShipTo` | `{ "country": "US" }` from `--checkout`. Required in the file. | The destination for the probe. Sent to the shop as the shipping and billing address. |
| `checkout.shipTo.country` | string, two letters | `US` from the flag | The ISO 3166-1 alpha-2 country code. |
| `checkout.shipTo.postcode` | string | none | The postcode. Set by `--ship-to CC:postcode`. |
| `checkout.shipTo.state` | string | none | Sent as part of the address. The command line does not set it. |
| `checkout.shipTo.city` | string | none | Sent as part of the address. The command line does not set it. |
| `pages` | string[] | none | Product page URLs to read. Replaces the sampled page list. Same as `--page`. |
| `sitemap` | string | `/sitemap.xml` | The sitemap to read product URLs from. Used only when there is no platform and no `pages`. Relative to `store`. |
| `page` | object (`PageOptions`) | built-in readers | Options for reading each product page. The fields are listed below. |
| `page.priceSelector` | CSS selector | none | The element that holds the current price. Replaces the built-in price readers. If it matches nothing, or its text holds no single amount, no page price is read. |
| `page.availabilitySelector` | CSS selector | none | The element that holds the stock line. Replaces the built-in stock reader. |
| `page.titleSelector` | CSS selector | none | The element that holds the product title. Tried before the built-in selectors: `h1.product_title`, `h1[itemprop="name"]`, `main h1`, `h1`. |
| `page.currency` | uppercase three-letter string or null | When every price in the page's structured data uses one currency, that currency. Otherwise null. | The currency for a bare amount such as "$39". A null value is the same as not setting it. |
| `page.descriptionSelectors` | string[] | the built-in list | The elements read as product description. Replaces the list. The built-in list is `DEFAULT_DESCRIPTION` in `packages/collect-page/src/text.ts`. |
| `page.reviewSelectors` | string[] | the built-in list | The elements read as reviews. Replaces the list. The built-in list is `DEFAULT_REVIEW` in `packages/collect-page/src/text.ts`. |
| `sample` | whole number, 1 or more | `25` | How many products to audit. Same as `--sample`. |
| `maxVariants` | whole number, 1 or more | `30` | Products with more variants than this are not candidates for the sample. The file only; there is no flag. See [Which products get audited](#which-products-get-audited). |
| `seed` | whole number, 0 or more | `1` | Changes which products the sample picks. Same as `--seed`. |
| `strict` | boolean | `false` | Incomplete collection sets report `ok` to false and CLI exit code to 2. Same as `--strict`; current source feature. |
| `datum` | array of surface names | `["checkout", "platform", "page"]` | The surfaces to believe, most trusted first. Same as `--datum`. |
| `budget` | object: rule id to whole number | defaults in [Budgets](#budgets) | The most findings allowed per rule. Same as `--budget`. |
| `ownershipToken` | string | none | The ownership token. It must be 16 to 128 characters: letters, digits, `_` and `-`. Prefer `REGMARK_OWNERSHIP_TOKEN`, which keeps the secret out of the file. |
| `fetch` | object | see [How requests are made](#how-requests-are-made) | The request policy. |
| `fetch.minIntervalMs` | integer, 0–2,147,483,647 | `1000` | The minimum gap in milliseconds between two requests to one host. Same as `--interval`. |
| `fetch.timeoutMs` | integer, 1–2,147,483,647 | `15000` | The time in milliseconds allowed for one request. |
| `fetch.allowPrivateNetwork` | boolean | `false` | Same as `--allow-private-network`. |
| `fetch.respectRobots` | boolean | `true` | Set to `false` to skip the robots.txt check for reads. |
| `fetch.userAgent` | string | `Regmark/0.1.0 (+https://github.com/kairwang01/regmark)` | The User-Agent header sent with each request. |

### Complete example

This file uses only fields in the table above. It is also at
[examples/regmark.config.json](../examples/regmark.config.json). The token is
not in the file; set `REGMARK_OWNERSHIP_TOKEN` in the environment instead.

```json
{
  "store": "https://shop.example",
  "feed": "/feeds/google.xml",
  "platform": "woocommerce",
  "checkout": {
    "shipTo": {
      "country": "US",
      "postcode": "94103"
    }
  },
  "sample": 40,
  "seed": 7,
  "maxVariants": 30,
  "datum": ["checkout", "platform", "page"],
  "budget": {
    "price.mismatch": 0,
    "availability.mismatch": 1,
    "identity.gtin-invalid": 2
  },
  "page": {
    "currency": "USD"
  },
  "fetch": {
    "minIntervalMs": 1000,
    "timeoutMs": 15000
  }
}
```

## Which products get audited

This is a sampled audit, not a full crawler. Pages are parsed from the server
response with no browser or JavaScript execution. Shopify collection is
read-only; UCP, ACP and MCP collectors are not implemented. A fact that cannot
be extracted cannot be compared. Review `surfaces`, `counts`, skipped rules
and `issues` together when assessing the result.

The steps below run in this order. Each one uses the output of the one before.

1. **Platform.** With `auto`, Regmark makes at most two reads. The first is
   WooCommerce's Store API at `/wp-json/wc/store/v1/products?per_page=1`. The
   answer counts as WooCommerce when the status is 200, the body is a JSON
   array, and either the response has an `x-wp-total` header or its first item
   has a `prices` object. The second is Shopify's `/products.json?limit=1`. The
   answer counts as Shopify when the status is 200 and the body is a JSON object
   with a `products` array. A shop that answers neither has no platform, and it
   is audited from its pages alone.
2. **Catalogue.** For WooCommerce, the product list is read 100 products per
   request and stops at 1,000 products. For Shopify, the listing holds at most
   250 products. This list is the source of the sample, so on a larger shop the
   sample is drawn from the first 1,000 or 250 products the shop lists.
3. **Candidates.** A product is a candidate when its variant count is at most
   `maxVariants`. The variant count is the number of WooCommerce variations, or
   the number of Shopify variants, with a minimum of 1. Products with more
   variants are left out of the sample. They are still counted as known
   products when the feed is matched in step 6.
4. **Sample.** A seeded shuffle picks up to `sample` candidates. The chosen
   products are then put back into listing order. The same seed and the same
   listing give the same products.
5. **Details.** For WooCommerce, a second read fetches the variations of the
   sampled products only. For Shopify, the listing read in step 2 already has
   the variants, so there is no second read.
6. **Feed.** With `--feed`, the feed is read once. Its items are kept when their
   product URL matches the URL of a sampled product. An item whose product the
   platform does not list at all is a stray. Up to `sample` distinct stray
   product URLs are added to the page list. Strays are not chosen by the seed.
7. **Page list.** The first rule that applies decides the list:
   - `pages`, from the file or from `--page`. The listed URLs are read exactly.
   - Otherwise, the sampled product permalinks, when step 2 found a platform
     and sampled some products.
   - Otherwise, nothing, when a platform was found but none of its products
     was sampled.
   - Otherwise, when there is no platform, the sitemap at `/sitemap.xml` or at
     `sitemap`. Product URLs are the ones containing `/product/` or `/products/`.
     Those are kept when there are any; otherwise every URL in the sitemap is
     kept. A sitemap index is followed one level down, product sitemaps first,
     and at most three child sitemaps are read. The list is then sampled with
     `sample` and `seed`. When the sitemap yields no URLs, the feed's product URLs
     are sampled instead. A sitemap that cannot be read is recorded as an issue.
   The strays from step 6 are added after this list.
8. **Pages.** Each page in the list is fetched and read. A 404 or 410 response
   is recorded as a `not-found` issue. Other failures are recorded as
   `fetch-failed` or `robots-disallowed` issues. A failed page never stops the run.
9. **Checkout probe.** The probe runs only when the config has `checkout` or
   `--checkout` is given. It is skipped, and an issue is recorded, when the
   platform is not WooCommerce (`probe-unsupported`), or when ownership is not
   verified (`ownership-not-verified`). Otherwise it runs against the sampled
   WooCommerce variants. See [Writes](#writes).

### What `--page` does

`--page` takes a URL, absolute or relative to the store. Each one is read exactly
as given. The flag replaces the page list from step 7. It does not switch off the
platform or the feed. The products sampled from the catalogue still get their
platform readings and their feed readings, and the strays from step 6 are still
added. To audit named pages only, use `--platform none` with `--page`.

## Which surface is believed

A datum is the surface whose statement is believed for a fact. `datum` is the
list of surfaces, most trusted first. For each fact, a rule takes the first
surface in the list that gave an observation of that fact. The default list is
`checkout`, `platform`, `page`. It is `DEFAULT_DATUM` in
`packages/core/src/types.ts`.

- A surface that is not in the list is checked, and never believed. The
  default list leaves out JSON-LD, microdata, Open Graph, the feed, and the
  protocol endpoints. Those are what gets compared.
- A fact with no observation from any surface in the list has no datum. The
  rules that need it say nothing about it.
- When no platform was read, the page becomes the datum. The price and
  availability rules fall back to the page's own headline price and stock line,
  but only when `page` is in the list. [docs/rules.md](rules.md) gives the exact
  conditions under "When no backend was read".
- `--datum` and the file's `datum` replace the default list. The names are
  `page`, `jsonld`, `microdata`, `opengraph`, `feed`, `ucp`, `acp`, `mcp`,
  `platform` and `checkout`; any other name stops the run. `ucp`, `acp` and
  `mcp` are accepted, but no collector reads them in this release.

## Budgets

- By default, an error rule has a budget of 0. Any finding fails the run. A warn
  or info rule has no limit by default; an explicit budget can make it fail.
- A budget is the most findings a rule can have and still pass. Set one with
  `--budget rule.id=n`, which may be repeated, or in the file's `budget` object,
  such as `{ "price.mismatch": 3 }`. A flag replaces the same rule in the file.
- A budget is a whole number, 0 or more. No value means "unlimited"; to stop
  an error rule from failing the build, give it a number the shop could not
  reach.
- A budget for a rule id that does not exist stops the run, so a misspelt id
  cannot leave a rule unguarded.
- The run passes, and exits 0, only when every rule is within its budget and at
  least one product was read. Strict mode also requires zero collection issues.
  A rule skipped because a required surface was not read contributes no findings;
  this is not evidence that the missing surface is correct.

To adopt the tool on a shop that already has findings, set each budget to the
count the shop has today. A later increase above that count fails the build.
Budgets track counts, not finding identities: a new finding can replace an old
one without changing the count, so review the reports too. Lower each budget
as findings are fixed.

## How requests are made

Every request goes through one fetcher. The table gives the values in
`DEFAULT_POLICY` in `packages/core/src/net/fetcher.ts`.

| Setting | Default | Settable in the file | Meaning |
|---|---|---|---|
| Pacing: `minIntervalMs` | `1000` ms | yes, `fetch.minIntervalMs` | The minimum gap between two requests to one host. It applies to every request, including robots.txt and redirects. Hosts are compared with `www.` removed. |
| Timeout: `timeoutMs` | `15000` ms | yes, `fetch.timeoutMs` | The time allowed for one request. |
| Size: `maxBytes` | `5242880` bytes (5 MiB) | no | The largest response body accepted, counted after decompression. |
| Redirects: `maxRedirects` | `5` | no | The most redirects followed for a read. |
| robots.txt: `respectRobots` | `true` | yes, `fetch.respectRobots` | Whether robots.txt is obeyed for reads. |
| Robots agent: `agentToken` | `Regmark` | no | The name matched against robots.txt groups. |
| Private network: `allowPrivateNetwork` | `false` | yes, `fetch.allowPrivateNetwork` | Whether hosts on private addresses may be contacted. |
| User-Agent: `userAgent` | `Regmark/0.1.0 (+https://github.com/kairwang01/regmark)` | yes, `fetch.userAgent` | The User-Agent header. |

### Host allowlist

A run contacts only the store's host, and the feed's host when `feed` is set.
A page or sitemap outside that allowlist is refused with `foreign-host`.
Redirects outside the allowlist are not followed: the caller receives the 3xx
response. Redirects between allowed origins may be followed, but caller-supplied
headers are dropped across origins so credentials and cart tokens cannot leak.

### Private addresses

A host that resolves to a private address is refused, unless
`--allow-private-network` or `fetch.allowPrivateNetwork` is set. The check runs
on every address the connection uses. If any of them is private, the connection
fails. A host written as an IP literal is checked before the request.

The refused ranges are:

- IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`,
  `169.254.0.0/16` (link-local, including cloud metadata addresses),
  `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`,
  `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4` and
  `240.0.0.0/4`.
- IPv6: `::/96` (unspecified, loopback and deprecated IPv4-compatible addresses), `64:ff9b:1::/48`, `100::/64`,
  `2001:db8::/32`, `fc00::/7`, `fe80::/10` and `ff00::/8`.

An IPv4 address inside an IPv6 mapped or NAT64 address is checked as IPv4.

### robots.txt

`/robots.txt` is read once for each origin in a run.

- A 2xx response is parsed. The group named `Regmark` is used when there is one.
  Otherwise the `*` group is used. The longest matching rule wins, and on a tie
  an allow beats a disallow. Only the first 512 KiB are read.
- A 4xx response means there are no rules.
- A 5xx response, a network error or a timeout refuses every read from that
  origin, with `robots`.
- A redirect to a host outside the allowlist means there are no rules.

### Refusals

A request that is refused, or that fails, becomes an issue. Its message starts
with the refusal code and the URL, for example `foreign-host: https://...`.

| Code | Meaning |
|---|---|
| `bad-url` | Not an http or https URL, or the URL has a user name or password. |
| `foreign-host` | The host is not on the allowlist. |
| `robots` | robots.txt does not allow the path. |
| `private-address` | The host resolves to a private address. |
| `too-large` | The response body is larger than 5 MiB. |
| `timeout` | No complete response within `timeoutMs`. |
| `too-many-redirects` | More than `maxRedirects` redirects. |
| `write-not-authorized` | A write was attempted before ownership was verified. The probe never does this. |
| `network` | The connection or the decoding failed. |

### Writes

Only the checkout probe writes to the shop. A write is made only after the run
has verified that the operator controls the shop, in one of two ways:

- The file `/.well-known/regmark.txt` on the shop has a line that is exactly
  `regmark-verify=<token>`, after trimming the line. The response must be a 200
  from the shop's own origin.
- A TXT record at `_regmark.<store host>` has the value `regmark-verify=<token>`.
  The host is the one in `store`, including any `www.`.

The token is chosen by the operator. It must be 16 to 128 characters: letters,
digits, `_` and `-`. If neither check succeeds, the probe is skipped and an
`ownership-not-verified` issue is recorded. A write is never redirected.
In default mode, the ownership issue does not fail an otherwise passing audit; use current source's `--strict` when that
missing probe must fail CI. The probe writes cart/session state, attempts
cleanup after each variant and never places an order or initiates payment.
