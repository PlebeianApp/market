# ADR Index

> **This file is the single source of truth for ADR numbering.** Any PR that adds, renumbers, or changes the status of an ADR **must** update this file in the same PR. A CI check validates that every ADR file in `docs/adr/` has a corresponding entry here and that no two entries share a number.

## How to add a new ADR

1. **Check this index** for the next available number. Do not assume the next number is free — look at the table below.
2. **Add your entry to this file** in the same PR that adds your ADR. Include: number, title, status, and the branch/PR it lives on.
3. **If your ADR is in a feature branch** (not yet merged), set its status to `Proposed` and list the branch name. When it merges to `master`, update the status to `Accepted`.
4. **Never reuse a number.** If an ADR is superseded, mark it `Superseded by ADR-XXXX` and create a new ADR with a new number.
5. **Use single-digit numbers (0001–0012) for new ADRs.** Numbers 0013–0016 are held by the existing NIP-17 / NDK legacy cluster on `master` — do not add new ADRs in that range. Only fall back to 0017+ once the single-digit range is exhausted.

## ADR Registry

| Number       | Title                                                                   | Status   | File                                                                | Notes                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001         | Hierarchical AGENTS.md as Living Operational Guidance                   | Accepted | `ADR-0001-hierarchical-agents-md-and-adr-docs.md`                   |                                                                                                                                                         |
| 0002         | NDK → Applesauce Nostr I/O Migration                                    | Accepted | `ADR-0002-nostr-io-migration-ndk-to-applesauce.md`                  |                                                                                                                                                         |
| 0003         | Comprehensive Validation Protocol for Nostr Auctions and Settlement     | Proposed | `ADR-0003-auctions-comprehensive-validation-protocol.md`            | PR #1138 (auctions), also in PR #1144 (settlement-steps, amended). Same ADR — #1144 stacks on #1138.                                                    |
| 0004         | Unified Auction Settlement Descriptor with Participant-Role Enumeration | Proposed | `ADR-0004-auction-settlement-descriptor.md`                         | PR #1144 (settlement-steps). **Conflict: PR #1230 (direct-lightning-bid-funding) also claims 0004 — needs renumbering to 0008.**                        |
| 0005         | No External Service Dependencies in Tests                               | Proposed | `ADR-0005-no-external-service-dependencies-in-tests.md`             | PR #1209 (adr/test-isolation).                                                                                                                          |
| 0006         | Nostr-Native Page Building System (Plebeian Market CMS)                 | Proposed | `ADR-0006-cms-and-nostr-native-page-building.md`                    | PR #1213 (this PR). Was ADR-0004 — renumbered to avoid collision.                                                                                       |
| 0007         | Component UI Migration & Widget Book                                    | Proposed | `ADR-0007-component-ui-migration-and-widget-book.md`                | Merged on `master` via #1212. This PR (#1213) amends it — adds Part 3 (CMS coherence).                                                                  |
| 0013         | NIP-17 Order Message Transport                                          | Proposed | `ADR-013-nip17-order-message-transport.md`                          | On `master`. Legacy cluster (0013–0016) — reserved, no new ADRs in this range.                                                                          |
| 0014         | NIP-17 Order Transport Migration and Cutover Criteria                   | Proposed | `ADR-014-nip17-order-transport-migration.md`                        | On `master`. Legacy cluster (0013–0016) — reserved, no new ADRs in this range.                                                                          |
| 0015         | Production-safe NDK Filter Handling and Stable Kind-0 Profile Fetching  | Accepted | `ADR-015-production-safe-ndk-filters-and-stable-kind-0-fetching.md` | PR #1207 (fix/ai-guardrails-profile-unload). **Was also claimed by PR #1174 (staging-relay-recovery, CLOSED) — that ADR needs renumbering if revived.** |
| 0016         | Zap NDK External Relay Isolation                                        | Accepted | `ADR-016-zap-ndk-external-relay-isolation.md`                       | PR #1211. Legacy cluster (0013–0016) — reserved. **Conflict: PR #1215 (product-orthogonal-dimensions) also claims 0016 — needs renumbering to 0009.**   |
| (unnumbered) | Add Product Workflow Boundaries                                         | Accepted | `ADR-add-product-workflow-boundaries.md`                            | Predates the numbering system.                                                                                                                          |

## Pending Number Assignments

The following unnumbered ADRs need permanent numbers. Assign them single-digit numbers from the available range (see below), after the open conflicts are resolved:

| Branch                             | Current file                                              | Notes                                   |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| `adr/v2-merge-deployment-strategy` | `ADR-v2-merge-deployment-strategy.md`                     | Needs a single-digit number (0010+).    |
| `adr/currency-conversion-fallback` | `ADR-TBD-currency-conversion-service-architecture-....md` | Uses "TBD" placeholder. Needs a number. |

## Numbering Gaps

- **0008–0012** are the recommended single-digit range for new ADRs.
  - **0008** is proposed to resolve the #1230 conflict (lightning-bid-funding, currently 0004).
  - **0009** is proposed to resolve the #1215 conflict (product-orthogonal-dimensions, currently 0016).
- **0013–0016** are held by the existing NIP-17 / NDK legacy cluster on `master`. Do not add new ADRs here.
- **0017+** are available only once the single-digit range is exhausted.

## Conflict History

- **ADR-0004 collision (open):** Three PRs originally claimed 0004: #1144 (settlement-steps), #1198 (CMS), and #1205/#1230 (lightning-bid-funding). CMS was renumbered to 0006. Lightning-bid-funding (#1230) **still** claims 0004 — needs renumbering to 0008.
- **ADR-0005 collision (resolved 2026-08-03):** PR #1209 (test-isolation) and the UI migration ADR both claimed 0005. Resolved: test-isolation keeps 0005, UI migration → 0007.
- **ADR-015 collision (resolved):** PR #1207 (production-safe NDK filters, Accepted) vs PR #1174 (staging-relay-recovery, CLOSED). The closed PR's ADR was never merged. If revived, it needs a new number.
- **ADR-016 collision (open):** Master's ADR-016 (Zap NDK isolation, PR #1211, Accepted) vs PR #1215 (product-orthogonal-dimensions). #1215 needs renumbering to 0009.
