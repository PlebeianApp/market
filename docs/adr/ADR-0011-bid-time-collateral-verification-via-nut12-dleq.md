# ADR-0011: Bid-time collateral verification via NUT-12 DLEQ proofs

## Status

Accepted

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

1. **Per-proof DLEQ publication.** Kind-1023 gains one `dleq_proof` tag per locked
   proof, ordered parallel to the existing `lock_secret`/`proof_y` arrays. Value =
   compact JSON:
   `{"id":"<keyset_id>","amount":<int>,"C":"<compressed_pubkey_hex>","e":"<hex>","s":"<hex>","r":"<hex>"}`.
   `r` (blinding factor) is REQUIRED — it is what lets third parties reblind-verify
   offline (this is the NUT-12 proving-possession-without-spending mechanism).
2. **Offline verification.** Each `dleq_proof` is verified against the mint's public
   keys (`/v1/keys` for the claimed keyset) for the claimed `amount`. False amount /
   forged `C` / wrong keyset fails. Library: `hasValidDleq(proof, keyset)`.
3. **Sum check.** `sum(dleq_proof[].amount) == declared leg delta`
   (`amount - prev_bid.amount`, or `amount` for a single-leg bid). This is the
   §9.1.1 invariant.
4. **Compose with NUT-7.** DLEQ verification runs alongside the existing NUT-7
   `unspent` check at the client ingestion boundary. A bid is "fully valid for
   settlement CTAs" only when **both** pass; NUT-7 failure →
   `bid_pending_review`/`proof_spent`, DLEQ failure → `bid_invalid`/`fraudulent_bid`
   (`reason=dleq_invalid`).
5. **Fail-closed mint compatibility.** Auctions starting after rollout REQUIRE
   NUT-12 capable mints (checked via `CashuMint.getInfo().isSupported(12)`).
   Non-DLEQ bids are **hard rejected** — the `nip60.ts` non-DLEQ silent fallback is
   removed for post-rollout auctions.
6. **Client-side ownership at ingestion.** DLEQ verification is owned by the client
   (ingestion boundary), matching ADR-0004's NUT-7 ownership model. Validators do NOT
   verify DLEQ; they only enforce the NUT-12-mint allowlist (structural). This keeps
   the "validator is structural/opinion-only" architecture intact.
   6a. **Bounded keyset acquisition (Amendment).** Every ingestion and settlement path that
   calls `computeValidatedBids` MUST acquire the mint keysets needed to DLEQ-verify
   bids (`fetchDleqKeysetsForBids`), bounded to the auction's `mint` allowlist. Missing
   DLEQ evidence is NON-AUTHORITATIVE: a DLEQ-required bid whose keyset cannot be
   gathered is classified `pending`, never valid. Without feeding evidence, a
   DLEQ-required auction can never settle — fail-safe, not fail-open.
7. **Migration by `start_at`.** Auctions with `start_at >= DLEQ_ROLLOUT_START_AT` require
   the DLEQ path; live auctions (already open) are grandfathered under the legacy
   non-DLEQ path so they are not broken mid-flight.
8. **Canonical activation (Amendment).** The DLEQ requirement is recorded on the signed
   auction event as a `dleq_required` tag (`"1"`/`"0"`), emitted at publish time from the
   same boundary decision the publish gate enforces. This makes activation canonical
   protocol truth: two clients reading the same signed event derive the same requirement
   regardless of their deploy-time boundary config, and a seller cannot backdate
   `start_at` to change it. The client-side boundary comparison remains only as a
   fallback for legacy events published before the tag existed. The bidder publish path
   derives BOTH its lock requirement (`lockAuctionBidFunds({ dleqRequired })`) and its
   published `dleq_proof` tags from this single signed value — never from a second,
   locally re-derived boundary comparison, which could make the lock and the published
   kind-1023 disagree. The bid form carries that value explicitly
   (`AuctionBidFormData.dleqRequired`, read from the event via `getAuctionDleqRequired`,
   which delegates to the same `resolveDleqRequired` predicate); the boundary fallback
   inside `publishAuctionBid` exists only for callers that predate the field.

### Tag serialization (resolved per AUCTIONS.md §4.2)

- **Tag format:** one `["dleq_proof", "<json>"]` tag per proof, JSON-encoded,
  parallel to `lock_secret`/`proof_y` (matches the existing parallel-array design;
  simple to parse with Zod + a JSON-typed refine; relays treat it as an opaque
  tag). Explicit `id` (keyset id) is included because a mint may have multiple
  keysets and the verifier must fetch the right one.
- **Library/dependency:** use `hasValidDleq` from `@cashu/cashu-ts` (already
  pinned 2.9.0). No new package. Wrap in try/catch because it `throw`s on a
  missing amount key.
- **Where DLEQ tags are produced:** in `src/lib/auction/tagBuilders.ts`
  `buildBidEventTags`, fed from the locked proofs returned by
  `lockAuctionBidProofs` (which now carries DLEQ via `includeDleq: true`).
- **Mint keys acquisition:** the verification module accepts pre-fetched
  `MintKeys` (via a small `getMintKeyset(mintUrl, keysetId, {customRequest})`
  helper on `CashuMint.getKeys`), so pure verification stays a pure function and
  network policy stays at the caller (validator allowlist pattern in
  `mintReachability.ts`).

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

## Amendments

Implementation is co-located in this PR (code + docs). The ADR-locked decisions define
the invariants; the code implements them. Specific docs amendments:

- AUCTIONS.md §4.2 (tag set + forbidden-tag review), §7 pipeline (atomic checklist section in
  ADR-0003 format), §9.1.1 (gap closed), §6.0 if validators later attest collateral.
- ADR-0004 "Known limitations" updated to reference this ADR.
