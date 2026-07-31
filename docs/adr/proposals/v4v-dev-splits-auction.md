# ADR: Value-for-Value Dev Splits for Plebeian Market Auctions

**Status:** Proposed
**Date:** 2026-07-29
**Branch:** docs/adr-proposals-index
**Depends on:** AUCTIOINS.md auction spec (kinds 30408/1023/1024)

## Context

Plebeian Market auctions use Cashu e-cash notes locked to recipient pubkeys. The winner reveals a derivation path (secret) that unlocks the payment to the seller. We want to extend this mechanism so that the same reveal simultaneously unlocks additional e-cash notes — for value-for-value (V4V) donations to the platform, and for validator fees — using the same locking mechanism.

Currently, auction payment uses a single locked note from bidder to seller. This ADR extends it to a multi-recipient settlement where one reveal triggers all payments atomically.

## Decision

### 1. Multi-recipient shared-secret unlock

When a bidder submits a bid (kind 1023), they lock MULTIPLE e-cash notes, one per recipient:

- **Seller note** (existing): the bid amount, locked to seller's pubkey
- **Validator note(s)** (mandatory): each assigned validator's fee, locked to that validator's pubkey
- **V4V donation note(s)** (optional): split amounts to any npub the seller specifies (e.g., Plebeian Market), locked to those npubs

All notes share the same derivation path. When the winner publishes the reveal (single public Nostr event), every note is simultaneously unlocked. Each recipient can only redeem their own note (locked to their pubkey). The secret being public does not create a front-running risk because e-cash notes are bound to recipient pubkeys.

### 2. V4V splits and validator fees share one data structure

Both are percentage splits to a destination npub, defined in the auction event (kind 30408). The only distinction:

- **Validator fee:** mandatory floor. If the auction doesn't meet a validator's announced minimum fee, that validator declines to validate. An auction with zero validators is considered invalid by clients.
- **V4V donation:** seller's discretion. Can be zero. Recipients and percentages are configurable per-listing.

Example auction V4V config:
```json
{
  "v4v_splits": [
    {"npub": "<seller-npub>", "bps": 9700},
    {"npub": "<validator-1-npub>", "bps": 100},
    {"npub": "<validator-2-npub>", "bps": 100},
    {"npub": "<plebeian-market-npub>", "bps": 100}
  ]
}
```
(Total = 10000 bps = 100%. Seller gets 97%, two validators get 1% each, PM gets 1%.)

### 3. Per-validator notes (no fee pool)

Each validator receives their own individual e-cash note at their announced fee. There is no "validator fee pool" that gets split. If 99 validators are assigned at 1% each, the bidder locks 99 separate notes totaling 99%.

### 4. New Nostr kind: 30409 (Validator Fee Announcement)

A parameterized replaceable event (NIP-33, 3xxxx range) that sits next to kind 30408 (auction listing). Validators publish this to announce their services, fees, and compatibility. Validators can update it over time (latest event wins).

**Fields:**

| Tag | Required | Description |
|-----|----------|-------------|
| `d` | Yes | Validator identifier (NIP-33 dedup key) |
| `fee_min_bps` | Yes | Minimum fee in basis points. 100 = 1%. 1 bps = 0.01%. Minimum non-zero fee is 1 bps. |
| `mint` | Yes (array) | Supported mint URLs. One tag per mint. |
| `auction_type` | No | Compatible auction formats (e.g., "english"). Auction must match for validator to accept. |
| `locking_scheme` | No | Compatible key-locking schemes (e.g., "P2PK"). Auction must match for validator to accept. |
| `max_duration` | No (default 30 days = 2592000s) | Validator will not validate auctions longer than this. |

**No WOT/endorsement tags** on this kind. WOT is applied to bidders separately (see section 9).

**Kind number rationale:** 30408 is the auction listing. 30409 is the validator who serves that listing. Grouped together in the 30xxx range for parameterized replaceable events.

### 5. Auction event references validators

The auction event (kind 30408) must:
- List assigned validator pubkeys
- Specify the fee allocated to each validator (snapshotted at auction creation from the validator's kind 30409 announcement)
- Each validator checks: "did this auction assign MY pubkey a fee that meets my minimum?" If yes → validates. If no → declines.

This snapshot prevents bait-and-switch: the validator cannot change its fee mid-auction, and the auction cannot reduce the fee below what was agreed at creation time.

### 6. Per-recipient mint (cross-mint bidding)

A bidder CAN lock notes on different mints for different recipients within the same bid. Example: seller's note locked on mint A, validator's fee locked on mint B.

- Each recipient redeems from their own mint
- The atomic guarantee applies to the unlock (all notes unlock simultaneously via the shared secret)
- Redemption happens asynchronously per-recipient after unlock
- This maximizes flexibility when validators and sellers use different mints
- **Implementation note:** This adds codebase complexity — the bid event must carry per-note mint references, and validators must verify notes across potentially multiple mints. This complexity must be handled explicitly in the implementation.

### 7. Settlement flow

1. **Auction creation:** Seller publishes kind 30408 with V4V splits, validator assignments, settlement window, supported mints.
2. **Validator discovery:** Validators see kind 30408, check if their pubkey + fee is assigned, check if mints/auction_type/locking_scheme match their kind 30409 announcement. If compatible → accept.
3. **Bidding:** Each bidder publishes kind 1023 with multiple locked notes (one per recipient). Each note locked to recipient pubkey, all sharing one derivation path.
4. **Auction end:** Highest bidder determined by validator ordering.
5. **Reveal:** Winner publishes a single public Nostr event with the derivation path. This unlocks all notes simultaneously.
6. **Verification:** Validators check each mint for each note — verify funds still valid AND point to correct pubkey. Seller confirms from their client.
7. **Redemption:** Each recipient (seller, validators, V4V recipients) redeems their note(s) from their respective mints.

### 8. Settlement window and refunds

- The settlement window is defined per-auction in the auction event (kind 30408).
- Happy-path settlement is fast, but the window gives time for mint-unreachable scenarios.
- If the window expires without successful settlement, the happy path is invalid and a fallback path applies (to be defined in a separate ADR).
- **Losing bidders:** Their secrets are never revealed. Their locked notes are automatically refundable after the settlement window ends. No active reclaim needed. No risk to their funds.

### 9. WOT and bidder reputation (out of scope for this ADR, noted for context)

WOT applies to BIDDERS, not validators. A ContextVM service checks whether a bidder npub has been seen before / has reputation. Bidders without reputation may need proof-of-work or other rate-limiting. This is tracked separately in `bug-research-and-improvements/`.

### 10. Security considerations

- **Front-running:** Not possible. E-cash notes are locked to recipient pubkeys. The secret being public doesn't let third parties redeem.
- **Winner redeeming others' notes:** The derivation path is public after reveal, but each note is locked to a specific recipient pubkey. Only that recipient can redeem.
- **Validator fee bait-and-switch:** Prevented by snapshotting fees in the auction event at creation time.
- **Malicious mint mismatch:** A bidder could fork the client to use a different mint. Validators check mint compatibility and reject non-matching bids.

## Consequences

**Positive:**
- Atomic multi-party settlement with one reveal event
- Clean fee discovery via validator competition (kind 30409)
- V4V donations are native, not bolted on
- Flexible cross-mint support

**Negative:**
- Per-recipient mint adds implementation complexity
- Bid events carry more data (multiple notes, multiple mint references)
- More mints = more failure points for atomic settlement

**Neutral:**
- Kind 30409 is a new application-specific kind (not a NIP)
- Validator participation is opt-in per auction

## References

- AUCTIOINS.md — auction spec draft (kinds 30408, 1023, 1024)
- `bug-research-and-improvements/` — 6 deferred investigation items
- RoboSats coordinator model — inspiration for validator fee competition
- NIP-33 — parameterized replaceable events
