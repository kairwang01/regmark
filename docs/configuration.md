# Configuration

Every command, flag, config field and environment variable that Regmark reads,
with the defaults the code sets. Start with the [quickstart](quickstart.md) for
a first audit. This reference describes the current release; when you run a
pinned older version, read the reference from that release's tag.

[Commands](#command-line) · [Config fields](#fields) · [ACP feed](#the-acp-feed) · [Checkout probe](#the-checkout-probe) · [Sampling](#which-products-get-audited) · [Baseline](#which-surface-is-believed) · [Budgets](#budgets) · [Request policy](#how-requests-are-made) · [Ownership](#writes) · [Cloaking check](#the-cloaking-check) · [Agent endpoints](#the-agent-endpoints)

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
| `--feed` | URL, absolute or relative to the store | none | Reads a product feed in Google Merchant format: RSS, Atom or tab-separated text. The file is read once, whole. A file published gzipped, such as `feed.xml.gz`, is unpacked. |
| `--acp-feed` | URL, absolute or relative to the store | none | Reads an Agentic Commerce Protocol product feed, the catalogue a shopping agent sells from, as the `acp` surface. See [The ACP feed](#the-acp-feed). The file is read once, whole, and unpacked when it is gzipped. |
| `--platform` | `woocommerce`, `shopify`, `auto` or `none` | `auto` | The storefront API to read. `auto` tries WooCommerce, then Shopify. `none` reads no storefront API. The pages, and the feed if one is given, are still read. |
| `--checkout` | switch | off | Runs the checkout probe. See [The checkout probe](#the-checkout-probe). Needs `--platform woocommerce`, `shopify` or `auto`, and a verified ownership token. `--platform none` stops the run with exit 2. With `auto`, a shop that is neither WooCommerce nor Shopify gets a `probe-unsupported` issue and no probe. |
| `--cloaking` | switch | off | Runs the cloaking check: each sampled page that was read is fetched again once per client profile, by default as a desktop browser and as a shopping agent, and `content.cloaking` compares what each was told. Needs a verified ownership token. See [The cloaking check](#the-cloaking-check). |
| `--ucp` | switch | off | Reads the shop's UCP catalogue: the business profile at `/.well-known/ucp`, then a catalogue lookup of the sampled products. UCP `2026-08-25` and `2026-04-08`. Read-only. See [The agent endpoints](#the-agent-endpoints). |
| `--mcp` | switch | off | Reads the shop's storefront MCP server at `/api/mcp`: the MCP handshake, `tools/list`, then UCP's catalogue tools for the sampled products. MCP `2025-11-25`, `2025-06-18` and `2025-03-26`. Never calls a cart, checkout or order tool. See [The agent endpoints](#the-agent-endpoints). |
| `--ship-to` | `CC` or `CC:postcode` | the config file's `checkout.shipTo`, else `US` | The destination for the probe. The country must be two letters; this is checked even when no probe runs. The text after the colon is sent as the postcode. It takes effect when the probe runs: with `--checkout`, or with `checkout` in the config file. |
| `--page` | product page URL | none | Reads this page instead of the sampled page list. Repeat the flag for more pages. See [Which products get audited](#which-products-get-audited). |

#### Scope

| Flag | Value | Default | What it does |
|---|---|---|---|
| `--sample` | whole number, 1 or more | `25` | How many products to audit. |
| `--seed` | whole number, 0 or more | `1` | Changes which products the sample picks. The same seed on the same catalogue picks the same products. |
| `--datum` | surface names, comma-separated | `checkout,platform,page` | The surfaces to believe, most trusted first. See [Which surface is believed](#which-surface-is-believed). |
| `--budget` | `rule=n`, repeatable | see [Budgets](#budgets) | The most findings allowed for one rule. The rule must exist (`regmark rules` lists them) and the value is a whole number. Replaces the same rule in the config file. |
| `--max-age` | `surface=age`, repeatable | none | The oldest a feed may be, as a whole number of minutes, hours or days: `feed=90m`, `feed=24h`, `feed=7d`. The surface is `feed` or `acp`, and that feed must be read in the same run. Turns on [`availability.stale`](rules.md#availabilitystale-warn), which compares the time the feed says it was generated with the time of the audit. Replaces the same surface in the config file. |
| `--strict` | switch | off | Treat any collection issue as an incomplete audit: set report `ok` to `false` and exit `2`. Reports are still written when collection completes. |

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
platform, a feed with a `maxAge` of 24 hours, the shop's ACP feed
(`/feeds/acp.jsonl.gz`), the UCP and MCP readers, the checkout probe, the
cloaking check and a sample of 50. The config file is not read.

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
| `REGMARK_OWNERSHIP_TOKEN` | `audit` | The ownership token for the checkout probe and the cloaking check. A non-empty value replaces `ownershipToken` from the config file. An empty one is ignored, which is what a CI job passes when the secret is not set. |
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
- `platform`, `feed`, `acpFeed`, `sample`, `seed` and `datum`: a flag replaces
  the file's value (`--acp-feed` replaces `acpFeed`). `--page` replaces the
  file's `pages`.
- `strict`: `--strict` sets it to true. No CLI flag sets a configured true value back to false.
- `budget`: the file's entries are kept. Each rule given with `--budget`
  replaces its own entry.
- `maxAge`: the file's entries are kept. Each surface given with `--max-age`
  replaces its own entry.
- `fetch`: the file's entries are kept. `--interval` replaces
  `fetch.minIntervalMs`. `--allow-private-network` sets
  `fetch.allowPrivateNetwork` to true. No flag sets it back to false.
- `checkout`: the probe runs when `--checkout` is given or the file has a
  `checkout` key. Its destination is `--ship-to` when that is given, otherwise
  the file's `checkout.shipTo`, otherwise `US`. No flag turns off a probe the
  file asks for.
- `cloaking`: the check runs when `--cloaking` is given or the file's
  `cloaking` is `true` or an object. With both, the file's `userAgents` are
  kept. No flag turns off a check the file asks for.
- `ucp` and `mcp`: each is read when its flag is given or the file's value is
  `true` or an object. With both, the file's `url` and `agentProfile` are kept.
  No flag turns off a reader the file asks for.
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
| `acpFeed` | string | none | An Agentic Commerce Protocol feed URL, absolute or relative to `store`. Same as `--acp-feed`. Its host is added to the host allowlist. |
| `platform` | `"woocommerce"`, `"shopify"`, `"auto"` or `"none"` | `auto` when neither the flag nor the file sets it | The storefront API to read. `"none"` reads no API. Same as `--platform`. |
| `checkout` | object: `{ "shipTo": ShipTo }` | off | Turns on the checkout probe. The key's presence in the file is enough. |
| `checkout.shipTo` | `ShipTo` | `{ "country": "US" }` from `--checkout`. Required in the file. | The destination for the probe. WooCommerce gets it as the shipping and billing address. Shopify gets the postcode, country and state as the address to quote shipping rates for. |
| `checkout.shipTo.country` | string, two letters | `US` from the flag | The ISO 3166-1 alpha-2 country code. |
| `checkout.shipTo.postcode` | string | none | The postcode. Set by `--ship-to CC:postcode`. |
| `checkout.shipTo.state` | string | none | Sent as part of the address, and to Shopify as the province, as written. The command line does not set it. |
| `checkout.shipTo.city` | string | none | Sent as part of the address to WooCommerce. Shopify's rate endpoints take no city, so it is not sent there. The command line does not set it. |
| `cloaking` | `true`, `false` or object: `{ "userAgents": { name: User-Agent } }` | off | Turns on the cloaking check. Same as `--cloaking`. `true` uses the two default profiles. Needs a verified ownership token. |
| `cloaking.userAgents` | object: profile name to User-Agent string | `browser` and `agent`, below | The clients to pose as, in the order they are read. At least one. A name is lower-case letters, digits and `-`, starting with a letter, at most 32 characters; it appears in findings and issues. A User-Agent is printable ASCII. Name one profile `browser` to make it the reference the others are compared with; without one, each profile is compared with Regmark's own read of the page. The defaults are `DEFAULT_CLOAKING_PROFILES` in `packages/cli/src/config.ts`: `browser`, a desktop Chrome User-Agent, and `agent`, a User-Agent carrying the `ChatGPT-User` token. |
| `ucp` | `true`, `false` or object: `{ "url"?: string, "agentProfile"?: string }` | off | Reads the shop's UCP catalogue. Same as `--ucp`. `true` reads the profile at `/.well-known/ucp`. |
| `ucp.url` | string, URL | `/.well-known/ucp` | The business profile to read, absolute or relative to `store`. Its host is added to the host allowlist. |
| `ucp.agentProfile` | string, https URL | `AGENT_PROFILES` in `packages/collect-protocol/src/ucp.ts`, for the version spoken | The agent profile named in every catalogue request. The shop fetches it, so it must be public. It must declare the UCP version the shop speaks and the catalogue capabilities. |
| `mcp` | `true`, `false` or object: `{ "url"?: string, "agentProfile"?: string }` | off | Reads the shop's storefront MCP server. Same as `--mcp`. `true` reads `/api/mcp`. |
| `mcp.url` | string, URL | `/api/mcp` | The MCP endpoint, absolute or relative to `store`. Its host is added to the host allowlist. On Shopify, `/api/ucp/mcp` is the endpoint with catalogue tools. |
| `mcp.agentProfile` | string, https URL | the `2026-08-25` entry of `AGENT_PROFILES` | The agent profile sent in `meta` with each catalogue tool call. |
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
| `strict` | boolean | `false` | Incomplete collection sets report `ok` to false and CLI exit code to 2. Same as `--strict`. |
| `datum` | array of surface names | `["checkout", "platform", "page"]` | The surfaces to believe, most trusted first. Same as `--datum`. |
| `budget` | object: rule id to whole number | defaults in [Budgets](#budgets) | The most findings allowed per rule. Same as `--budget`. |
| `maxAge` | object: `feed` or `acp` to a duration string | none | The oldest each feed may be, such as `{ "feed": "24h" }`. A duration is a whole number followed by `m`, `h` or `d`, greater than zero. The named feed must be read in the same run (`feed` needs `feed`, `acp` needs `acpFeed`), or the run stops with exit 2. Without it, `availability.stale` is skipped. Same as `--max-age`. |
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

## The ACP feed

`--acp-feed` reads the product feed a shop sends to a shopping agent under the
[Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol).
The protocol has no public feed URL: OpenAI takes the file by SFTP or through
its API, so point `--acp-feed` at a copy you publish, such as the file your
export job uploads, served from the shop's host or another host you name.

The format is told from the file, not from its name, and the file may be
gzipped (`.jsonl.gz`, `.csv.gz`, `.tsv.gz`), as OpenAI asks for it:

- **OpenAI's file-upload format** as JSON Lines, CSV or TSV: one row per item
  or variant, with `item_id`, `url`, `price` written as `79.99 USD`,
  `sale_price`, `availability` (`in_stock`, `out_of_stock`, `pre_order`,
  `backorder`, `unknown`), `gtin`, `mpn`, `brand`, `group_id`,
  `variant_dict`, `shipping_price` or the `shipping` tuple, and
  `accepts_returns`, `return_deadline_in_days` and `return_policy`. The
  [products spec](https://developers.openai.com/commerce/specs/file-upload/products)
  defines them.
- **OpenAI's Google-compatible profile**, a CSV or TSV file with Google's
  column names (`id`, `link`, `image_link`, `item_group_id`) and spellings
  (`preorder`). A delimited file with a `url` column is read in the format
  above; one with `link` and no `url`, in this profile.
- **The protocol's Product and Variant model**, as `products.jsonl` (one
  Product per line) or a `{"products": [...]}` document as the Feed API
  returns it. Prices are whole minor units: `{"amount": 1999, "currency": "USD"}`.

Parquet, which OpenAI also accepts, is not read; nor are XML and a bare JSON
array, which no ACP format uses. Each stops the read with a `parse-error` that
says what to export instead.

The ACP formats are not Google's, and are read by their own rules:

- A valid `sale_price` is the price whatever its dates say: in this contract
  sale dates schedule nothing. The end of its `sale_price_effective_date` is
  kept, so [`price.sale-expired`](rules.md#pricesale-expired-warn) can report
  a sale price still offered after the date it says it ends. A sale that is
  not above zero, below `price` and in its currency is not used, and the
  regular price is.
- A row with `is_eligible_search=false` is held back from agents on purpose.
  It still lists its variant, so `variant.missing` does not fire for it, but
  none of its facts are compared.
- Money is read only as the spec writes it, `79.99 USD`. `$79.99` and
  `1,299.00 USD` are reported as unreadable rather than guessed at. An amount
  with no currency is kept, for `price.currency-ambiguous` to report.
- A value the format would reject, such as an availability it does not
  accept, is reported with the issue code the
  [report format](report-format.md#collection-issue-codes) lists, and left out.

No ACP format states when the file was generated, so for
[`--max-age acp=...`](#scope) an ACP feed is dated only by the
`Last-Modified` header of the response.

## The checkout probe

`--checkout` puts one unit of each sampled variant in a real cart, reads what
the cart says about it, and empties the cart again. It is the only part of
Regmark that writes to a shop, so it runs only after the shop's ownership is
verified (see [Writes](#writes)). It never goes further than the cart: no
checkout is started, no order is placed, nothing is paid.

What it reads is the `checkout` surface, which comes first in the default
datum. Where the probe ran, the price in the cart is the one every other
surface is held to.

| Reading | WooCommerce | Shopify |
|---|---|---|
| Can it be bought (`purchasable`) | `add-item` accepts the unit, or refuses it with an error code, which is kept | `add.js` accepts the unit, or refuses it with a `422` `Cart Error`, whose text is kept |
| Price | the cart line's price, once the destination is set | the added line's `final_price`: the unit price after any automatic discount on the line |
| Shipping | the cart's shipping total for the destination | the cheapest rate offered for the destination |
| Landed total | the cart's total, with tax as the shop works it out for the destination | not read: see **Tax** below |

### On WooCommerce

The probe uses the Store API at `/wp-json/wc/store/v1`. `GET /cart` gives it a
cart token. For each variant it then calls `POST /cart/add-item`,
`POST /cart/update-customer` with `checkout.shipTo` as the shipping and
billing address, and `DELETE /cart/items`. A last `GET /cart` confirms that
the cart is empty.

### On Shopify

The probe uses the cart endpoints of the shop's online store, the ones its
theme calls, which Shopify documents as the
[Ajax Cart API](https://shopify.dev/docs/api/ajax/reference/cart). A headless
shop, with no online store theme, has none of them; the probe then records
`probe-failed` and writes nothing.

1. `GET /cart.js` opens a cart for the session, and shows that it is empty and
   which currency it is in.
2. For each sampled variant:
   - `POST /cart/add.js` with one unit.
   - `POST /cart/prepare_shipping_rates.json`, then
     `GET /cart/async_shipping_rates.json` until the rates are ready, at most
     four times. Both carry the destination as `shipping_address[zip]`,
     `shipping_address[country]` and `shipping_address[province]`, taken from
     the postcode, country and state of `checkout.shipTo`. A line that ships
     nothing, such as a gift card, skips this step.
   - `POST /cart/clear.js`, whose answer must show an empty cart.
3. `GET /cart.js` again, to confirm the cart is empty.

That is two requests for a variant the cart refuses, and four or more for
one it accepts, spaced like every other request.

- **Session.** A Shopify cart belongs to the browser session that made it,
  not to a token. The probe keeps the cookies the shop sets and sends them
  back, to the shop's own origin only, for the length of the run.
- **robots.txt.** Shopify's robots.txt disallows `/cart` for crawlers. The
  probe's reads of the cart are made as the owner, after ownership is
  verified, so robots.txt is not consulted for them.
- **Amounts.** Shopify states every cart amount in hundredths of the
  currency's unit, whatever the currency: 1000 yen is `100000`. The probe
  divides by 100 for every currency, so a yen price is not read as a hundred
  times too high. For a currency with three decimals, such as KWD, Shopify's
  documentation does not say how it states amounts, so the price is left out
  with a `probe-failed` issue. A rate's price is decimal text, such as `6.20`,
  and is read as written. A rate that states no currency is taken to be in
  the cart's currency.
- **Currency.** The probe asks for the shop's own URLs, with no market or
  language prefix, and records the currency the cart states. It does not
  choose a market.
- **Discounts.** `final_price` includes automatic discounts that apply to the
  line. A shop that takes 10% off in the cart, while its structured data and
  feed show the full price, gets `price.mismatch` on those surfaces. Discounts
  on the whole order are not included.
- **Tax.** Shopify works out tax at checkout, and no storefront endpoint
  states it before then. The probe never reaches checkout, so it records no
  landed total.
- **What stops it.** A challenge from the shop's bot protection (HTTP 429, 403
  or 430, or a `cf-mitigated` header), a redirect such as a storefront
  password page, a 401, or a page where the cart's JSON should be is not the
  shop's answer about a product. The probe records one `probe-failed` issue,
  empties the cart if an item may be in it, and stops. It does not retry.
  Shopify challenges automated cart traffic, more often from hosting and VPN
  networks, which is where CI runners are, so a probe run from CI can be
  stopped this way.
- **Refusals.** Only a `422` with the message `Cart Error` from `add.js`
  counts as the cart refusing a product: sold out, no more stock to add, not
  sold in this market, or not published to the online store
  (`Cannot find variant`). Any other error is a `probe-failed` issue for that
  variant, and the probe goes on to the next.
- **Shipping.** Rates that are still not ready after four checks, or that
  Shopify fails to calculate, give `probe-failed`. No rate for the
  destination, or an address the shop refuses, such as a postcode that is not
  valid for the country, gives `no-shipping-rate` with the shop's message.
  Neither shows that the shop does not ship there.
- **Cleanup.** When `clear.js` does not answer with an empty cart, the probe
  records `cart-not-emptied` and probes no further variant, so that none is
  added to a cart that still holds one. A cart left behind is anonymous and
  tied to cookies the run discards. Shopify
  [holds stock](https://help.shopify.com/en/manual/checkout-settings) only
  once a buyer submits payment details, so such a cart holds none.

## Which products get audited

This is a sampled audit, not a full crawler. Pages are parsed from the server
response with no browser or JavaScript execution. Shopify collection and the
UCP and MCP readers are read-only. A fact that cannot
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
6. **Feeds.** With `--feed`, `--acp-feed` or both, each feed is read once. Its
   items are kept when their product URL matches the URL of a sampled product. An item whose product the
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
9. **Agent endpoints.** With `--ucp` or `ucp`, then with `--mcp` or `mcp`,
   the shop's agent endpoints are asked about the products in the page list,
   and nothing else: by the variant ids the platform gave, otherwise by the
   SKUs the pages and the feed state, otherwise by the URL handle. See
   [The agent endpoints](#the-agent-endpoints).
10. **Checkout probe.** The probe runs only when the config has `checkout` or
   `--checkout` is given. It is skipped, and an issue is recorded, when the
   platform is neither WooCommerce nor Shopify (`probe-unsupported`), or when
   ownership is not verified (`ownership-not-verified`). Otherwise it runs
   against the sampled variants. See [The checkout probe](#the-checkout-probe)
   and [Writes](#writes).
11. **Cloaking check.** With `--cloaking` or `cloaking`, each page from step 8
    that was read is fetched again once per client profile. It is skipped, with
    an `ownership-not-verified` issue on the `page` surface, when ownership is
    not verified. See [The cloaking check](#the-cloaking-check).

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
  `platform` and `checkout`; any other name stops the run. `ucp` and `mcp` are
  read by `--ucp` and `--mcp`, and `acp` by `--acp-feed`.

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
| Size: `maxBytes` | `5242880` bytes (5 MiB) | no | The largest response body accepted, counted after decompression, including the unpacking of a feed published as a gzip file. |
| Redirects: `maxRedirects` | `5` | no | The most redirects followed for a read. |
| robots.txt: `respectRobots` | `true` | yes, `fetch.respectRobots` | Whether robots.txt is obeyed for reads. |
| Robots agent: `agentToken` | `Regmark` | no | The name matched against robots.txt groups. |
| Private network: `allowPrivateNetwork` | `false` | yes, `fetch.allowPrivateNetwork` | Whether hosts on private addresses may be contacted. |
| User-Agent: `userAgent` | `Regmark/0.1.0 (+https://github.com/kairwang01/regmark)` | yes, `fetch.userAgent` | The User-Agent header. |

### Host allowlist

A run contacts only the store's host, the host of each feed that is set
(`feed` and `acpFeed`), and the hosts of `ucp.url` and `mcp.url` when they are
set. An endpoint that a UCP profile names on another host is refused, as
described in [The agent endpoints](#the-agent-endpoints).
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
| `write-not-authorized` | A write, or an owner read, was attempted before ownership was verified, or a read set its own User-Agent without being an owner read. The probe and the cloaking check never do this. |
| `network` | The connection or the decoding failed. |

### Writes

Only the checkout probe writes to the shop. The UCP and MCP readers send POST
requests, but each one only asks a question; see
[The agent endpoints](#the-agent-endpoints). A write is made only after the run
has verified that the operator controls the shop, in one of two ways:

- The file `/.well-known/regmark.txt` on the shop has a line that is exactly
  `regmark-verify=<token>`, after trimming the line. The response must be a 200
  from the shop's own origin.
- A TXT record at `_regmark.<store host>` has the value `regmark-verify=<token>`.
  The host is the one in `store`, including any `www.`.

The token is chosen by the operator. It must be 16 to 128 characters: letters,
digits, `_` and `-`. If neither check succeeds, the probe and the cloaking
check are skipped and an `ownership-not-verified` issue is recorded for each.
A write is never redirected.
In default mode, the ownership issue does not fail an otherwise passing audit;
use `--strict` when that missing probe must fail CI. The probe writes cart/session state, attempts
cleanup after each variant and never places an order or initiates payment.

### The cloaking check

The cloaking check is the only step besides the probe that needs ownership. It
writes nothing, but it poses as other clients, which Regmark does only on a
shop the operator has shown is theirs. Its reads are owner reads:

- Each read sends the profile's User-Agent in place of Regmark's own, and
  `accept: text/html,application/xhtml+xml`.
- robots.txt is not consulted. It addresses crawlers, and the owner reading
  their own shop is not one. The host allowlist, private address check, size
  and time limits and pacing still apply.
- A redirect to another origin turns the read into an ordinary one there:
  robots.txt applies again, and the User-Agent and other caller headers are
  dropped. The answer was then not given to the profile, so it is recorded as
  a `view-redirected` issue and not compared.

Only pages the ordinary read in step 8 took at least one statement from are
read again. All of a page's profiles are read one after another before the
next page, so the readings compared are as close in time as the pacing allows.

The check costs one extra request per page per profile: with the defaults, a
sample of 25 pages makes 50 more requests, which at the default interval of one
second per host adds about 50 seconds to the run. A page that fails for one
profile is a `view-failed` issue naming the profile, and the other profiles are
still read. What is compared, and when it is reported, is in
[docs/rules.md](rules.md#contentcloaking-error).

### The agent endpoints

`--ucp` and `--mcp` read what a shopping agent is told when it asks the shop
directly: the Y plate. Each asks about the products in the page list and
nothing else, and neither creates a cart, a checkout session or an order.
Their requests are paced and checked against robots.txt like reads, and need
no ownership. A POST among them only asks: a catalogue lookup or search, or a
message of the MCP handshake. It is never redirected; a 3xx answer is a
`fetch-failed` issue.

**UCP** (surface `ucp`). Regmark reads the catalogue of the Universal Commerce
Protocol, releases `2026-08-25` and `2026-04-08` (`UCP_VERSIONS` in
`packages/collect-protocol/src/ucp.ts`):

1. It reads the business profile at `/.well-known/ucp`, or at `ucp.url`.
2. It speaks the newest version both sides know. The profile's `ucp.version`
   is the shop's current one; an older one listed in `supported_versions` is
   read from its own profile, which must name that version. A shop that offers
   neither version is a `version-unsupported` issue.
3. It uses the profile's `dev.ucp.shopping` service for that version: REST when
   offered (`POST <endpoint>/catalog/lookup` and `/catalog/search`), otherwise
   MCP (`tools/call` of `lookup_catalog` and `search_catalog`, as UCP's MCP
   binding defines, without a handshake). Entries for another version are
   ignored. A profile with neither, or without the catalogue capabilities
   `dev.ucp.shopping.catalog.lookup` or `.search`, is a `not-supported` issue.
4. It looks the products up, ten ids to a request, batched across products. The
   ids are the platform's variant ids, written `gid://shopify/ProductVariant/<id>`
   on Shopify; without a platform, the SKUs, or the URL handle. A product that
   no lookup found and that the platform did not list is searched for by its
   title, and a result is taken only when it names the same page or handle. A
   product the platform listed is never searched for: a search may return part
   of a product's variants, and the rest would look missing. A product with more
   than 50 variant ids is not looked up (`too-many-variants`).
5. When the profile declares Shopify's catalogue extension
   (`dev.shopify.catalog`), each request asks for unavailable variants too
   (`filters.available: false`). Without it Shopify leaves sold-out variants out
   of the answer.

Every request names an agent profile, as UCP requires: over REST in the
`UCP-Agent` header, with `Request-Id` and `Content-Digest`; over MCP in
`arguments.meta`. The shop fetches that profile to learn what the caller
understands. By default it is the example agent profile Shopify publishes for
the version spoken (`AGENT_PROFILES`), which declares the catalogue
capabilities and Shopify's extension. Set `ucp.agentProfile` to send your own.

**MCP** (surface `mcp`). Regmark reads the storefront MCP server at `/api/mcp`,
or at `mcp.url`, over MCP's Streamable HTTP transport, revisions `2025-11-25`,
`2025-06-18` and `2025-03-26` (`MCP_VERSIONS` in
`packages/collect-protocol/src/mcp.ts`). It sends `initialize`, the
`notifications/initialized` notification and `tools/list` (at most five pages),
then the same lookups and searches as above as `tools/call`. It returns the
session id and the protocol version the server chose on every later request,
and reads an answer sent as JSON or as an event stream. A server that answers
with another protocol version is a `version-unsupported` issue.

It calls two tools only, `lookup_catalog` and `search_catalog`, and only when
`tools/list` gives them UCP's input shape (a `catalog` argument) and does not
mark them as changing anything (`readOnlyHint: false` or
`destructiveHint: true`). A cart, checkout or order tool is never called,
whatever the server lists. A server without a usable catalogue tool is a
`not-supported` issue that names the tools it does list. `filters.available:
false` is sent when the tools' input schema declares it.

On Shopify, the storefront's `/api/mcp` has listed only
`search_shop_policies_and_faqs` since Shopify moved its catalogue tools to
`/api/ucp/mcp` in 2026, so `--mcp` alone reports `not-supported` there. Set
`mcp.url` to `/api/ucp/mcp`, or use `--ucp`, which finds the same catalogue
through the profile. Shopify's earlier catalogue tools, `search_shop_catalog`
and `get_product_details`, are not read: their shapes are no longer published.

**What is read.** From each variant a lookup found by its own id, or a search
returned: the price and the list price, in whole minor units of the currency
(cents for USD, none for JPY); the list price only when it is above the price,
so Shopify's `0` for "none" is not one; the stock, from `available` qualified by
a well-known `status`; the SKU; a GTIN from a `barcodes` entry of type `GTIN`,
`EAN`, `UPC`, `JAN` or `ISBN`; the options; and the variant id, bare or from a
Shopify gid, as an alias that joins the platform's variant. Every statement
carries the URL of the sampled page, so it joins the product the other surfaces
describe. A variant a lookup found only as the product's featured variant (a
lookup by handle) is a statement about the product, not that variant. A price
per unit of weight or time (`quantity_unit` other than `C62`) is not read. A
price without a three-letter currency is a `field-unreadable` issue. Shipping,
tax, descriptions and media are not read.

**Hosts.** A profile may name its endpoint on a host the run does not contact.
Shopify names the shop's `myshopify.com` host even when the audit names the
shop's own domain. That request is refused with `foreign-host`, and the issue
says what to set: on Shopify, `ucp.url` set to
`https://<shop>.myshopify.com/.well-known/ucp` adds that host, and the same
profile is served there.

**Cost.** UCP makes one request for the profile, then one per ten variant ids,
plus one search per product no lookup found. MCP adds three requests for the
handshake. For 25 products of two variants each, UCP makes 6 requests and MCP 8.

**Issues.** `not-found`: no profile or no MCP server at the URL (404 or 410),
or a sampled product the catalogue has nothing for. `not-supported`: no usable
service or catalogue capability, or no catalogue tool. `version-unsupported`:
no protocol version in common, including a UCP `version_unsupported` error.
`parse-error`: an answer that is not JSON, not a UCP profile or payload, or not
a JSON-RPC answer. `fetch-failed`: an HTTP error, a refusal other than robots,
a JSON-RPC error, a tool that reported an error, or a UCP answer with
`ucp.status: "error"`; the message names the request and the shop's own error
code. `robots-disallowed`: robots.txt does not allow the request. A failed
lookup stops that reader, so one problem is one issue, not one per batch.
