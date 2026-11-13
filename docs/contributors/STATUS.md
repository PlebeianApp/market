# Current verification and acceptance

Recorded 2026-11-13. Public parent: `41c7098e13fb8854abf5e304653d91ca18e23d0b`.
Selected source snapshot: `574f90b45bfe0b193f0e87e9a0e1cdaddd77bb34`
(R86), tree `7c2ab1e793bea0f288cb8e087ad40135b4a5e95d`.

## Preparation checks

- Existing contributor checkout was clean before preparation: **passed**.
- Exact GitHub branch-tip observation: **passed** (read-only).
- Exact ngit branch-tip observation: **passed** (read-only).
- Source/public-parent/checkpoint history reconciliation: **passed**.
- High-confidence credential-pattern scan of the selected tracked tree: **no
  matches** for private-key blocks, nsec values, common GitHub/AWS/Slack token
  forms or Basic/Bearer credential literals.
- Sensitive filename and archive-member inventory: **reviewed**. Four tracked
  dependency tgz archives contained no secret-like member names. Source paths
  mentioning wallets, seeds and private keys are code/tests/verifiers, not a
  claim that their contents are harmless.
- Diff whitespace check: see the final preparation receipt before publication.

The scan is bounded and pattern-based. It is not a formal secret or license
audit, and it cannot certify earlier public history.

## Tests

Fresh isolated offline verification against this checkpoint completed with the
following results:

- Node UI: **8 passed, 0 failed**.
- `bun run typecheck:friday`: **passed**.
- Browser suite: **158 passed, 0 failed**.
- Full Friday suite: **2 pretests and 410 suite tests passed, 0 failed**.
- R20: **58 passed, 1 root-only skip, 0 failed**.
- DKG diagnostic: **73 passed, 0 failed**.
- Coco threshold: **19 passed, 0 failed**.
- V4 service: **94 passed, 0 failed**.
- Integration: **197 passed, 0 failed**.
- Browser bundle rebuild: **byte-identical**, 1,933,620 bytes, SHA-256
  `6fbcb16bc2c660ed5710a19aea8d52f820966013ed8d8fdde19500a1aac5f214`.
- Go tests/build: **blocked before execution**. Installed Go is 1.22.2 while
  `go.mod` requires 1.23.1; no download was allowed.
- Native Rust gate: **blocked before execution**. Rust/Cargo 1.86 is present,
  but the offline cache lacks exact dependency `fs2 0.4.3`.
- Live browser/payment acceptance: **not run**.

See `REPRODUCIBILITY-20261113.md` for the execution boundary and exact grouped
results.

Historical results in `TEST-REALITY-AND-PROVENANCE.md`, dated evidence and the
November 6 status document are tied to earlier commits. They must not be
reported as fresh results for this checkpoint.

## Not established

- That R86 is the exact release currently installed on every host.
- Fresh live one-seller/multi-bidder bid, refund, anti-sniping, close, payout,
  acknowledgement and conservation acceptance on this candidate.
- Inclusion or deployment of the separate R78 profile/demo candidate.
- Acceptance of the R87-R90 V3 recovery continuations.
- Production security, cryptographic audit, marketplace merge readiness or
  permission to publish.
- A project-license decision, complete third-party notice inventory or approval
  to publish current topology/operational fingerprints.
