# ADR Index

> **This file is the single source of truth for ADR numbering.** Any PR that adds, renumbers, or changes the status of an ADR **must** update this file in the same PR. A CI check validates that every ADR file in `docs/adr/` has a corresponding entry here and that no two entries share a number.

## How to add a new ADR

1. **Check this index** for the next available number. Do not assume the next number is free — look at the table below.
2. **Add your entry to this file** in the same PR that adds your ADR. Include: number, title, status, and the branch/PR it lives on.
3. **If your ADR is in a feature branch** (not yet merged), set its status to `Proposed` and list the branch name. When it merges to `master`, update the status to `Accepted`.
4. **Never reuse a number.** If an ADR is superseded, mark it `Superseded by ADR-XXXX` and create a new ADR with a new number.

## ADR Registry

| Number | Title | Status | File | Notes |
|--------|-------|--------|------|-------|
| 0001 | Hierarchical AGENTS.md as Living Operational Guidance | Accepted | `ADR-0001-hierarchical-agents-md-and-adr-docs.md` | |
| 0002 | NDK → Applesauce Nostr I/O Migration | Accepted | `ADR-0002-nostr-io-migration-ndk-to-applesauce.md` | |
| 0003 | Comprehensive Validation Protocol for Nostr Auctions and Settlement | Proposed | `ADR-0003-auctions-comprehensive-validation-protocol.md` | PR #1138 (auctions), also in PR #1144 (settlement-steps). **Number conflict with PR #1205 (direct-lightning-bid-funding) — needs resolution.** |
| 0004 | Unified Auction Settlement Descriptor with Participant-Role Enumeration | Proposed | `ADR-0004-auction-settlement-descriptor.md` | PR #1144 (settlement-steps). **Was also claimed by PR #1198 (CMS) and PR #1205 (lightning-bid-funding) — those have been renumbered.** |
| 0005 | No External Service Dependencies in Tests | Proposed | `ADR-0005-no-external-service-dependencies-in-tests.md` | PR #1209 (adr/test-isolation) |
| 0006 | Nostr-Native Page Building System (Plebeian Market CMS) | Proposed | `ADR-0006-cms-and-nostr-native-page-building.md` | PR #1198 (adr/cms-page-building). Was ADR-0004 — renumbered to avoid collision. |
| 0007 | Component/UI Migration & Widget Book | Proposed | `ADR-0007-component-ui-migration-and-widget-book.md` | PR #1193 (adr/ui-components-migration). This file in our PR is the existing PR #1193 ADR content + CMS coherence amendments (Part 3). The existing PR #1193 ADR is unnumbered (`ADR-component-ui-migration-and-widget-book.md`) and uses `.theme-new` scoped theme approach. Our amendment adds Part 3 (CMS coherence) on top of the existing content. |
| 0015 | Production-safe NDK Filter Handling and Stable Kind-0 Profile Fetching | Accepted | `ADR-015-production-safe-ndk-filters-and-stable-kind-0-fetching.md` | PR #1207 (fix/ai-guardrails-profile-unload). **Was also claimed by PR #1174 (staging-relay-recovery, CLOSED) — that ADR needs renumbering if revived.** |
| (unnumbered) | Add Product Workflow Boundaries | Accepted | `ADR-add-product-workflow-boundaries.md` | Predates the numbering system. |
| (unnumbered) | V2 Merge Deployment Strategy | Proposed | `ADR-v2-merge-deployment-strategy.md` | Branch `adr/v2-merge-deployment-strategy`. Needs a number. |
| (unnumbered) | Currency Conversion Service Architecture and Fallback Reliability | Proposed | `ADR-TBD-currency-conversion-service-architecture-and-fallback-reliability.md` | Branch `adr/currency-conversion-fallback`. Uses "TBD" placeholder. |

## Pending Number Assignments

The following ADRs need permanent numbers assigned when their PRs are ready to merge:

| Branch | PR | Current file | Proposed number |
|--------|-----|-------------|-----------------|
| `adr/v2-merge-deployment-strategy` | — | `ADR-v2-merge-deployment-strategy.md` | 0008 |
| `adr/currency-conversion-fallback` | — | `ADR-TBD-currency-conversion-...md` | 0009 |

## Numbering Gaps

Numbers 0008–0014 and 0016+ are available. The gap between 0007 and 0015 is intentional — ADRs 0008–014 were reserved by convention for the auctions/NIP-17 cluster (0003–014 form a related batch), but only 0013 and 0014 were used. The remaining gap is available for new ADRs.

## Conflict History

- **ADR-0004 collision (resolved 2026-08-03):** Three PRs (#1198 CMS, #1205 lightning-bid-funding, #1144 settlement-steps) all claimed 0004. Resolved: settlement-steps keeps 0004, CMS → 0006, lightning-bid-funding → 0003 (pending — 0003 currently held by auctions-validation).
- **ADR-0005 collision (resolved 2026-08-03):** Two sources (PR #1209 test-isolation, our UI migration ADR) claimed 0005. Resolved: test-isolation keeps 0005, UI migration → 0007.
- **ADR-015 collision (partially resolved):** PR #1207 (production-safe NDK filters, Accepted) vs PR #1174 (staging relay recovery, CLOSED). The closed PR's ADR was never merged. If revived, it needs a new number.