# Contributor snapshot provenance

## Public lineage

The prepared branch starts at the already published contributor checkpoint
`41c7098e13fb8854abf5e304653d91ca18e23d0b` on
`PlebeianApp/market`, branch `contrib/auctions-mvp-recovery-2026-11-06`.
Its public parent and authorship remain intact.

## Selected source

The source overlay is the exact tree of local commit
`574f90b45bfe0b193f0e87e9a0e1cdaddd77bb34`, branch
`codex/r86-terminal-fastpath`, tree
`7c2ab1e793bea0f288cb8e087ad40135b4a5e95d`. This source line descends from
the R77 Catalogue/Chief Design A integration and includes later payment,
terminal, readiness and recovery corrections through R86.

The local and public histories do not share a merge base because the earlier
publication intentionally imported a sanitized source snapshot. This checkpoint
therefore repeats that reviewable source-overlay model rather than manufacturing
a merge or publishing local operational history.

## Deliberate exclusions

- `9ed795b1810a63d735d6c96cc23e2164f63c8dd3` (R78 profile/demo UI), which is
  a separate candidate based on R77 and has not been reconciled with R86.
- R87-R90 V3 signer/FIPS recovery continuations, which contain active
  operational recovery tooling and require a separate publication review.
- Runtime databases, journals, browser storage, wallet proofs, private keys,
  signer shares, credentials, raw operational logs and untracked dependencies.

The selected R86 tree does contain historical public fixtures, deployment
templates and evidence files. Their inclusion is visible in the outgoing diff;
it does not make them current run instructions or live acceptance evidence.
Three public-parent-only source files are retained deliberately: the Rust public
admission transcript verifier and the vendored SQLite adapter's generated
`dist/index.js` and `dist/index.d.ts`. Removing them is not required by R86 and
would make the contributor snapshot less complete.

## Generated and vendored material

`internal/poc/static/friday-browser.js` is an intentionally tracked generated
browser bundle. Publication review must compare it with a fresh build from the
selected source. The tracked Coco tgz files are pinned dependency inputs; their
archive members were inventoried during preparation, but licenses and full
contents still require maintainer review.

## Deployment relationship

Conversation and recovery records identify R86 as the latest selected
application-source release, but this preparation did not read every host or
prove the exact installed release. Deployment evidence remains a separate gate.
