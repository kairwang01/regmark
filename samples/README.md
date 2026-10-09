# Samples

Real output of the tool, run against the two fixture shops in this
repository with every surface enabled, including the checkout probe. The
shop's local address is presented as `demo-shop.example` by the demo command.
The files are generated directly from the current source; timestamps and run
duration naturally vary.

- `terminal-misprint.txt`, `report-misprint.html`: the shop with 27 seeded defects, which give 31 findings.
- `terminal-clean.txt`, `report-clean.html`: the same shop with none.

To get the same on your own machine, run `regmark demo` for the first pair and
`regmark demo --clean` for the second. To refresh all samples and screenshots,
follow the [capture recipe](../docs/demo.md).
