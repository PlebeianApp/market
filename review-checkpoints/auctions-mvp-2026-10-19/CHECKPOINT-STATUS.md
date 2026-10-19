# Auctions MVP WIP review checkpoint

Date: 2026-10-19 UTC

This directory publishes frozen development progress for maintainer review. It is not an integrated source tree, not a self-contained runnable distribution, not demo-ready, not safe for real funds, and not production-safe.

Payment R4.3 and FIPS/UI R5 Phase 1 are frozen historical WIP with independent `BLOCKED` review outcomes. Their active repair worktrees are excluded. Storage V2 M4 retained-history work is ongoing and its source is absent. There has been no successful full FIPS/payment end-to-end run.

The `base`, `delta`, and `patches` directories are review evidence kept separate from repository source roots. Do not treat them as accepted implementation or apply them without verifying their pinned hashes and statuses.

## Checksum roots

- Validate `PUBLICATION-MATERIAL.sha256` from this package root.
- Validate `checkpoint-docs/CHECKPOINT-DOCS.sha256` from `checkpoint-docs/`.
- Validate the Payment predecessor manifest from `source-review/payment-r4.3-blocked/base/`.
- Validate the Payment post-allowlist manifest only against a temporary base-plus-delta reconstruction; no reconstructed tree belongs in this package.
- The full Payment post-edit and FIPS baseline manifests are provenance indexes for disclosed missing closure. Their file identities are pinned, but their absent entries cannot be package-local validation targets.
- Evidence seal files retain their original lane-relative roots and are verified against the immutable evidence directories during staging.
