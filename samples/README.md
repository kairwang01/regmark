# Samples

Real output of the tool, run against the two fixture shops in this
repository with every surface enabled, including the checkout probe. The
shop's local address has been replaced with `shop.example`; nothing else was
edited.

- `terminal-misprint.txt`, `report-misprint.html`: the shop with 19 seeded defects.
- `terminal-clean.txt`, `report-clean.html`: the same shop with none.

To get the same on your own machine, run `regmark demo` for the first pair and
`regmark demo --clean` for the second. The demo calls the shop
`demo-shop.example`; nothing else differs.
