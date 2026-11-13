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

Fresh source tests are intentionally separated from this documentation and
publication-preparation pass. Record exact commands and results here before
publication. Until then:

- `node --test internal/poc/catalogue_ui.test.js`: **passed** (1 test, 0 failed,
  Node reported 116.65 ms total duration).
- `go test ./internal/poc`: **blocked before tests**. The installed Go is
  1.22.2 while `go.mod` requires Go 1.23.1; no toolchain download was allowed.
- `go test ./...`: **not run** after the focused Go gate was blocked.
- `bun run typecheck:friday`: **not run**; this isolated checkout has no
  `cashu-wrapper/ts/node_modules`, and dependency installation was outside this
  bounded preparation pass.
- `bun run test:friday:browser`: **not run** for the same dependency reason.
- `bun run test:friday`: **not run** for the same dependency reason.
- Rust participant tests: **not run**; Cargo/Rust were not available on PATH.
- Live browser/payment acceptance: **not run**.

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
