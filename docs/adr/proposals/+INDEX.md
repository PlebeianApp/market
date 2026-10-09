# ADR Proposals Index

This index lists all Architecture Decision Records in `docs/adr/proposals/`.

## Accepted ADRs

| ADR                                              | Title                                                | Date       | Status   |
| ------------------------------------------------ | ---------------------------------------------------- | ---------- | -------- |
| [ADR-0001](adr-0001-auction-beta-tag.md)         | Auction Beta Tag as Global Feature Flag              | 2026-08-19 | Accepted |
| [ADR-0002](adr-0002-auction-whitelist-source.md) | Auction Creator Whitelist via Nostr Admin List Event | 2026-08-19 | Accepted |
| [ADR-0003](adr-0003-v4v-splits-on-30408.md)      | V4V Recipient Splits as Tags on Kind-30408           | 2026-08-19 | Accepted |
| [ADR-0005](adr-0005-whitelist-open-mode.md)      | Whitelist Empty-Mode Behavior — Open When Empty      | 2026-08-19 | Accepted |

## Proposed ADRs (Under Review)

| ADR | Title                                                                                          | Date       | Status   |
| --- | ---------------------------------------------------------------------------------------------- | ---------- | -------- |
| —   | [Auction Multiparty Payout Schedule Wire Profile](auction-multiparty-wire-profile.md)          | 2026-08-05 | Proposed |
| —   | [V4V UI Agnostic Audit and Plan](v4v-ui-agnostic-audit-and-plan.md)                            | 2026-07-30 | Proposed |
| —   | [Auction V4V Participation, Validator Gating, and the Leg Floor](auction-v4v-participation.md) | 2026-09-21 | Proposed |

## Notes

- ADR-0004 is intentionally skipped. Its scope (beta tag semantics) was folded into ADR-0001.
- ADR-0003 carries an amendment dated 2026-09-21: its intent stands, but its tag encoding is superseded for the multiparty profile by the canonical payout schedule on the root. The `v4v_recipient` tag survives only as a non-authoritative display mirror.
- ADRs follow the standard structure: Title, Status, Date, Context, Decision, Consequences, Alternatives Considered, Files Affected.
