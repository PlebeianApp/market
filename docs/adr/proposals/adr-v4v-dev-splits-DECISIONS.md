# ADR: V4V Dev Splits — LOCKED DECISIONS LOG

**Branch:** docs/adr-proposals-index
**Status:** In discussion — decisions being locked incrementally
**Last updated:** 2026-07-29

---

## RESOLVED DECISIONS (locked)

### D1. Reveal mechanism
The derivation path reveal is a **single public Nostr event**. One derivation path releases all payments simultaneously. Not a private message to the seller.

### D2. Settlement verification
At settlement time, validators check each mint for each note — verify funds are still valid AND point to the correct pubkey. Seller also confirms from their client.

### D3. Losing bidder refunds
When a losing bidder's secret is never revealed, their locked notes are **automatically refundable** after the settlement window ends. No active reclaim needed. No risk to their funds.

### D4. V4V and validator fee — unified structure
V4V splits and validator fees use the **same data structure**. Both are percentage splits to a destination npub. The only difference: validator fee is mandatory (floor), PM donation is optional (seller's discretion, can be zero).

### D5. Validator fee is mandatory for validity
If an auction doesn't meet a validator's minimum fee, the validator declines. An auction with zero validators is considered invalid from the client side. You CAN have validators without a PM donation.

### D6. Per-validator e-cash notes (no pool)
Each validator gets their own individual e-cash note at their announced fee. No "validator fee pool" concept. 99 validators at 1% each = 99 notes, 99%.

### D7. New Nostr kind: 30409 (Validator Fee Announcement)
- Parameterized replaceable (NIP-33 style, 3xxxx range)
- Sits next to kind 30408 (auction listing)
- Validator can update fee over time (latest event wins)
- **Fields:**
  - `d` tag: validator identifier
  - `fee_min_bps`: minimum fee in basis points (100 = 1%, 1 bps = 0.01%). Confirmed. Minimum non-zero fee = 1 bps.
  - `mint` tags (array): supported mint URLs
  - `auction_type` (optional): compatible auction formats (e.g., "english"). Validator announces compatibility — auction confirms match.
  - `locking_scheme` (optional): compatible key-locking schemes (e.g., "P2PK"). Validators announce which schemes they support.
  - `max_duration` (optional, default 30 days = 2592000 seconds): validator won't validate auctions longer than this. Default matches auction default of 30 days.
- **NO WOT/endorsement tags** on this kind. WOT is applied to bidders, not validators.

### D8. V4V params are per-auction
The split recipients and percentages are published as part of the auction event itself. PM npub is NOT hardcoded — it's the default/obvious case but configurable per listing.

### D9. Settlement window
Defined per-auction in the auction event. Happy path settlement is fast but the window gives time for mint-unreachable scenarios. If window expires → happy path invalid → fallback path (separate ADR).

### D10. Existing auction kinds (from AUCTIOINS.md)
- 30408: Auction Listing (addressable, updatable)
- 1023: Auction Bid Commitment (regular event)
- 1024: Auction Settlement (regular event)
- 16 types 1-4: order/payment/status/shipping
- 17: payment receipts

### D11. Mint consistency
Validators' supported mints should match the auction's announced mints. In practice, PM client hardcodes supported mints (including test mints in dev). Malicious bidder could fork client with different mint — validator checks and rejects non-matching bids.

### D12. E-cash notes locked to recipient pubkeys
Front-running is moot — only the rightful recipient (seller, PM, validator) can redeem, even though the secret is public.

### D13. WOT scope clarification
WOT applies to BIDDERS, not validators. Mechanism: a ContextVM service checks whether a bidder npub has been seen before / has reputation. Bidders without reputation may need proof-of-work or other rate-limiting. This is separate from the validator kind.

### D14. Branch strategy
All auction ADR work (bugs + ADRs) goes on a single branch: `docs/adr-proposals-index`. Bugs live in `docs/adr/proposals/bug-research-and-improvements/`.

### D15. Per-recipient mint (cross-mint bidding)
A bidder CAN lock notes on different mints for different recipients within the same bid. Example: seller's note on mint A, validator's fee on mint B. Each recipient redeems from their own mint. This adds codebase complexity but maximizes flexibility. Must be described clearly and concisely in the ADR.

---

## RESOLVED (previously open — all closed 2026-07-29)

~~O1. Same mint vs per-recipient mint~~ → **D15: Per-recipient mint allowed.**
~~O2. Optional fields on kind 30409~~ → **D7 updated: auction_type + locking_scheme kept, max_duration optional with 30-day default.**
~~O3. Fee unit~~ → **D7 updated: Basis points confirmed. 1 bps = 0.01%.**

---

## BUGS / IMPROVEMENTS (deferred, in bug-research-and-improvements/)
1. Validator parity / split-brain (even validator count)
2. Griefer / Sybil npub rotation
3. Bid bond anti-griefing (e-cash collateral)
4. npub rotation cost (Sybil resistance)
5. Top-bid oscillation (pre-existing)
6. Relay order / last-writer-wins (pre-existing)
