# Plebeian Auctions MVP

Experimental, fake-sats auctions: Nostr identities, browser-owned Coco wallets,
four-validator CometBFT ordering, 3-of-4 FROST monetary authorization and
jmcorgan/fips transport. One operator controls the deployment. This is not a
production release and fake sats have no redeemable value.

## Start here

- [Contributor setup](CONTRIBUTING.md)
- [Contributor guide and module map](docs/contributors/MAINTAINER-GUIDE.md)
- [Architecture and trust boundaries](docs/contributors/ARCHITECTURE.md)
- [Current verification status](docs/contributors/STATUS.md)
- [Checkpoint and publication gates](docs/contributors/CHECKPOINT-20261113.md)
- [Publication/push plan](docs/contributors/PUSH-PLAN-20261113.md)
- [Checkpoint provenance](docs/contributors/PROVENANCE.md)
- [Source reconciliation](docs/contributors/PUBLICATION-RECONCILIATION-20261113.md)
- [Reproducibility results](docs/contributors/REPRODUCIBILITY-20261113.md)
- [Publication audit and blockers](docs/contributors/PUBLICATION-AUDIT-20261113.md)
- [Agent instructions](AGENTS.md)
- [Historical integration provenance](SOURCE-PROVENANCE.md)
- [Historical test reality and provenance](TEST-REALITY-AND-PROVENANCE.md)

This checkpoint prepares the selected R86 source snapshot for review; it is not
a claim that the snapshot is currently deployed or that all live payment paths
passed. Deployment and final payment evidence remain separate release gates.
Historical root receipts describe earlier candidates and are not current run
instructions. The previous README is preserved in
[the historical appendix](docs/contributors/LEGACY-README-20261112.md).

## License and notices

Original Plebeian Auctions code is licensed under
[GPL-3.0-only](LICENSE). Plebeian Auctions is a Plebeian Apps project;
contributors retain their respective copyright unless otherwise agreed.
Third-party components remain under their respective terms. See
[COPYRIGHT](COPYRIGHT), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[source provenance](SOURCE-PROVENANCE.md). The sanitized exact dependency
evidence is in
[third_party/DEPENDENCY-LICENSE-INVENTORY.json](third_party/DEPENDENCY-LICENSE-INVENTORY.json).

Run `sh scripts/check-publication-notices.sh` to verify the bounded license,
notice and directly redistributed archive hashes. This does not replace the
final SBOM/license review.

## Local verification

Install Bun and Go compatible with `cashu-wrapper/ts/package.json` and `go.mod`.
Install pinned dependencies with `bun install --frozen-lockfile` inside
`cashu-wrapper/ts`. Vendored Coco packages are required; do not replace them with
registry packages silently.

```sh
go test ./...
node --test internal/poc/catalogue_ui.test.js
cd cashu-wrapper/ts
bun run typecheck:friday
bun run test:friday:browser
bun run test:friday
```

These checks are local tests, not live settlement certification. Do not run
live test scripts or start a coordinator against shared infrastructure without
an explicit deployment/test assignment.
