# Running Regmark in CI

There are two ways to run it in CI. The first is the GitHub Action, which is
defined in `action.yml` at the root of the repository. The second is the
bundled script, `dist/regmark.mjs`, which any CI can run.

## GitHub Actions with the action

The action sets up Node 22 on the runner, runs `dist/regmark.mjs` from the same
ref as the action, and writes the reports.

The examples pin the release tag `v0.1.0`, so the tool does not change under a
build. A commit SHA is a stricter pin, if your policy asks for one.

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
      - uses: kairwang01/regmark@v0.1.0
        with:
          store: https://staging.shop.example
```

This reads the shop and never writes to it. With no `platform` input the tool
works out what the shop runs on, reads its storefront API when it has one, and
reads the product pages.

### Adding the feed, the checkout probe and the token

Replace the `with:` block with this one. The rest of the workflow is the same.

```yaml
      - uses: kairwang01/regmark@v0.1.0
        with:
          store: https://staging.shop.example
          feed: /feeds/google.xml
          platform: woocommerce
          checkout: 'true'
          ship-to: US:94103
          ownership-token: ${{ secrets.REGMARK_OWNERSHIP_TOKEN }}
```

`checkout: 'true'` turns on the probe. The token must be the one the shop
serves, as set out in [Writes](configuration.md#writes). Store it as a secret.

When the token is empty, the probe is skipped. The job then passes unless a
rule is over budget, and the skip is recorded in the `issues` list of the JSON
report.

The probe runs against the shop in `store`. Point it at a staging shop. See
[What to point it at](#what-to-point-it-at).

### Uploading SARIF to code scanning

This is the complete workflow. It is also at
[examples/github-workflow.yml](../examples/github-workflow.yml), which can be
copied to `.github/workflows/regmark.yml`.

```yaml
# Copy this file to .github/workflows/regmark.yml in your repository.
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
      security-events: write
    steps:
      - uses: actions/checkout@v7

      - name: Audit the staging shop
        uses: kairwang01/regmark@v0.1.0
        with:
          store: https://staging.shop.example
          feed: /feeds/google.xml
          platform: woocommerce
          checkout: 'true'
          ship-to: US:94103
          ownership-token: ${{ secrets.REGMARK_OWNERSHIP_TOKEN }}
          sample: '25'

      - name: Upload SARIF to code scanning
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: regmark-report/regmark.sarif
```

The upload needs the `security-events: write` permission. `if: always()` runs
the upload after the audit step, whether or not the audit failed. The
`actions/checkout` step is needed only when the `config` input points at a file
in the repository. The example includes it, so that a `config` input can be
added without other changes.

### Inputs

Defaults are those in `action.yml`.

| Input | Required | Default | Meaning |
|---|---|---|---|
| `store` | yes | none | The shop to audit, such as `https://shop.example`. Use a staging or preview URL for pull requests. |
| `feed` | no | none | Feed URL in Google Merchant format, absolute or relative to the store. |
| `platform` | no | the config file's value, else `auto` | `woocommerce`, `shopify`, `auto` or `none`. |
| `checkout` | no | `'false'` | `'true'` runs the checkout probe. It needs `ownership-token`. |
| `ship-to` | no | the config file's value, else `US` | Destination for the probe, as `CC` or `CC:postcode`. |
| `ownership-token` | no | none | The token served at `/.well-known/regmark.txt` on the shop, or published in DNS. Pass it from a secret. It is set in the `REGMARK_OWNERSHIP_TOKEN` variable for the run. |
| `sample` | no | the config file's value, else `25` | How many products to audit. |
| `budget` | no | none | One `rule=number` per line. Spaces are removed. These are added to the config file's `budget`, and a line replaces the same rule from the file. |
| `config` | no | none | A path to a config file in the repository. Check the repository out first. An input that is set replaces the same field in the file; an input left empty leaves the file's value alone. |
| `report-name` | no | `regmark-report` | The name of the uploaded artifact. |
| `args` | no | none | Extra command-line arguments, split on whitespace and passed to the tool as written. |

### Outputs

| Output | Value |
|---|---|
| `ok` | `true` when every rule is within its budget. `false` otherwise, including when the audit could not run. |
| `sarif` | The fixed path `regmark-report/regmark.sarif`, for `github/codeql-action/upload-sarif`. |

### What the action writes

- The reports, in a folder named `regmark-report`: `regmark.html`,
  `regmark.json`, `regmark.sarif` and `regmark.md`. Each is written only when
  the audit got far enough to write reports.
- The job summary. The contents of `regmark.md` are appended to the step
  summary when that file exists.
- An artifact, named by `report-name`, uploaded after every run. It holds the
  whole `regmark-report` folder. If nothing was written, the upload does not
  fail.
- The job's exit status. The step exits with the tool's exit code, so exit 1
  (over budget) and exit 2 (could not run, or read no product) both fail the
  job. A staging shop that is down fails the build; it does not pass it.

## Any other CI

The tool is a single file with no dependencies, attached to every release as
`regmark.mjs`. It needs Node 22 or later. Fetch the release you pin and run it:

```bash
curl -fsSLO https://github.com/kairwang01/regmark/releases/download/v0.1.0/regmark.mjs
node regmark.mjs audit https://staging.shop.example --feed /feeds/google.xml --junit regmark-junit.xml --json regmark.json
```

Each release also carries `regmark.mjs.sha256`. To check the download against
it, fetch both and run `sha256sum -c regmark.mjs.sha256`.

The exit codes are the same as for the command line: 0 within budget, 1 over
budget, 2 if the audit could not run or read no product. See
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
    REGMARK_VERSION: v0.1.0
  script:
    - curl -fsSLO "https://github.com/kairwang01/regmark/releases/download/${REGMARK_VERSION}/regmark.mjs"
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
`REGMARK_OWNERSHIP_TOKEN` as a masked variable. Without the variable the probe
is skipped, and the skip is recorded in `regmark.json`.

## Adopting it on a shop that already has findings

A shop with open findings should not start with budgets of zero, because the
build would fail on the first run. Start from the shop's current state.

1. Run the audit once, and read the counts. Each rule's count is the `findings`
   value in the `rules` array of the JSON report.
2. In `regmark.config.json`, set the budget of each rule that is over budget to
   its current count. Warn and info rules have no limit by default, so they need
   no entry.
3. Commit the file. The build now passes for the shop as it is, and it fails on
   any new finding.
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
      - uses: kairwang01/regmark@v0.1.0
        with:
          store: https://shop.example
          feed: /feeds/google.xml
```

Run the probe only against staging. The audit compares each surface with the
checkout of the shop it reads. If staging is not the same as production, a
finding describes staging. Keep that in mind when a finding is read.
