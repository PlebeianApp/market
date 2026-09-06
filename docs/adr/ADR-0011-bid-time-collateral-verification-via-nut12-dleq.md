# ADR-0011: Bid-time collateral verification via NUT-12 DLEQ proofs

## Status

Proposed

## Date

2026-09-06

## Context

The kind-1023 bid commitment under `cashu_p2pk_bidder_path_v1` publishes `lock_secret`
(the NUT-10/11 P2PK lock script) and `proof_y` (for NUT-7 state checks), but not the proof's
`amount`, `C` (mint signature), or keyset id. The `amount` tag is therefore self-declared.
This is the known gap documented in AUCTIONS.md §9.1.1 and ADR-0004 "Known limitations",
reconfirmed in review of #1259.

What verification is possible under the current protocol:

- **Spend state, not value.** NUT-7 (`POST /v1/checkstate`) returns
  `{states: [{Y, state, witness}]}` — spend state only. No mint endpoint reports an unspent
  secret's denomination, and the mint cannot: at issuance it sees only the blinded
  `B_ = Y + r·G`, so its issuance records cannot be linked to `Y` (the reference nutshell
  mint records `Y` only at redemption). The amount binds exactly when the mint redeems, via
  per-amount keys (`C == a_amount · hash_to_curve(secret)`).
- **No existence proof either.** NUT-7 returns `UNSPENT` for any `Y` it has never seen,
  including secrets never minted anywhere. A fabricated but structurally valid `lock_secret`
  passes all current bid-time checks. §9.1.1 frames the attacker as locking "real funds (even
  if tiny)"; in fact the fake-bid vector costs zero sats and zero mint interaction.
- **What does hold.** The P2PK lock genuinely escrows the bidder's liquidity — tokens
  cannot move before `T_unlock` without the seller child private key (swap and melt both
  require the lock witness), and the true amount is confronted at settlement preflight
  (`preflightAuctionSettlementP2pkChain`).

Per ADR-0004's amendment, validator verdicts (kind-30440) assert structure, rules, and
policy; NUT-7 ownership moved to the client. Consequently no participant — bidder, seller,
validator, or client — can verify the monetary amount behind a live bid. This is a griefing
vector (fake price inflation, winner selection, min-bid floor), not a theft vector.

NUT-12 (DLEQ proofs) is the only specified mechanism for third-party verification of a
proof without spending it: the proof carries `dleq {e, s}` plus the holder's blinding factor
`r`; a verifier reconstructs `B_ = Y + r·G` and `C_ = C + r·A` and checks the DLEQ challenge
against the mint's public key for the claimed amount (from `/v1/keys`). A false amount,
false `C`, or false `r` fails. cashu-ts 2.9 ships the client surface (`SendOptions.includeDleq`,
`receive({ requireDleq })`, `hasValidDleq`; `@cashu/crypto` `verifyDLEQProof_reblind`); the
reference nutshell mint produces DLEQ proofs at issuance/swap and signals support via
`/v1/info`. The e2e local mint (nutshell + FakeWallet, ADR-0006) can exercise the full path.

Publishing full proofs in the bid does not endanger funds: P2PK-locked proofs cannot be
spent without the seller child privkey regardless of disclosure of `C` or `r` — the
kind-1025 path release already publishes full proofs at settlement.

## Decision

1. **Collateral publication.** Kind-1023 extends to publish the full locked proofs —
   `amount`, keyset id, `C`, and DLEQ `{e, s, r}` per proof — alongside the existing
   `lock_secret` and `proof_y` tags. Exact tag serialization is resolved against §4.2 in
   implementation (one JSON-encoded tag per proof, ordered to pair with
   `lock_secret`/`proof_y`).
2. **Bid-time verification (composition).** A bid counts as economically validated at
   ingestion only if, for every proof: (a) DLEQ verifies offline against the mint's public
   keys for the claimed amount; (b) `sum(proofs.amount)` equals the declared `amount` tag
   (for rebid legs, the leg delta); and (c) NUT-7 on `proof_y` returns `unspent`. These
   compose with the existing §7 structural checks. Missing or invalid DLEQ data fails
   closed (`collateral_unverified`).
3. **Privacy trade-off accepted.** Revealing `r` lets the mint correlate issuance to proof
   if it sees the bid (NUT-12's disclosed limitation). Accepted: the bidder's identity is
   already revealed by the Nostr signature, and the token is spendable only by the seller
   child key.
4. **Mint compatibility, fail-closed.** Auctions require NUT-12-capable mints in their
   allowlist (advertised via `/v1/info`). The wallet's non-DLEQ fallback (ADR-0004 known
   limitation) is a hard reject for auction bids, not a silent pass.
5. **Verification ownership stays client-side.** Consistent with ADR-0004's NUT-7
   ownership model: the client verifies DLEQ + NUT-7 at the request boundary. Validators MAY
   later attest collateral in verdicts (new claim, e.g. `collateral_verified`) as a
   follow-up; verdict semantics otherwise remain rules/policy.
6. **Migration by `start_at`.** Auctions starting after rollout require DLEQ mints; live
   auctions with in-flight bids are grandfathered.
7. **Documented residuals (not solved here).**
   - `child_pubkey` cannot be verified against the seller's `p2pk_xpub` before kind-1025 —
     deliberate, since early path disclosure would let the seller derive the child privkey
     and drain bids mid-auction.
   - DLEQ proves the mint _promised_ the amount; mint solvency remains a separate trust axis
     (mint allowlist, `vadium_ratio_bps`).
   - NUT-7 `unspent` remains a point-in-time reading; the practical double-spend race is
     bounded by the lock (funds cannot move pre-`T_unlock` without the seller key).

## Alternatives considered

- **Status quo (settlement-only verification):** rejected — verification arrives only at
  settlement, and the griefing vector is currently free.
- **Mint-attested amounts:** impossible — the mint cannot know an unspent secret's
  denomination (blind-signature unlinkability); no spec endpoint reveals it.
- **Lightning hold-invoice escrow:** a different settlement policy, orthogonal to and
  independent of this ADR (cf. #1235).

## Consequences

- During an auction, every participant can verify the monetary commitment behind a bid
  offline, closing §9.1.1: fabrication without real funds becomes impossible (no valid
  mint signature exists), understated collateral fails the sum check, and NUT-7 becomes
  meaningful as an unspentness check on real tokens.
- The verdict-validated display semantics of #1259 compose with this: the quorum remains
  rules/policy; collateral checks add the economic dimension.
- Bid event size grows, bidders must use DLEQ-capable wallets, and the compatible mint set
  narrows to NUT-12-supporting mints.

## Amendments deferred to implementation

- AUCTIONS.md §4.2 (tag set + forbidden-tag review), §7 pipeline (atomic checklist section in
  ADR-0003 format), §9.1.1 (gap closed), §6.0 if validators later attest collateral.
- ADR-0004 "Known limitations" updated to reference this ADR.
- Implementation proceeds as separate PRs after this ADR advances to Accepted.
