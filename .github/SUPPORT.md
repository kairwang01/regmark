# Getting help

- **A first audit did not do what you expected.** Start with
  [Common problems](../docs/quickstart.md#common-problems) in the quickstart.
- **A finding is not true of your shop.** That is the most useful report this
  project can get. Open a [false alarm](https://github.com/kairwang01/regmark/issues/new?template=false-alarm.yml)
  issue with the rule id, both values and both locators from the report.
- **Two surfaces disagree and nothing was reported.** Open a
  [missed defect](https://github.com/kairwang01/regmark/issues/new?template=missed-defect.yml) issue.
- **Regmark crashed or hung.** Open a [bug](https://github.com/kairwang01/regmark/issues/new?template=bug.yml)
  issue with the command, the output of `--verbose` and `regmark --version`.
- **What a rule means.** [docs/rules.md](../docs/rules.md) defines every rule,
  including when it stays silent, and `regmark explain <rule>` prints the
  usual cause and fix.
- **A security problem.** Report it privately, as described in
  [SECURITY.md](../SECURITY.md). Do not open a public issue.
