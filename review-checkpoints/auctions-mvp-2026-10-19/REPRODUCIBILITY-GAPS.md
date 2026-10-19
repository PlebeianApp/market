# Reproducibility gaps

The WIP evidence checkpoint is intentionally incomplete and is not a runnable distribution.

## Exact pinned bases not fully supplied

- Payment: `R4.3-POST-EDIT-SOURCE-MANIFEST.sha256`, file hash `25df4b28e5dccca910b8d82e95e60920b1fc5c29c083840dc975d7d6403b7a1c`, enumerates 934 paths. The frozen after archive contains 23 of those paths; the other 911 manifest paths have no supplied source archive.
- FIPS/UI TypeScript: `coco-v2-ui.baseline.sha256`, file hash `f778376b9500b0692a9798d4abc230b9d8961ddc5da48f98a518e01dde44fb96`, enumerates 201 paths. Eight corresponding UI paths are present in the R5 predecessor source subset; 193 baseline paths are absent.
- Auction consensus: `auction-consensus.baseline.sha256`, file hash `98acaea178cc28021879f8d4b244fc434565829a719fa4bcf81ce18627effce5`, enumerates 77 paths. Twenty paths are present in the R5 predecessor subset, two additional handoff files are newer than that baseline, and 57 baseline paths are absent.

Those manifests are exact path/hash indexes. No active tree may be used to fill their missing bytes.

## Direct missing TypeScript imports

```text
cashu-wrapper/ts/coco-rail.ts
cashu-wrapper/ts/demo-frost-participant-policy.ts
cashu-wrapper/ts/demo-maintainer-federation.ts
cashu-wrapper/ts/index.ts
cashu-wrapper/ts/lock-authority-store.ts
cashu-wrapper/ts/nut-client.ts
cashu-wrapper/ts/operation-store.ts
cashu-wrapper/ts/seed-store.ts
cashu-wrapper/ts/seller-child.ts
cashu-wrapper/ts/types.ts
market-app/plugins/demo-auth-bid-store.ts
market-app/plugins/wallet-plugin.ts
market-app/ts/demo-auth-bid.ts
market-app/ts/wallet-command.ts
```

Relevant absent build metadata includes `cashu-wrapper/ts/package.json`, `cashu-wrapper/ts/bun.lock`, `cashu-wrapper/ts/tsconfig.json`, `market-app/package.json`, `market-app/bun.lock`, `market-app/ts/package.json`, `market-app/ts/bun.lock`, and `market-app/ts/tsconfig.json`.

## Missing non-test Go build files from the pinned baseline

```text
cmd/auction-validator/main.go
internal/app/app.go
internal/app/context.go
internal/app/durable_store.go
internal/auction/automatic_close.go
internal/auction/canonical.go
internal/auction/decode.go
internal/auction/policy.go
internal/auction/proposal.go
internal/auction/scheduler.go
internal/auction/state.go
internal/auction/transition.go
internal/auction/types.go
internal/bidauth/command.go
internal/bidauth/doc.go
internal/bidauth/domain.go
internal/bidauth/errors.go
internal/bidauth/limits.go
internal/bidauth/nip01.go
internal/bidauth/types.go
internal/bidauth/verify.go
internal/bidauth/window.go
internal/demo/authenticated_runtime.go
internal/demo/identity.go
internal/demo/profile.go
internal/demo/runtime.go
```

`go.mod` and `go.sum` are also absent. The remaining absent baseline paths are tests, fixtures, examples, documentation, and validator entrypoint coverage identified exactly by the 77-path baseline manifest.

These are reproducibility and integration gaps, not reasons to hide the frozen WIP from maintainer review.

## Storage exclusion

Storage V2 source is not part of this package. M4 retained-history repair is ongoing; the last frozen blocked seal is referenced in `checkpoint-docs/PROVENANCE.md` and must not be substituted for a successor.
