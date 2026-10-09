# Security policy

## What counts

Report these privately:

- A way for a hostile shop being audited to affect the machine or the network
  that runs Regmark. This includes getting past the address guard in
  `packages/core/src/net/guard.ts`, getting past the redirect or size limits in
  `packages/core/src/net/fetcher.ts`, and making the tool contact a host it was
  not given.
- A way to reach the checkout probe without verifying that you control the shop.
  See `packages/core/src/ownership.ts`.
- A way to make the checkout probe leave a cart with items in it, or to reach a
  payment step.
- Text from a shop that reaches a report without being escaped. That covers the
  HTML, Markdown, SARIF, JUnit and JSON reports and the terminal output, including
  terminal escape sequences.

## How to report

Use GitHub's private vulnerability reporting. Open the repository's **Security**
tab and choose **Report a vulnerability**, or use the form directly at
https://github.com/kairwang01/regmark/security/advisories/new.

Do not open a public issue or a public pull request for a vulnerability.

## What to include

- The version (`node packages/cli/src/bin.ts --version`), the command you ran,
  and the shop it ran against.
- What happened, what you expected, and the smallest reproduction you can make.
  The fixture shop is a good target: `node fixtures/shop/src/serve.ts --mode
  misprint --port 4010`. It listens on 127.0.0.1, so audit it with
  `--allow-private-network`.

## What is not a vulnerability here

A wrong finding (a false alarm) and an unreported disagreement (a missed defect)
are ordinary issues. Use the **False alarm** or **Missed defect** template.
Findings about a shop's own data, such as wrong prices or stale feeds, are what
the tool is for. The shop's data is a problem only when it reaches a report or a
terminal unescaped.

## Supported versions

Regmark is pre-1.0. Only the latest release receives security fixes.
