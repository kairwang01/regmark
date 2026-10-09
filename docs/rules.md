# Rule catalogue

Every rule is a pure function from one product in the offer graph to a list of
findings. This page defines, for each rule, exactly when it fires. The
definitions lean towards silence: a rule that cannot be sure says nothing,
because a check that cries wolf gets removed from the pipeline it was added to.

## Words used below

- **Surface**: where a statement was read from. See `Surface` in
  `packages/core/src/types.ts`. `feed` is a Google Merchant feed; `acp` is an
  Agentic Commerce Protocol feed, the one a shopping agent sells from.
- **Plate**: surfaces grouped the way a press sheet is separated: C the page
  (`page`, `jsonld`, `microdata`, `opengraph`), M the feed (`feed`), Y the
  endpoints a shopping agent calls directly (`ucp`, `acp`, `mcp`), and K the key
  plate the others are registered against (`platform`, `checkout`). `ucp` is
  the shop's UCP catalogue (`--ucp`) and `mcp` its storefront MCP server's
  catalogue tools (`--mcp`); see
  [docs/configuration.md](configuration.md#the-agent-endpoints). Both state
  price, list price, stock and identifiers per variant. A variant they found
  only as a product's featured variant is a product-level sighting, so neither
  ever names part of a product's variants by accident.
- **Datum**: the surface that is believed, chosen per fact by
  `ctx.pick(observations)`, which returns the observation from the first
  surface in the run's datum order (default `checkout`, `platform`, `page`)
  that has one. No observation from any datum surface means there is no datum
  for that fact, and the rule says nothing about it.
- **Checked surfaces**: `jsonld`, `microdata`, `opengraph`, `feed`, `ucp`,
  `acp`, `mcp`, and also `page` whenever the datum for that fact came from
  `checkout` or `platform`. A surface is never checked against itself.
- **Variant**: an `Offer` in `product.variants`.
- **Product-level sighting**: an entry of `product.productLevel`. It states one
  thing for the whole product (a page's headline price, an og:price tag), so it
  cannot be compared with one variant. It is compared with the set of all the
  product's variants instead: it is wrong only if it agrees with none of them.
- **Buyable**: `isBuyable(availability)` from core. `in_stock`, `preorder` and
  `backorder` are buyable; `out_of_stock` and `discontinued` are not; `unknown`
  is no statement at all.
- **Checkout**: what a real cart said, read by the
  [checkout probe](configuration.md#the-checkout-probe) on WooCommerce or
  Shopify: whether one unit could be added (`purchasable`), its price, and
  shipping to the probe destination. On Shopify the price is the line's
  `final_price`, after any automatic discount on the line, so a discount that
  only the cart applies is a `price.mismatch` on the surfaces that do not show
  it. Only WooCommerce gives a landed total: Shopify works out tax at
  checkout, which the probe never reaches. A run without the probe skips the
  rules that need `checkout`.

A finding always carries `product` (the `ProductNode.key`). It carries
`variant` (the `Offer.key`) when it is about one variant, `surface` when one
surface is at fault, and `expected` and `actual` evidence when there are two
values to show. Build evidence with `evidence()` or `moneyEvidence()` from
core. The runner overwrites `rule` and `severity`, so a rule may put anything
there.

## Parity rules

### `price.mismatch` (error)
*A surface states a price the datum does not back up.*

For each variant with a price datum `d`: every other price observation `o` on a
checked surface fires when `o.value.currency` is null or equals
`d.value.currency`, and `sameMoney(o.value, d.value)` is false. One finding per
`(variant, surface)`. `expected` is `d`, `actual` is `o`.

Observations whose currency differs from the datum's are skipped here; that is
`price.currency-ambiguous`.

For each product-level sighting `s` with a price, on a checked surface: collect
the price datum of every variant that has one. If that list is empty, say
nothing. Among the datum prices whose currency is compatible with `s.price`
(either side null, or equal): if there is at least one and `s.price` equals none
of them, fire once, without `variant`, with `expected` set to the first
variant's datum.

**When no backend was read.** If no variant of the product has a price datum
and the page is in the datum order, the page's own headline price becomes the
datum for the product. A page states one price for the whole product, so the
comparison is an any-match: for each of `jsonld`, `microdata`, `opengraph`,
`feed`, `ucp`, `acp`, `mcp`, gather every price that surface states for the
product, variant-level and product-level alike, keep those whose currency is
compatible with the page's, and fire once, without `variant`, when there is at
least one and none equals the page price. `expected` is the page observation.

### `price.currency-ambiguous` (error)
*A machine-readable price with no currency, or with a different currency from
the one the shop charges in.*

For each variant with a price datum `d` whose currency is known: every price
observation `o` on `jsonld`, `microdata`, `opengraph`, `feed`, `ucp`, `acp` or
`mcp` fires when `o.value.currency` is null, or is not `d.value.currency`. The
`page` surface is exempt: a person reading "$39" has context a parser lacks.
One finding per `(variant, surface)`.

For each product-level sighting with a price on one of those surfaces: fire
once, without `variant`, when its currency is null or differs from the currency
of every variant's price datum. If no variant has a price datum with a known
currency, say nothing.

**When no backend was read.** If no variant has a price datum and the page is
in the datum order, use the page's headline currency when it is known. Report
once per machine-readable surface when none of its prices states that
currency. A surface that lists any matching currency is compatible with the
product-level page datum, just as with the price fallback.

### `price.tax-basis` (warn)
*Two surfaces state prices exactly one tax rate apart: one includes tax and the
other does not.*

Wherever `price.mismatch` would compare two amounts and find them different,
the pair is first tested against the standard VAT and GST rates. If the larger
is the smaller plus one of those rates, to within a hundredth of a major unit,
this rule fires instead of `price.mismatch`, with the same `variant`, `surface`
and evidence. The test is skipped, and the difference stays a mismatch, when
the currency is USD or CAD: shops there quote prices before tax.

A shop that shows a visitor abroad a price without tax while its storefront
API quotes it with tax is not wrong on either surface, but an agent reading
one and paying the other sees two prices. That is worth knowing and is not an
error.

### `price.sale-expired` (warn)
*A surface says the price stopped applying on a date already past, yet it is
still the price.*

For each variant and each `priceValidUntil` observation `u` on a checked
surface: find the price observation `p` from the same surface. Fire when
`Date.parse(u.value)` is a valid time earlier than the start of the UTC day of
`ctx.now`, and `p` exists, and the variant has a price datum `d`, and
`sameMoney(p.value, d.value)`. A date given without a time counts as the end of
that day, so a sale ending today has not expired. One finding per `(variant,
surface)`; `actual` is `u`.

If the stated price no longer matches the datum, `price.mismatch` reports it and
this rule stays silent.

Where the end date comes from on a feed: a Google feed's sale window schedules
the sale, so the feed collector takes the sale price, and the window's end as
`priceValidUntil`, only while the window is open, and the regular price
outside it. An ACP feed's sale dates schedule nothing: a valid `sale_price` is
what an agent shows whatever its window says. So the collector always takes
it, and keeps the window's end, which this rule then judges.

### `availability.mismatch` (error)
*A surface says an item can be bought when it cannot, or the reverse.*

The datum here is `ctx.pick(variant.availability)`. Note that the checkout
contributes `purchasable`, not `availability`, so in practice this datum comes
from `platform`.

For each variant whose datum `d` is buyable or not buyable (not `unknown`):
every other availability observation `o` on a checked surface fires when
`isBuyable(o.value)` is not null and differs from `isBuyable(d.value)`. One
finding per `(variant, surface)`.

For each product-level sighting with an availability that is not `unknown`, on
a checked surface: collect `isBuyable` of every variant's datum, dropping
nulls. If the list is non-empty and does not contain the sighting's
buyability, fire once, without `variant`.

**When no backend was read.** The same fallback as `price.mismatch`: if no
variant has an availability datum and the page is in the datum order, each
machine-readable surface is held to what the page shows, and fires once,
without `variant`, when it states at least one known availability and none has
the page's buyability.

### `availability.stale` (warn)
*A feed is older than the refresh interval set for it.*

A feed that agrees with the shop today but was generated nine days ago will
disagree as soon as a price or a stock level changes. `availability.mismatch`
cannot see that while the values still match; the feed's own timestamp can.

The rule reads `generatedAt`, which the feed collector puts on every item it
reads from one feed: the RSS channel's `lastBuildDate`, else the channel's
`pubDate`; the Atom feed's own `updated` (not an entry's); else the
`Last-Modified` header of the response. A tab-separated feed can only be dated
by the header, and so can an ACP feed: none of its formats has a place for the
time the file was generated. A timestamp is read only when it is a real RFC 822 date (RSS,
HTTP) or RFC 3339 date-time (Atom) that names its zone; anything else is left
out, never guessed.

For each surface `S` with a limit in `ctx.options.maxAgeMs` (set by `maxAge` or
`--max-age`): take the newest `generatedAt` on any of `S`'s sightings in the
graph. Fire when `ctx.now` minus that instant is greater than the limit.

One finding per surface per run, not one per product. The age belongs to the
whole file, and a finding on each of its items would bury the rest of the
report and swamp any budget set for this rule. The finding goes on the first
product, in graph order, that has a sighting on `S` carrying `generatedAt`. It
has `surface` `S`, no `variant`, and `actual` is the `generatedAt` observation,
shown as `generated 2026-09-30T08:00:00Z, 9 days before the audit`. The message
names the limit.

Silent when the newest timestamp is within the limit or exactly at it, and when
it is in the future. A timestamp on a surface without a limit is not judged.

Skipped when no surface has a limit. Also skipped, rather than passed, when no
surface with a limit states a readable time it was generated: a feed that does
not say how old it is cannot be called fresh. Needs `feed` or `acp`.

### `variant.missing` (error)
*A surface lists some of a product's variants and leaves others out.*

Considered surfaces: `jsonld`, `microdata`, `ucp`, `acp`, `mcp`. The Google
feed (`feed`) is exempt, because leaving variants out of a Merchant Center feed
is often deliberate.

An ACP feed is not exempt, for three reasons. It is the list a shopping agent
sells from, so a variant it leaves out cannot be bought through the agent at
all. The spec asks for one row per variant, out of stock or not, and gives a
merchant a way to hold one back on purpose: `is_eligible_search=false`. The
collector still counts such a row as listing its variant (it states no facts
about it), so a deliberate hold-back does not fire. And OpenAI keeps serving a
record that drops out of the feed for up to 14 days, so a variant left out
when it sold out stays on offer with its last, in-stock record.

The `ucp` and `mcp` readers look each variant up by its own id, and ask for
sold-out variants too where the server lets them, so a variant missing there is
one the catalogue does not answer for.

Call a variant *real* when its `surfaces` include `platform` or `checkout`. For
each considered surface `S`: if at least one real variant has `S` in its
`surfaces` and at least one real variant does not, fire once for each real
variant that does not. `surface` is `S`.

A surface that names no variant of this product at all is not partial, and does
not fire. Needs `platform` or `checkout` to have been collected.

### `variant.unpurchasable` (error)
*Everything says the variant can be bought, and the cart refuses it.*

For each variant with a `purchasable` observation from `checkout` whose value is
false: fire once (no `surface`; `actual` is the checkout observation) when both
hold:
- the `platform` availability, if there is one, is buyable. A platform that
  already says "out of stock" is consistent with the refusal, and any surface
  that disagrees is `availability.mismatch`'s to report;
- at least one availability observation on some surface other than `checkout`
  is buyable.

Needs `checkout`.

A refusal is the cart's own answer about the product. On WooCommerce it is the
Store API's error code; on Shopify it is a `422` `Cart Error` from `add.js`,
and `actual.raw` is its text, such as
`The product 'Classic Tee' is already sold out.` A challenge from the shop's
bot protection, a redirect or a page where the cart's answer should be is not
a refusal: the probe records a `probe-failed` issue and stops, and no
`purchasable` observation is made for this rule to read.

### `shipping.mismatch` (error)
*A surface states a shipping cost the checkout does not charge.*

For each variant with a `shipping` observation `d` from `checkout` that has a
non-null `cost`: every shipping observation `o` on a checked surface fires
when all hold:
- `o.value.country` is undefined, or `d.value.country` is undefined, or they
  are equal (compare uppercased);
- `o.value.conditional` is not true;
- either `o.value.cost` is non-null and `sameMoney(o.value.cost, d.value.cost)`
  is false, or `o.value.cost` is null and `o.value.free` is true while
  `d.value.cost.units` is greater than 0.

One finding per `(variant, surface)`. Needs `checkout`.

The checkout quote `d` is the cart's shipping total for the probe destination
on WooCommerce, and the cheapest rate the cart offers for it on Shopify. Its
country is the destination's.

An ACP feed's `shipping_price` is the charge to the US, the market OpenAI's
standard upload targets, so it is compared with a quote for a US destination
only; its four-position `shipping` tuple names its own country.

### `shipping.undisclosed` (warn)
*A buyer cannot learn the shipping cost before checkout.*

For each variant with a `shipping` observation from `checkout` whose cost is
greater than zero: fire once (no `surface`) when no other surface states a
numeric cost or explicitly free shipping for the checkout destination. A quote
for a different country does not count as disclosure; an unspecified country
is compatible, and country codes are compared without regard to case. An
empty shipping object with neither a cost nor free shipping is not a disclosed
cost. `actual` is the checkout observation.
Needs `checkout`. The checkout quote is the one `shipping.mismatch` uses.

### `identity.unmatched` (warn)
*Something a surface lists cannot be tied to anything the shop sells.*

Applies only when `platform` or `checkout` was collected.

- A product none of whose variants is real (see `variant.missing`), and which
  has no product-level sighting from `page`: fire once for the product, without
  `variant`. `surface` is the product's only surface when it has exactly one,
  otherwise undefined.
- Otherwise, each variant that is not real, in a product that has at least one
  real variant: fire once, with `variant`; `surface` is that variant's only
  surface when it has exactly one.

A sighting marked `withheld`, an ACP row with `is_eligible_search=false`, does
not count as listing anything here: holding a row back is how a feed is told
to stop offering it. The surfaces named, and whether the rule fires at all,
come from the other sightings.

### `identity.gtin-invalid` (warn)
*A GTIN that fails its check digit, has an impossible length, or is given to
two different variants.*

For each variant and each of its `sightings` that has `ids.gtin` and is not
`withheld` (a row held back from buyers shows its GTIN to no one):
- if `normalizeGtin` returns null, or `isValidGtin` is false, fire for that
  `(variant, surface)`;
- otherwise, if the same GTIN (compare with `gtinKey`) appears on the same
  surface for a different variant anywhere in `ctx.graph`, fire for that
  `(variant, surface)`.

At most one finding per `(variant, surface)`. Build the per-surface GTIN index
once per graph, not once per product (cache it in a `WeakMap` keyed by
`ctx.graph`).

### `policy.return-missing` (info)
*No surface gives a return policy for the product in a form a machine can read.*

For each product with at least one real variant: fire once (no `variant`, no
`surface`) when no variant has any `returnPolicy` observation with
`value.present` true and no product-level sighting has one either.

An ACP feed states a policy with `accepts_returns` (true, or false for a final
sale) or a `return_policy` URL, or, in the Product and Variant model, a
seller link of type `refund_policy`. A return window alone does not.

## Content hygiene rules

The first three read `product.text`, a list of `TextSample`. They produce
product-level findings with `surface: 'page'`. `actual` evidence: `value` is the
offending text cut to 120 characters, `raw` the same, `locator` the sample's
locator.

When the cloaking check ran, `product.text` also holds the text that only one
client was shown: each sample a view has that the ordinary read does not (same
`field`, same text) is added once, with ` [via <profile>]` after its locator.
These three rules read it like any other sample, so an instruction served only
to agents is reported, and a sentence every client sees is reported once.
`content.cloaking` reads the views themselves.

### `content.hidden-text` (warn)
*Text kept in the page but deliberately kept from the eye.*

Most hidden text on a real shop is honest, so this rule is narrow on purpose.
For each sample where `hidden` is true and the trimmed text has at least 20
characters:

- `hiddenReason` of `a11y-class`, `alt-attribute` or `html-comment`: never
  fires. Accessibility helpers, image descriptions and editor comments are
  hidden for good reasons.
- `hiddenReason` of `font-size:0`, `color:transparent`,
  `color-matches-background`, `offscreen`, `zero-size` or `clipped`: fires.
  An interface has no ordinary use for these.
- any other reason (`display:none`, `visibility:hidden`, `opacity:0`,
  `hidden-attribute`): fires only when the text reads as keyword stuffing: at
  least eight words of four letters or more, among which a word from the
  product's own title occurs at least four times and makes up at least a fifth
  of them. When the product has no title the bar is six times and three
  tenths, for any word. Carousels, accordions, size guides and modals hide
  their content this way and are not reported.

### `content.instruction-like` (error)
*Product text addressed to a language model rather than to a shopper.*

Fire once per sample, hidden or not, including the exempt reasons above, whose
text matches any pattern in the rule's list. The list must stay short and
specific, because this is an error-level rule; each pattern needs a test with
a real-looking positive and a near-miss negative. It must include, case
insensitively:

- `ignore`/`disregard`/`forget` followed within a few words by
  `previous`/`prior`/`above`/`earlier`/`all` and
  `instructions`/`prompts`/`directions`/`rules`
- direct address to a model: `AI assistant(s)`, `language model(s)`, `LLM(s)`,
  `chatbot(s)`, `AI agent(s)`, `shopping agent(s)`, `assistant:` at the start
  of a sentence, when followed within the same sentence by an imperative such
  as `recommend`, `tell`, `say`, `rank`, `always`, `must`, `should`, `ignore`,
  `do not`
- `system prompt`, `you are now`, `new instructions:`
- `tell the user`/`tell the customer`/`tell the shopper` followed by `that` or
  `to`
- the Chinese equivalents: `忽略`/`无视` followed by
  `之前`/`以上`/`前面`/`先前` and `指令`/`提示`/`要求`/`规则`; `AI 助手`/`智能助手`/`大模型`
  followed in the same sentence by `请`/`必须`/`务必`/`应当`

Ordinary sales copy ("We recommend washing cold", "Our assistant will contact
you", "Ignore the cold in this jacket") must not fire.

### `content.invisible-chars` (warn)
*Characters that render as nothing and can carry text a person never sees.*

Fire once per sample when either holds:
- it contains a Unicode tag character, U+E0020 to U+E007E, that is not part of
  an emoji flag sequence (a run of tag characters directly after U+1F3F4 and
  ending in U+E007F);
- it contains three or more of U+200B, U+2060, U+FEFF in total. U+200C and
  U+200D are not counted: they are ordinary in Persian, Indic scripts and
  emoji.

`value` in the evidence should name what was found, for example
`7 tag characters, 3 zero-width spaces`, not echo the invisible text.

### `content.cloaking` (error)
*A page tells an agent a different price or stock level than a browser.*

Runs only when the cloaking check ran (`--cloaking`, which needs verified
ownership); otherwise it is skipped with `needs --cloaking`. The check reads
each sampled page again once per client profile and keeps each reading as a
view: sightings with `via` set to the profile name, gathered in
`product.alternateViews` and kept out of the offer facts.

The **reference** for a product is its `browser` view when there is one,
otherwise its ordinary sightings (the read made with Regmark's own User-Agent).
Every other view is compared with it. The reference is not itself compared with
anything.

For each view `V`, each surface `S` among `page`, `jsonld`, `microdata` and
`opengraph`, and each of two facts, price and buyability: take the statements
of that fact on `S` from `V` and from the reference. A buyability statement is
`isBuyable(availability)`, and `unknown` is no statement. Then, for each
statement `v` from the view, in order:

- If the reference has sightings on `S` that are the same item as `v`, `v` is
  held to the statements among them. Two sightings are the same item when the
  first kind of identifier both carry agrees: SKU (by `skuKey`), else GTIN (by
  `gtinKey`), else option set (by `optionsKey`). When those sightings state
  nothing about the fact, `v` is skipped.
- Otherwise `v` is held to every statement of the fact the reference makes on
  `S`.
- `v` is contradicted when it agrees with none of the statements it is held
  to. Prices agree when `sameMoney` is true, so a different currency is a
  different price and a missing currency is not. Buyability agrees when it is
  equal.

Fire for the first contradicted statement, once per `(view, surface, fact)`,
without `variant`. `surface` is `S`; `expected` is the reference statement it
was held to (the first one), `actual` is `v`. Both locators end in
` [via <profile>]` when they come from a view. The message names the view, for
example `a client identifying as agent was told 19.00 USD in jsonld; a browser
22.00 USD`; with no browser view the reference is called `Regmark itself`.

It stays silent when:

- a view leaves a fact out, or leaves a surface out altogether. A lighter page
  for bots is not a different offer;
- either side's stock level is `unknown`, or the reference names the item and
  states nothing about the fact;
- the same facts come in another order, or a view states for the whole product
  a price the reference gives one of the variants;
- only markup or text differs: CSRF tokens, timestamps, tracking scripts,
  related products. Text is the other content rules' business;
- one surface in the view disagrees with another surface in the reference.
  Each surface is compared only with itself;
- a view could not be read for the product, or only the reference was read.
  A page read through a redirect to another origin was not read as the client,
  and is not a view.
