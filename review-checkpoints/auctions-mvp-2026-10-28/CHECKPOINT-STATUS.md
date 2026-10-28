# Auctions MVP progress checkpoint

Date: 2026-10-28 UTC
Status time: 2026-10-28T14:30:00Z
Publication state: **DRAFT FOR MAINTAINER REVIEW — NOT PUBLISHED**

This is a progress checkpoint, not a release. It is fake-sat only, not safe for real funds, not production-ready, and not evidence that the full auction/payment journey works across four servers.

## Baseline

The last published `auctions-mvp` checkpoint is:

- commit: `6c022a72e07ae077a70a7e6945184410ff8a7d22`
- tree: `ab71296fb8953c2e6ed9ad884817c90c5f027671`
- committed: `2026-10-19T16:47:33Z`
- subject: `docs: add auctions MVP WIP review checkpoint`

That checkpoint published historical Payment R4.3 and FIPS/UI R5 Phase 1 evidence with independent `BLOCKED` outcomes. It had no accepted composed candidate and no successful full FIPS/payment end-to-end run.

No newer checkpoint has been published. Everything below is local, unpublished progress unless explicitly identified as the already deployed Wednesday prototype.

## Progress since the baseline

| Lane | Progress since 2026-10-19 | Evidence level | Current boundary |
|---|---|---|---|
| R20 composed source | A 26-file candidate now composes the Wednesday-style browser shell with the R20 threshold data layer, deterministic Comet close handling, 3-of-4 FROST/Coco authority and NIP-07-first identity handling. | Content-pinned local source plus focused tests and a separate non-builder review | Source-only. B1, B2, integrated FROST/Comet rehearsal and deployment are `NOT_RUN`. |
| Funding and recovery | Funding values are chosen once at genesis; pending operations retain their original policy identity; V2 records recompute the policy digest; ambiguous consensus outcomes remain retryable; refund and seller imports are idempotent. | Content-pinned local source and tests | Allowed funding boundary is `1 <= request <= advisory balance <= 50,000`. The browser balance cap is advisory. There is no runtime policy reconfiguration or server-side per-identity funding enforcement. |
| Automatic close | R20 close is deterministic, disabled by default, handles at most one auction per step, quarantines explicit permanent rejection and backs off on ambiguous outcomes. Deadline ordering is tested against the server consensus budget. | Content-pinned local source and focused Go/TypeScript tests | Generated-bundle execution and integrated runtime behavior are not proven. |
| Wednesday UI/funding candidate | A separate 13-path candidate adds the reviewed responsive UI, empty/error/unknown states and a recoverable variable fake-funding journal to the legacy Wednesday coordinator path. | Hash-checked uncommitted working tree, local test summary and local read-only preview | Not deployed and not the R20 architecture. It still uses the legacy shared coordinator if released. |
| Deployed Wednesday prototype | The public service remains the legacy shared-application-key, fixed-fake-sat prototype. Its deployed assets matched the older frozen baseline in a read-only check. | Deployed, read-only observation | Consensus is currently stalled/divergent; this is not evidence of a healthy four-validator system. |
| Historical R8 release candidate | An older offline build and regression receipt exists for source commit `0a6796dba29454b0f2657e932cd3a59a80df0943`. | Historical build receipt | It does not validate the changed R5/R20 source. Exact-current privileged integration, browser/Coco journey and deployment were `NOT_RUN`. |

## What the current R20 source implements

- Wednesday-style auction presentation over the R20 threshold state layer without the legacy browser-to-shared-coordinator custody route.
- NIP-07 preferred signing with an explicitly labelled tab-local disposable fallback.
- Browser-owned Coco keys and fake sats only.
- 3-of-4 FROST authorization, deterministic Comet auction state and the FIPS transport integration source needed by the target design.
- User-selected genesis funding within the reviewed bound, with exact integer checks and original-policy journaling.
- Idempotent outbid-refund and seller-payout import.
- Actor/deployment-scoped serialization for automatic and manual maintenance.
- Fail-closed close/retry behavior: explicit permanent rejection is quarantined; ambiguous outcomes remain retryable.

These are implementation and local-test claims, not deployment or runtime-health claims.

## Remaining pre-genesis policy finding

Genesis assembly currently constrains the two funding fields but must also reject changes to every non-funding policy field. Before any genesis is assembled, enforce:

- `FaucetAmount` and `FaucetCap` may differ from `DefaultPolicy()` only within `1 <= FaucetAmount <= FaucetCap <= 50,000`.
- Every other policy field must equal `DefaultPolicy()` exactly.

This closes a configuration surface that is broader than the reviewed funding decision. It does not add runtime reconfiguration, mint-wide enforcement or server-side per-identity enforcement.

## Test and evidence matrix

The exact-current R20 receipt was recorded at `2026-10-28T05:13:42Z`; it does not embed per-command start/finish times. The independent review file was recorded at `2026-10-28T05:16:56Z`. These times identify the evidence files, not a stronger claim about command timing.

| Scope | Result | What it establishes | What it does not establish |
|---|---|---|---|
| Node UI helpers | `PASS 7/7` | Pure UI helper behavior | Browser integration or live APIs |
| Friday TypeScript typecheck | `PASS` | Type consistency for the reviewed Friday target | Generated bundle execution |
| Friday browser tests | `PASS 72/72` | Browser-state, funding, recovery and composition behavior in the test harness | NIP-07 against a live browser or four-server flow |
| Friday R20 tests | `PASS 56`, `SKIP 1` root-only case | Reviewed R20 TypeScript behavior | The skipped privileged case or live transport |
| Focused verbose Go R20 tests | `PASS` | Funding policy, close trigger/deadline, threshold and recovery invariants in the selected Go scope | All Go packages or a deployed network |
| Deployment regression | `PASS 10/10` | Static deployment-template/runtime-target checks | Actual staging or service activation |
| B1 controller mocked/static tests | `PASS 17/17` | Bounds and fail-closed controller logic without bubblewrap, bundling or network | A B1 bundle run |
| Separate non-builder review | `ACCEPT_PREPARATION_ONLY_WITH_RUNTIME_GATES` | Manifest/diff/log consistency and selected independent reruns | Organizationally independent audit or runtime acceptance |
| Claude R5 review | Owner-supplied report says `ACCEPT_SOURCE_AND_B1_PREPARATION` on 2026-10-28 | Attributable external review over operator-supplied artifacts | Claude explicitly recomputed no hashes, ran no tests and touched no server; see the sanitized attestation |
| B1 browser bundle | `NOT_RUN` | Nothing runtime-derived | No bundle or candidate hash exists |
| B2 exact-current full offline build | `NOT_RUN` | Nothing runtime-derived | Historical R8 cannot substitute |
| Integrated FROST/Comet rehearsal | `NOT_RUN` | Nothing runtime-derived | No end-to-end threshold/consensus proof |
| Full four-server browser payment journey | `NOT_RUN` | Nothing runtime-derived | Funding, bid, outbid refund, close, payout and recovery are not verified together |

The separate Wednesday UI/funding candidate has a content manifest recorded at `2026-10-27T21:26:03Z`. Its 13 source paths still matched that manifest when checked on 2026-10-28. Its recorded local scope is:

- Bun: `25` passing tests (`17` funding-journal and `8` Coco-rail).
- Node UI: `12` passing tests.
- Go tests, JavaScript syntax checks, Python compile, coordinator transpile and `git diff --check`: `PASS`.
- Full TypeScript check: pre-existing unresolved sibling imports remained; no changed-file TypeScript errors were reported.

That candidate remains uncommitted and undeployed. Its preview blocks POST and injects no auction, balance, validator or settlement data.

## Deployed Wednesday runtime observation

Read-only evidence shows a connected but stalled/divergent network:

| Slot group | Observed | Peers | Last committed height | Consensus position | Last block time |
|---|---|---:|---:|---|---|
| V1 | 2026-10-28T13:52:07Z | 3 | 513632 | commit at 513632 | 2026-10-27T22:05:53Z |
| V3 and V4 | 2026-10-28T13:52:07Z | 3 each | 513632 | prevote at 513633 | 2026-10-27T22:05:53Z |
| V2 | 2026-10-28T13:59:27Z | 3 | 509020 | commit at 509020 | 2026-10-27T19:11:40Z |

All four services were observed running, but service state and peer count do not establish consensus health. V2 is far behind; V1/V3/V4 share the last committed block but are not advancing. No validator restart had occurred as of `2026-10-28T14:30:00Z`. Recovery procedure implementation and review are in progress elsewhere and are not claimed here.

## Current blockers

1. Enforce equality to `DefaultPolicy()` for every non-funding policy field and refreeze/retest the exact source.
2. Run B1 once against the exact accepted bytes and independently review its receipt and deterministic candidate hash.
3. Bind and run B2 against the reviewed B1 output; do not reuse the historical R8 build as evidence for R5.
4. Restore and verify advancing four-validator consensus without resets, key changes or chain-data loss; keep this separate from the checkpoint publication.
5. Complete an exact-current integrated FROST/Comet/Coco rehearsal.
6. Verify the complete fake-sat browser journey across four servers with distinct identities: funding, auction creation, bid, displacement, refund, close, seller payout and recovery disclosure.
7. Review staging, TLS/ingress, firewall and rollback evidence before any deployment claim.

## Next milestones

1. Close the non-funding policy finding and issue a successor manifest, test receipt and review.
2. Produce and review B1 output.
3. Produce and review B2 exact-current build output.
4. Verify validator recovery with fresh common-height and advancing-height evidence.
5. Rehearse the full fake-sat journey; keep real funds out of scope.
6. Prepare a separate publication commit only after maintainers approve the wording, evidence selection and redactions.

See [CLAUDE-REVIEW-ATTESTATION.md](CLAUDE-REVIEW-ATTESTATION.md), [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md), [REVIEW-QUESTIONS.md](REVIEW-QUESTIONS.md) and [PUBLICATION-PROPOSAL.md](PUBLICATION-PROPOSAL.md).
