# Contributor snapshot provenance

Public parent: `a89e0783c2761883f95f6ada26b9f3fbf486d50c` on
`PlebeianApp/market`, `wip/auctions-mvp-checkpoint-2026-11-04`.

Candidate source: local commit `7204810ae920512afe1dff14ecd505f463f60ade`,
`recovery/r19-e2e-mvp`. Its recovery commits were `1f5a468` and `7204810`,
following the preserved R19 baseline `5d827b2`. Those local hashes are provenance
identifiers, not promises that the commits are reachable on GitHub.

This contributor branch deliberately does not attach that independent local
snapshot's history. It brings source changes onto the public parent for a
reviewable diff and records their origin here. Existing upstream history and
attribution are preserved. This is not a merge into the marketplace default
branch and not a claim that private work was reviewed upstream.

## Included and excluded

Included: candidate TypeScript/Go/UI sources and regression tests, the required
embedded browser bundle, nginx route deltas and recovery unit/verifier fixtures.
Legacy recipient-pending operation IDs are replaced with deterministic synthetic
fixture IDs; behavior and case coverage are retained. Exact source-file hashes are recorded in `SOURCE-MANIFEST.json`.

Excluded: new local baseline/live receipts, upgrade preflights and handoff plans,
intermediate release units/verifiers, runtime state and private history. The
tracked machine-specific `node_modules` symlink and obsolete generated
`dist/poc-coordinator.js` are removed. Public-parent-only source is retained,
including its Rust transcript verifier and vendored package source.

The embedded browser bundle is the intentional generated-file exception; it is
required by Go embedding and independently rebuild-checked. Vendored Coco tgz
archives are dependency inputs inherited unchanged, not newly built binaries.
The core pin is `60b7b070393eaad8746cb74a03c42017186da647`; the patched core and
SQLite adapter provenance is retained in `SOURCE-PROVENANCE.md` and vendor files.
No dependency or license claim is expanded by this branch.

## Publication review limits

Review covers the candidate delta, tracked-file inventory, common credential
patterns, archive members and generated bundle. Synthetic test keys are not
usable credentials and must never be reused. Existing public deployment
fixtures contain historical host/path identifiers; they are not generic setup
examples. Existing history is retained, not rewritten or certified secret-free.
No secret scanner can prove that all historical data is harmless.

Root-level operational documents and `PUBLICATION-MANIFEST.json` remain
historical records. They do not approve a new release or override the current
[acceptance status](STATUS.md). No PR, deployment or external maintainer
message is part of this publication.
