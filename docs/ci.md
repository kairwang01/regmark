# Running Regmark in CI

There are two ways to run it in CI. The first is the GitHub Action, which is
defined in `action.yml` at the root of the repository. The second is the
bundled script, `dist/regmark.mjs`, which any CI can run. Start with the
[local quickstart](quickstart.md) to review a report before adding a build gate.

[GitHub Action](#github-actions-with-the-action) · [Pull request comment](#posting-the-findings-on-the-pull-request) · [Agent surfaces](#checking-what-shopping-agents-are-told) · [Strict collection](#require-complete-collection) · [Inputs](#inputs) · [Outputs](#outputs) · [Other CI](#any-other-ci) · [Budgets](#adopting-it-on-a-shop-that-already-has-findings)

Run the audit after the staging or preview deployment is reachable. A
`pull_request` trigger by itself does not create or wait for that deployment;
connect this job to your deployment job with `needs`, or use your existing
deployment-completed workflow.

## GitHub Actions with the action

The action is listed on GitHub Marketplace as **Regmark ecommerce audit**. It
sets up Node 22 on the runner, runs `dist/regmark.mjs` from the same ref as the
action, writes the reports, adds the Markdown report to the job summary and
uploads every report as an artifact.

Which ref to use:

| Ref | Moves? | Use it when |
|---|---|---|
| `kairwang01/regmark@v0` | Follows the latest `0.x` release | You want fixes without editing the workflow |
| `kairwang01/regmark@v0.2.0` | Never | A build must not change under you |
| `kairwang01/regmark@<commit sha>` | Never | Your policy requires immutable action references |

Dependabot's `github-actions` ecosystem can keep a pinned tag or SHA current.

### A read-only audit of a staging shop

```yaml
name: Regmark

on:
  pull_request:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0
        with:
          store: https://staging.shop.example
```

This reads the shop and never writes to it. With no `platform` input the tool
works out what the shop runs on, reads its storefront API when it has one, and
reads the product pages.

### Adding the feed, its age, the checkout probe and the token

Replace the `with:` block with this one. The rest of the workflow is the same.

```yaml
      - uses: kairwang01/regmark@v0
        with:
          store: https://staging.shop.example
          feed: /feeds/google.xml
          max-age: feed=24h
          platform: woocommerce
          checkout: 'true'
          ship-to: US:94103
          ownership-token: ${{ secrets.REGMARK_OWNERSHIP_TOKEN }}
```

`max-age` turns on `availability.stale`: the feed fails the check when its own
timestamp is older than the age given. `checkout: 'true'` turns on the probe,
on WooCommerce or Shopify. The token must be the one the shop serves, as set
out in [Writes](configuration.md#writes). Store it as a secret.

When neither the environment nor the config supplies a valid ownership token,
the probe is skipped. In default mode the job can still pass if products were
read and rule budgets pass; the skip appears in JSON `issues`. Add
`strict: 'true'` when a skipped probe must fail the job.

The probe runs against the shop in `store`. Point it at a staging shop. See
[What to point it at](#what-to-point-it-at).

### Posting the findings on the pull request

```yaml
jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: kairwang01/regmark@v0
        with:
          store: https://staging.shop.example
          comment: 'true'
```

With `comment: 'true'` the Markdown report is posted as one comment on the
pull request and the same comment is updated on every later run, so a busy pull
request does not fill up with reports. The job needs `pull-requests: write`. A
pull request from a fork gets a read-only token; the comment is then skipped
and the audit's own result still decides the job.

### Checking what shopping agents are told

```yaml
      - uses: kairwang01/regmark@v0
        with:
          store: https://staging.shop.example
          acp-feed: /feeds/acp.json
          ucp: 'true'
          mcp: 'true'
          cloaking: 'true'
          ownership-token: ${{ secrets.REGMARK_OWNERSHIP_TOKEN }}
```

`acp-feed`, `ucp` and `mcp` read the surfaces an agent reads directly (the Y
plate): an Agentic Commerce Protocol product feed, the shop's Universal
Commerce Protocol catalogue and its storefront MCP server. They only read.
`cloaking` fetches each sampled page again as a browser and as a shopping agent
and reports a page that tells the two different prices or stock levels. It
poses as other clients, so like the checkout probe it runs only after the
ownership token is verified. See [Configuration](configuration.md) for the
details of each.

### Require complete collection

`strict: 'true'` (config `"strict": true`, flag `--strict`) makes any
collection issue fail the job. Enable it when a failed feed read, a skipped
checkout probe, a refused page or a cart cleanup failure should fail CI. The
reports are still written, with `ok: false`, and the exit code is `2` even
when every rule is within budget.

Strict means **zero collection issues**, including expected 404s from stale
feed entries; it has no issue-code allowlist. It does not expand the sample,
add unsupported collectors, or fail solely because a rule is skipped. The
misprinted fixture shop intentionally has a missing-product collection issue;
a strict audit of that fixture exits `2`, while the special `demo` command
keeps its demonstration behaviour.

### Uploading SARIF to code scanning

This is the complete workflow. It is also at
[examples/github-workflow.yml](../examples/github-workflow.yml), which can be
copied to `.github/workflows/regmark.yml`.

```yaml
name: Regmark

on:
  pull_request:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@v7

      - name: Audit the staging shop
        uses: kairwang01/regmark@v0
        with:
          store: https://staging.shop.example
          feed: /feeds/google.xml
          max-age: feed=24h
          platform: woocommerce
          checkout: 'true'
          ship-to: US:94103
          ownership-token: ${{ secrets.REGMARK_OWNERSHIP_TOKEN }}
          sample: '25'
          comment: 'true'

      - name: Upload SARIF to code scanning
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: regmark-report/regmark.sarif
```

The upload needs the `security-events: write` permission and code scanning
availability for the repository. Fork pull requests may not receive write
permissions or ownership secrets; keep a read-only audit/artifact path for
those runs, and run verified checkout checks in a trusted context.
`if: always()` runs the upload after the audit step, whether or not the audit
failed. The `actions/checkout` step is needed only when the `config` input
points at a file in the repository.

### Inputs

| Input | Required | Default | Meaning |
|---|---|---|---|
| `store` | yes | none | The shop to audit, such as `https://shop.example`. Use a staging or preview URL for pull requests. |
| `feed` | no | none | Feed URL in Google Merchant format, absolute or relative to the store. |
| `acp-feed` | no | none | Feed URL in Agentic Commerce Protocol format, absolute or relative to the store. Read as the `acp` surface. |
| `platform` | no | the config file's value, else `auto` | `woocommerce`, `shopify`, `auto` or `none`. |
| `ucp` | no | `'false'` | `'true'` reads the shop's UCP catalogue, discovered at `/.well-known/ucp`. |
| `mcp` | no | `'false'` | `'true'` reads the shop's storefront MCP server. |
| `checkout` | no | `'false'` | `'true'` runs the checkout probe (WooCommerce or Shopify). A `checkout` config object also enables it; false does not override the file. Verification needs a valid token. |
| `ship-to` | no | the config file's value, else `US` | Destination for the probe, as `CC` or `CC:postcode`. |
| `cloaking` | no | `'false'` | `'true'` fetches each sampled page again as a browser and as a shopping agent and compares what each is told. Needs a valid token. |
| `ownership-token` | no | none | The token served at `/.well-known/regmark.txt` on the shop, or published in DNS. Pass it from a secret. It is set in the `REGMARK_OWNERSHIP_TOKEN` variable for the run. |
| `pages` | no | none | Product page URLs to audit, one per line. Left empty, the sample comes from the platform, the sitemap or the feed. |
| `sample` | no | the config file's value, else `25` | How many products to audit. |
| `budget` | no | none | One `rule=number` per line. Spaces are removed. These are added to the config file's `budget`, and a line replaces the same rule from the file. |
| `max-age` | no | none | One `surface=age` per line, such as `feed=24h`. Turns on `availability.stale` for that surface. |
| `config` | no | none | A path to a config file in the repository. Check the repository out first. An input that is set replaces the same field in the file; an input left empty leaves the file's value alone. |
| `strict` | no | `'false'` | `'true'` makes any collection issue fail with exit 2. A true value in the config also enables it. |
| `comment` | no | `'false'` | `'true'` posts the Markdown report as one pull request comment, updated on every run. Needs `pull-requests: write`. |
| `github-token` | no | `github.token` | The token used for the comment. |
| `upload-report` | no | `'true'` | `'false'` skips the artifact upload. The reports are still written to `regmark-report/`. |
| `report-name` | no | `regmark-report` | The name of the uploaded artifact. Give each job its own name in a matrix. |
| `args` | no | none | Extra command-line arguments, split on whitespace and passed to the tool as written. |

### Outputs

| Output | Value |
|---|---|
| `ok` | `true` only when the CLI exits 0. `false` for over-budget, failed, empty or strict-incomplete audits. |
| `exit-code` | The CLI's exit code: `0`, `1` or `2`. See [Exit codes](configuration.md#exit-codes). |
| `findings` | The number of findings of every severity. Empty when no JSON report was written. |
| `errors` | The number of error-level findings. |
| `warnings` | The number of warn-level findings. |
| `products` | The number of products read and compared. |
| `report-dir` | `regmark-report`, the folder that holds every report. |
| `json`, `html`, `markdown`, `sarif` | The fixed path of each report, such as `regmark-report/regmark.sarif`. |

Outputs can drive later steps. The step must have an `id`, and the audit step
needs `continue-on-error: true` for a later step to see a failed audit:

```yaml
      - id: regmark
        uses: kairwang01/regmark@v0
        continue-on-error: true
        with:
          store: https://staging.shop.example
      - if: steps.regmark.outputs.errors != '0'
        run: echo "Regmark found ${{ steps.regmark.outputs.errors }} errors"
```

### What the action writes

- The reports, in a folder named `regmark-report`: `regmark.html`,
  `regmark.json`, `regmark.sarif` and `regmark.md`. Each is written only when
  the audit got far enough to write reports.
- The job summary. The contents of `regmark.md` are appended to the step
  summary when that file exists.
- With `comment: 'true'`, one pull request comment, created on the first run
  and updated afterwards. It is found again by a hidden marker at its start.
- An artifact, named by `report-name`, uploaded after every run unless
  `upload-report` is `'false'`. It holds the whole `regmark-report` folder. If
  nothing was written, the upload does not fail.
- The job's exit status. The step exits with the tool's exit code, so exit 1
  (over budget) and exit 2 (could not run, or read no product) both fail the
  job. A staging shop that is down fails the build; it does not pass it.

## Any other CI

The tool is a single file with no dependencies. It needs Node 22 or later.
Where npm is available, run a pinned version from the registry:

```bash
npx --yes regmark@0.2.0 audit https://staging.shop.example --feed /feeds/google.xml --junit regmark-junit.xml --json regmark.json
```

The same file is attached to every release as `regmark.mjs`, for a CI image
with Node and no package manager. Fetch the release you pin and run it:

```bash
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.2.0/regmark.mjs
node regmark.mjs audit https://staging.shop.example --feed /feeds/google.xml --junit regmark-junit.xml --json regmark.json
```

Each release also carries `regmark.mjs.sha256`. To check the download against
it, fetch both and run `sha256sum -c regmark.mjs.sha256`.

The exit codes are the same as for the command line: 0 within budget, 1 over
budget, 2 if the audit could not run, read no product, or (with `--strict`)
met any collection issue. See
[Exit codes](configuration.md#exit-codes).

Reports are written before the exit code is set. A run that exits 1 still leaves
its reports. A run that exits 2 may leave none.

### Choosing a report format

| Format | Flag | Use it for |
|---|---|---|
| JUnit XML | `--junit` | Test report views in GitLab and Jenkins. Each rule is one test case. A rule over budget is a failed case. A skipped rule is a skipped case. |
| SARIF 2.1.0 | `--sarif` | GitHub code scanning, through `github/codeql-action/upload-sarif`, or any SARIF viewer. |
| Markdown | `--markdown` | A pull request comment, or a job summary. Each flagged rule's findings are in a collapsed section, ten per rule by default. |
| HTML | `--html` | One file to keep as a build artifact and open in a browser. |
| JSON | `--json` | Scripts, dashboards, and the counts used for budgets. See [docs/report-format.md](report-format.md). |

### GitLab CI

This job is also at [examples/gitlab-ci.yml](../examples/gitlab-ci.yml). Set
`REGMARK_STORE` as a CI/CD variable, to the URL of the shop to audit.

```yaml
regmark:
  stage: test
  image: node:22
  variables:
    # The release to run. Pin it, so the tool does not change under a build.
    REGMARK_VERSION: v0.2.0
  script:
    - curl -fsSLO "https://github.com/kairwang01/regmark/releases/download/${REGMARK_VERSION}/regmark.mjs"
    - curl -fsSLO "https://github.com/kairwang01/regmark/releases/download/${REGMARK_VERSION}/regmark.mjs.sha256"
    - sha256sum -c regmark.mjs.sha256
    - node regmark.mjs audit "$REGMARK_STORE" --platform woocommerce --feed /feeds/google.xml --sample 25 --no-color --junit regmark-junit.xml --html regmark.html --json regmark.json
  artifacts:
    when: always
    paths:
      - regmark.html
      - regmark.json
    reports:
      junit: regmark-junit.xml
```

To run the checkout probe here, add `--checkout` to the command, and set
`REGMARK_OWNERSHIP_TOKEN` as a masked variable. Without a valid token from the
variable or config, the probe is skipped, and the skip is recorded in
`regmark.json`. Default mode permits a passing result with that issue;
`--strict` rejects it.

## Adopting it on a shop that already has findings

A shop with open findings should not start with budgets of zero, because the
build would fail on the first run. Start from the shop's current state.

1. Run the audit once, and read the counts. Each rule's count is the `findings`
   value in the `rules` array of the JSON report.
2. In `regmark.config.json`, set the budget of each rule that is over budget to
   its current count. Warn and info rules have no limit by default, so they need
   no entry.
3. Commit the file. The build passes within those counts and fails if a rule
   exceeds its budget. Review report differences too: a new finding can replace
   an old one without increasing the count.
4. Lower each number as its findings are fixed. With a lower number, any rise
   in the count fails the build.

The counts below come from a run against the bundled shop with defects, with
`--feed /feeds/google.xml`. The five rules shown are the error rules that had
findings in that run. Use the counts from your own run.

```json
{
  "store": "https://shop.example",
  "platform": "woocommerce",
  "feed": "/feeds/google.xml",
  "budget": {
    "price.mismatch": 3,
    "price.currency-ambiguous": 2,
    "availability.mismatch": 2,
    "variant.missing": 2,
    "content.instruction-like": 1
  }
}
```

## What to point it at

Point pull requests at a staging or preview deployment. The checkout probe
writes to the shop it is pointed at: for each sampled variant it puts one unit
in a cart, sets the destination address, reads the total and empties the cart.
Each of those is a write to the shop's session store, and a shop that reserves
stock for carts will hold that unit for a moment. On a staging copy that is
harmless. On production it is real, if small.

Run production on a schedule, without the probe. The storefront and page reads
do not write to the shop. Only the probe does:

```yaml
on:
  schedule:
    - cron: '0 6 * * *'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: kairwang01/regmark@v0
        with:
          store: https://shop.example
          feed: /feeds/google.xml
```

Prefer staging for routine automated probes. When the probe runs, it observes
the cart of the shop being audited. If staging differs from production, a
finding describes staging; keep the deployment and sample scope with the report.
