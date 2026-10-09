# Contributing to Regmark

## Before you start

Try the [fixture demo](docs/quickstart.md) and read the
[supported boundaries](README.md#what-it-reads). Good first
contributions include a minimal theme HTML fixture, a clearer rule explanation, a reproducible false
alarm, or a correction that keeps the English and Chinese READMEs aligned.
No live store credentials are needed for the test suite.

The most useful contribution is a report of a false alarm or a missed defect
from a real shop. The fixture shops in this repository are built from our own
expectations, so they cannot find the cases we did not think of. A real shop
can. Use the **False alarm** issue template (`false-alarm.yml`) when Regmark
reports something that is not true, and the **Missed defect** template
(`missed-defect.yml`) when two surfaces disagree and nothing was reported.

## Setting up

You need Node 22.18 or later and pnpm. Use the pnpm version named in the
`packageManager` field of `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm test        # unit tests
pnpm bench       # the benchmark against the two fixture shops
pnpm typecheck
pnpm bundle      # rebuild the distributable when runtime sources change
node scripts/bundle.mjs --check
```

There is no build step for development. Node runs the TypeScript sources
directly: `node packages/cli/src/bin.ts demo` is the command line. Once the
dependencies are installed, the tests and the benchmark need no network access
and no API keys.

`dist/regmark.mjs` is the whole tool bundled into one file, for `npx` and for
the GitHub Action. Rebuild it with `pnpm bundle` when runtime sources change,
and include the matching generated file in the pull request. CI checks that the committed
bundle matches the sources because GitHub installs and the Action execute
that file directly. Review source changes first, then verify the bundle
freshness check; do not hand-edit generated code.

The repository workflow runs type checking, unit tests, fixture benchmarks and
bundle verification on Node 22 and 24, and runs the GitHub Action itself
against both fixture shops. A release pin still points at its original
implementation until a new release is published.

## Cutting a release

1. Set the new version in `package.json`, move the `Unreleased` notes in
   `CHANGELOG.md` under a `## X.Y.Z (date)` heading, run `pnpm bundle` and
   `pnpm check`, and merge that to `main`.
2. Tag the merge commit `vX.Y.Z` and push the tag. The release workflow checks
   the commit again, creates a draft GitHub release with the bundle and its
   SHA-256, publishes the package to npm with provenance and moves the major
   tag (`v0`).
3. Open the draft release on GitHub, tick **Publish this Action to the GitHub
   Marketplace**, check the categories and publish it. That last step cannot
   be automated.

## How the code is laid out

Dependencies point one way. `core` knows no collector, collectors know no
rule, and rules know no reporter.

- `packages/core/`: types, money, identifiers, the offer graph, the rule
  runner, the guarded fetcher, ownership verification
- `packages/collect-page/`: visible price and stock, JSON-LD, microdata, Open
  Graph, text, and the pages read again as other clients for the cloaking check
- `packages/collect-feed/`: Google Merchant feeds and ACP product feeds
- `packages/collect-protocol/`: the endpoints agents call: the UCP catalogue
  and a shop's storefront MCP server, read-only
- `packages/collect-woo/`: WooCommerce Store API and the checkout probe
- `packages/collect-shopify/`: Shopify public catalogue and the cart probe
- `packages/rules/`: the seventeen rules
- `packages/report/`: terminal, JSON, SARIF, JUnit, Markdown and HTML output
- `packages/cli/`: the command line and the audit itself
- `fixtures/shop/`: the two test shops, one misprinted and one clean
- `e2e/`: the benchmark
- `docs/rules.md`: what each rule means

## Adding a rule

Do the steps in this order.

1. **Describe the rule in `docs/rules.md`.** Say when it fires. Say just as
   carefully when it stays silent. Add the level and a one-line summary. Add
   the rule to the tables in `README.md` and `README.zh-CN.md`, and update both
   rule counts.
2. **Add a defect to `fixtures/shop/src/shop.ts`.** Append an entry to the
   `DEFECTS` list. Give it the next id, a one-line `summary`, the findings it
   should produce in `expected`, and an `apply` function that changes one
   surface. Then run `pnpm bench` and watch it fail: it prints each missed
   defect as `MISSED` and each unexpected finding as `EXTRA`, and it passes
   only when there are none of either. If you add defects, update the defect
   and finding counts in both READMEs, the demo text and affected documentation
   in the same pull request.
3. **Write the rule.** Put it in one file: `packages/rules/src/parity/` when it
   compares surfaces, or `packages/rules/src/content/` when it reads product
   text. The file exports a default `defineRule({...})` with `id`, `severity`,
   `summary`, `help` and `check`. `check` is a pure function. It does no I/O
   and reads the time only from `ctx.now`. Get the datum with `ctx.pick`. Write
   `help` as two or three sentences that give the usual cause and the fix.
4. **Write the tests.** Put them in `packages/rules/test/parity/` or
   `packages/rules/test/content/`, named after the rule. Build the input with
   the helpers in `packages/rules/test/helpers.ts`: `variant` and `whole` for
   sightings; `price`, `stock`, `shipping`, `returns`, `until`, `bought` and
   `sample` for observations; `run` for findings; `runFull` when a skipped rule
   matters; `brief` to compare findings. Write more silent cases than firing
   cases. Each silent case states something the rule must not do.
5. **Register the rule** in `packages/rules/src/index.ts`. Import it and add it
   to `parityRules` or `contentRules`. The order of those arrays is the order
   reports list the rules in.
6. **Run `pnpm typecheck`, `pnpm test` and `pnpm bench`.** All must pass. The
   clean shop must still report nothing. Rebuild and verify the bundle after
   changing runtime sources.

The fixture comes before the rule because a defect written first states the
expected finding in advance. The rule is then measured against a fixed shop,
not against its own assumptions. A rule that passes only the tests written
beside it has not been checked against anything.

## Adding a collector

A collector reads one surface of a shop and returns what it found, as
`Sighting`s and `CollectIssue`s. It never judges. Deciding whether a
disagreement is a finding is the rules' job. A collector takes a
`CollectContext` and returns a `CollectResult`, as `collectPages` in
`packages/collect-page/src/index.ts` does.

- All network access goes through `ctx.fetcher`. Only `send` may change state,
  and it refuses to run until the shop's ownership has been verified.
- Never throw because of what a shop returned. Catch the error and return a
  `CollectIssue` with a short, stable `code`. One dead link must not end an
  audit.
- Omit a field rather than guess. A missing price is silence. An invented price
  is a false alarm.
- Every `Observation` carries the exact source text in `raw` and a `locator`
  that points back into the response, such as a JSON pointer, a CSS path or a
  feed item id.
- Test against recorded or hand-written responses. The fake stores in
  `packages/collect-woo/test/fake-store.ts` and
  `packages/collect-shopify/test/fake-shop.ts` show the pattern. A collector
  test never reaches the live network.

## What makes a change easy to accept

- One concern per pull request. A new rule, a collector fix and a documentation
  change are three pull requests.
- Tests for the silent cases, not only the firing cases.
- No new runtime dependency without a reason stated in the pull request.
- An error-level rule must not fire on ordinary shops. Say how you checked. At
  minimum, the clean fixture must stay silent. Where you can, run the change
  read-only against a few real shops and put the result in the pull request.
- Text from a shop is untrusted. It is escaped in every report format. A
  reporter that writes shop text without escaping is a bug, whatever the format.

## Documentation and demonstration changes

- Keep commands aligned with CLI behavior and distinguish current source from
  released versions, especially for new flags.
- Explain coverage: read-only defaults, optional WooCommerce cart writes,
  Shopify read-only support, static HTML and sample limits.
- Refresh screenshots from actual fixture output; label synthetic examples.
  Use the [demo reproduction guide](docs/demo.md).
- Check relative links and keep the two READMEs consistent.
- Cite official sources for external platform requirements. Do not claim
  guaranteed merchant approval, rankings, AI citations or star growth.

## Reporting a false alarm

Use the **False alarm** template. Include:

- the rule id, for example `price.mismatch`;
- both values from the finding, and both locators, copied exactly as the report
  shows them;
- what the shop actually charges, how you checked it, and the date you checked.

You may leave the shop's name out if you include the page HTML or the feed
entry that shows the statement. The snippet is enough for a maintainer to start
from. Report a missed defect the same way, with the **Missed defect** template.

When sharing fixtures, remove cookies, authorization headers, ownership tokens
and customer details. A short HTML fragment or feed entry is usually enough;
you do not need to publish a complete private shop export.

## Licence of contributions

Contributions are accepted under the Apache-2.0 licence that covers this
project.
