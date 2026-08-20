# ADR Proposals Index

This directory contains proposed (not yet accepted) Architecture Decision
Records for the Plebeian Market project. Accepted ADRs live in the parent
`docs/adr/` directory and use `ADR-NNNN` numbering.

Proposal files use descriptive names WITHOUT numbers — the numeric namespace
is reserved for accepted ADRs, so proposals never collide with (or imply a
position in) the accepted numbering sequence.

## Auction Feature Proposals

| File                 | Title                     | Status   |
| -------------------- | ------------------------- | -------- |
| auction-beta-tag.md  | Auction Beta Tag          | Proposed |
| auction-whitelist.md | Auction Publish Whitelist | Proposed |

## Other Proposals

| File                               | Title                                           | Status   |
| ---------------------------------- | ----------------------------------------------- | -------- |
| auction-multiparty-wire-profile.md | Auction Multiparty Payout Schedule Wire Profile | Proposed |
| v4v-ui-agnostic-audit-and-plan.md  | V4V UI-Agnostic Audit and Plan                  | Proposed |

## Consolidation notes (2026-08-20)

Per review feedback on the auction e2e/specs PR:

- `auction-beta-tag.md` supersedes former `adr-0001-auction-beta-tag.md`
  (duplicate `## Status` section removed; restructured to the proposal
  template; unnumbered per the scheme above).
- `auction-whitelist.md` merges and supersedes former
  `adr-0002-auction-whitelist-source.md` and `adr-0005-whitelist-open-mode.md`
  — both covered one configuration surface (source of truth + default open
  mode) and are stronger as a single decision record. The `open'` typo and
  duplicate `## Status` sections are gone with them.
- Former `adr-0003-v4v-splits-on-30408.md` was withdrawn: it duplicated the
  separate V4V work (which owns the value-4-value split specification) and
  specified a tag format (`zapSplit`) that this codebase never implemented
  for kind-30408. The authoritative V4V split spec belongs to that effort;
  see `v4v-ui-agnostic-audit-and-plan.md` for the audit baseline.
