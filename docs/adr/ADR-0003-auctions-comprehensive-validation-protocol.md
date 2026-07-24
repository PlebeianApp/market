# ADR-0003: Adopt Comprehensive Validation Protocol for Nostr Auctions and Settlement

## Status

Proposed

## Date

2026-07-24

## Context

The implementation of the Nostr-based auction protocol introduces complex, multi-stage financial interactions involving cryptographic commitments (P2PK), hierarchical deterministic key derivation, Cashu token proofs, and asynchronous settlement windows. Unlike standard order flows, auction settlement relies on a sequence of events (Kind 30408 -> Kind 1023 -> Kind 1025 -> Kind 1024) where the validity of a later stage depends on the rigorous verification of earlier stages.

Previously, validation logic was scattered across ad-hoc checks in UI components and mutation hooks, lacking a unified, deterministic specification. This led to risks of:

- Fraudulent Bids: Accepting bids where proofs were already spent or lock keys did not match the auction's HD tree.
- Settlement Failures: Sellers attempting to redeem invalid paths or bidders failing to release the correct derivation chain.
- Race Conditions: Ambiguity in handling anti-snipe curves, rebid chains, and fallback cascades.
- UI Misrepresentation: Interfaces displaying "funds received" before on-mint redemption was verified.

To mitigate these risks, a formalized validation specification is required that treats every event in the lifecycle as a distinct verifiable unit, with explicit positive and negative test cases for every condition.

## Decision

We adopt a Comprehensive Validation Protocol for the Auctions module, structured hierarchically to ensure modularity and clarity. This protocol defines:

- Top-Level Validation Gates: High-level entry points for Auction Context, Bid Submission, Settlement Release, and Final Settlement.
- Section-Level Validators: Modular functions responsible for specific logical domains (e.g., validateBidLockSecrets, verifyDerivationPath).
- Atomic Verification Checklists: Detailed, binary-pass/fail conditions for every property, including:
- Structural Integrity: Tag presence, format, and cryptographic validity.
- Temporal Constraints: Window adherence, skew limits, and grace periods.
- Financial Logic: Reserve checks, increment rules, and anti-snipe curve calculations.
- Cross-Reference Consistency: Ensuring events reference valid predecessors and successors.
- External State: NUT-7 mint state verification (unspent vs spent).

This protocol mandates that no bid is considered valid unless it passes all structural and external state checks, and no settlement is considered complete until the derivation path is cryptographically verified and the mint confirms proof spending.

## Consequences

- Modular Validation Architecture: The codebase will implement granular helper functions (e.g., validateBidStructure, verifyDerivationPath) rather than monolithic validators, allowing independent testing and reuse.
- Deterministic Outcome: All participants (bidders, sellers, validators, observers) will reach the same conclusion regarding the validity of a bid or settlement, reducing disputes.
- Enhanced Security: Cryptographic fraud (e.g., fake paths, spent-behind-lock) will be detected immediately upon event ingestion, preventing wasted redemption attempts.
- Clear Failure Modes: Every validation failure will map to a specific error code (e.g., proof_spent, derivation_mismatch), enabling precise UI feedback and automated retry logic.
- Documentation Obligation: Any future modification to the auction protocol (e.g., new settlement policies, curve shapes) must update this validation specification and the corresponding atomic checklists before implementation.
- Testing Standard: Unit and integration tests must cover every positive and negative case listed in the Atomic Verification Checklists to ensure full coverage.

## Appendix A: Top-Level Validation Gates

### 1. Auction Context Validation (Kind 30408)

Goal: Ensure the auction definition is trustworthy and immutable.

Input: Auction Event (NDKEvent)
Output: AuctionContext object or ValidationFailure

Critical Checks:

- Signature validity.
- Immutable tag consistency (d, start_at, p2pk_xpub).
- Policy compatibility (settlement_policy, key_scheme).
- Mint reachability (NUT-7 connectivity).

### 2. Bid Submission Validation (Kind 1023)

Goal: Ensure the bid is structurally sound, financially compliant, and backed by valid funds.

Input: Bid Event, Auction Context, Top Bid History, Current Time.
Output: BidValidityResult (Valid/Invalid/Pending).

Critical Checks:

- Structural tags (e, a, p, locktime, child_pubkey).
- Lock secret parsing (NUT-10 P2PK).
- Mathematical correctness (hash_to_curve match).
- Temporal window adherence.
- Financial floor (Reserve, Increment, Anti-snipe curve).
- Rebid chain integrity (if applicable).
- On-mint state (unspent).

### 3. Settlement Release Validation (Kind 1025)

Goal: Ensure the bidder has revealed the correct path to unlock funds.

Input: Path Release Event, Original Bid Event, Auction Context.
Output: ReleaseValidityResult.

Critical Checks:

- Signer authorization (must be the original bidder).
- Derivation path correctness (derive(xpub, path) == child_pubkey).
- Cashu token integrity (matches bid amount and lock key).
- Release reason validity.

### 4. Final Settlement Validation (Kind 1024)

Goal: Confirm the seller has redeemed funds and declared the winner.

Input: Settlement Event, Winning Bid, Path Release, Auction Context.
Output: SettlementCompletenessResult.

Critical Checks:

- Signer authorization (must be the seller).
- Winning bid validity.
- Path release verification.
- Payout math (sum of legs = final amount).
- Fallback chain consistency (if applicable).
- NUT-7 state confirmation (spent).

## Appendix B: Section-Level Validators and Atomic Checklists

### Section 1: Auction Context Validators

#### 1.1 validateAuctionContext(auctionEvent)

| ID    | Condition Type | Check Description                                          | Expected Result | Failure Label            |
| ----- | -------------- | ---------------------------------------------------------- | --------------- | ------------------------ |
| C1.1  | Positive       | Event signature verifies against pubkey.                   | true            | signature_invalid        |
| C1.2  | Positive       | d tag exists and is non-empty.                             | true            | missing_d_tag            |
| C1.3  | Positive       | auction_type equals english.                               | true            | unsupported_auction_type |
| C1.4  | Positive       | settlement_policy equals cashu_p2pk_bidder_path_v1.        | true            | unsupported_policy       |
| C1.5  | Positive       | key_scheme equals hd_p2pk.                                 | true            | unsupported_key_scheme   |
| C1.6  | Positive       | p2pk_xpub is a valid base58/xpub string.                   | true            | invalid_xpub             |
| C1.7  | Positive       | At least one auditors tag exists.                          | true            | missing_auditors         |
| C1.8  | Positive       | At least one mint tag exists.                              | true            | missing_mints            |
| C1.9  | Positive       | settlement_grace is a positive integer.                    | true            | invalid_grace_period     |
| C1.10 | Negative       | derivation_path tag is present.                            | false (Reject)  | early_path_exposure      |
| C1.11 | Negative       | path_issuer or path_grant_id tags present.                 | false (Reject)  | legacy_tag_present       |
| C1.12 | Negative       | Immutable tags (start_at, end_at) differ from pinned root. | false (Reject)  | immutable_tag_changed    |

#### 1.2 validateMintReachability(mintUrl)

| ID   | Condition Type | Check Description                              | Expected Result | Failure Label         |
| ---- | -------------- | ---------------------------------------------- | --------------- | --------------------- |
| M1.1 | Positive       | HTTP GET to /v1/info returns 200 OK.           | true            | mint_unreachable      |
| M1.2 | Positive       | Response contains valid NUT-7 supported field. | true            | mint_nut7_unsupported |
| M1.3 | Negative       | Connection times out (>5s).                    | false           | mint_timeout          |
| M1.4 | Negative       | HTTP 4xx/5xx error returned.                   | false           | mint_http_error       |

### Section 2: Bid Validators (Kind 1023)

#### 2.1 validateBidStructure(bidEvent, auctionContext)

| ID    | Condition Type | Check Description                                       | Expected Result | Failure Label        |
| ----- | -------------- | ------------------------------------------------------- | --------------- | -------------------- |
| B2.1  | Positive       | Event signature verifies.                               | true            | signature_invalid    |
| B2.2  | Positive       | e tag matches auctionRootEventId.                       | true            | invalid_root_ref     |
| B2.3  | Positive       | a tag matches 30408:<seller>:<d_tag>.                   | true            | coordinate_mismatch  |
| B2.4  | Positive       | p tag matches auction seller pubkey.                    | true            | seller_mismatch      |
| B2.5  | Positive       | amount is a positive integer.                           | true            | invalid_amount       |
| B2.6  | Positive       | currency equals SAT.                                    | true            | unsupported_currency |
| B2.7  | Positive       | locktime equals max_end_at + settlement_grace.          | true            | bad_locktime         |
| B2.8  | Positive       | status equals locked.                                   | true            | invalid_status       |
| B2.9  | Positive       | child_pubkey is valid compressed secp256k1.             | true            | bad_child_pubkey     |
| B2.10 | Positive       | refund_pubkey is valid compressed secp256k1.            | true            | bad_refund_key       |
| B2.11 | Negative       | derivation_path tag present.                            | false (Reject)  | early_path_exposure  |
| B2.12 | Negative       | path_issuer, path_grant_id, or commitment tags present. | false (Reject)  | legacy_tag_present   |

#### 2.2 validateBidLockSecrets(bidEvent, auctionContext)

| ID    | Condition Type | Check Description                                   | Expected Result | Failure Label          |
| ----- | -------------- | --------------------------------------------------- | --------------- | ---------------------- |
| L2.1  | Positive       | lock_secret count >= 1.                             | true            | missing_lock_secret    |
| L2.2  | Positive       | proof_y count equals lock_secret count.             | true            | proof_y_count_mismatch |
| L2.3  | Positive       | Each lock_secret parses as valid NUT-10 P2PK.       | true            | bad_lock               |
| L2.4  | Positive       | hash_to_curve(secret) equals corresponding proof_y. | true            | bad_proof_y            |
| L2.5  | Positive       | Lock pubkey inside secret equals child_pubkey.      | true            | lock_pubkey_mismatch   |
| L2.6  | Positive       | Locktime inside secret equals bid locktime.         | true            | bad_locktime           |
| L2.7  | Positive       | Refund key inside secret equals refund_pubkey.      | true            | refund_key_mismatch    |
| L2.8  | Positive       | sigflag inside secret is SIG_INPUTS.                | true            | bad_sigflag            |
| L2.9  | Positive       | n_sigs_refund inside secret is 1.                   | true            | bad_n_sigs_refund      |
| L2.10 | Negative       | Multisig detected (n_sigs > 1).                     | false (Reject)  | multisig_detected      |

#### 2.3 validateBidTemporal(bidEvent, auctionContext, observedAt)

| ID   | Condition Type | Check Description                                | Expected Result | Failure Label  |
| ---- | -------------- | ------------------------------------------------ | --------------- | -------------- |
| T2.1 | Positive       | created_at >= start_at.                          | true            | pre_start      |
| T2.2 | Positive       | created_at <= max_end_at.                        | true            | post_end       |
| T2.3 | Positive       | observed_at <= max_end_at.                       | true            | late_arrival   |
| T2.4 | Positive       | created_at - observed_at <= max_skew_sec (120s). | true            | timestamp_skew |

#### 2.4 validateBidAmount(bidEvent, auctionContext, topBid, observedTime)

| ID   | Condition Type | Check Description                        | Expected Result | Failure Label        |
| ---- | -------------- | ---------------------------------------- | --------------- | -------------------- |
| F2.1 | Positive       | amount >= reserve.                       | true            | below_reserve        |
| F2.2 | Positive       | amount > topBid.amount + bid_increment.  | true            | under_increment      |
| F2.3 | Positive       | If t > end_at, amount >= curve_floor(t). | true            | under_curve          |
| F2.4 | Positive       | Lag tolerance applied (5s grace).        | true            | lag_tolerance_failed |

#### 2.5 validateRebidChain(bidEvent, prevBidEvent)

| ID   | Condition Type | Check Description                            | Expected Result | Failure Label             |
| ---- | -------------- | -------------------------------------------- | --------------- | ------------------------- |
| R2.1 | Positive       | prevBidEvent exists if prev_bid tag present. | true            | missing_prev_bid          |
| R2.2 | Positive       | bid.pubkey == prevBid.pubkey.                | true            | replacement_chain_invalid |
| R2.3 | Positive       | bid.amount > prevBid.amount.                 | true            | replacement_chain_invalid |
| R2.4 | Positive       | bid.locktime == prevBid.locktime.            | true            | replacement_chain_invalid |
| R2.5 | Positive       | Chain terminates (no cycles).                | true            | replacement_chain_invalid |
| R2.6 | Positive       | Delta amount = sum(proof amounts in leg).    | true            | delta_mismatch            |

#### 2.6 validateBidMintState(bidEvent, mintClient)

| ID   | Condition Type | Check Description                      | Expected Result | Failure Label |
| ---- | -------------- | -------------------------------------- | --------------- | ------------- |
| N2.1 | Positive       | All proof_y return unspent from NUT-7. | true            | proof_spent   |
| N2.2 | Negative       | Any proof_y returns spent.             | false (Reject)  | proof_spent   |
| N2.3 | Negative       | Any proof_y returns missing.           | false (Reject)  | proof_missing |
| N2.4 | Pending        | Any proof_y returns pending.           | defer           | proof_pending |

### Section 3: Settlement Release Validators (Kind 1025)

#### 3.1 validatePathRelease(releaseEvent, bidEvent, auctionContext)

| ID    | Condition Type | Check Description                              | Expected Result | Failure Label          |
| ----- | -------------- | ---------------------------------------------- | --------------- | ---------------------- |
| P3.1  | Positive       | Event signature verifies.                      | true            | signature_invalid      |
| P3.2  | Positive       | Signer pubkey == bidEvent.pubkey.              | true            | signer_mismatch        |
| P3.3  | Positive       | e tag matches bidEvent.id.                     | true            | invalid_bid_ref        |
| P3.4  | Positive       | a tag matches auction coordinates.             | true            | coordinate_mismatch    |
| P3.5  | Positive       | p tag matches seller pubkey.                   | true            | seller_mismatch        |
| P3.6  | Positive       | derivation_path is valid BIP-32 (no hardened). | true            | hardened_path          |
| P3.7  | Positive       | child_pubkey matches bidEvent.child_pubkey.    | true            | child_pubkey_mismatch  |
| P3.8  | Positive       | release_reason is valid enum.                  | true            | invalid_release_reason |
| P3.9  | Critical       | derive(p2pk_xpub, path) == child_pubkey.       | true            | derivation_mismatch    |
| P3.10 | Positive       | cashu_token present and valid.                 | true            | missing_cashu_token    |
| P3.11 | Positive       | Token proofs lock to child_pubkey.             | true            | token_lock_mismatch    |
| P3.12 | Positive       | Token sum amounts == leg delta.                | true            | token_amount_mismatch  |

### Section 4: Final Settlement Validators (Kind 1024)

#### 4.1 validateSettlementResult(settlementEvent, auctionContext, winningBid)

| ID    | Condition Type | Check Description                               | Expected Result | Failure Label          |
| ----- | -------------- | ----------------------------------------------- | --------------- | ---------------------- |
| S4.1  | Positive       | Event signature verifies.                       | true            | signature_invalid      |
| S4.2  | Positive       | Signer pubkey == auction seller.                | true            | unauthorized_settler   |
| S4.3  | Positive       | e tag matches auctionRootEventId.               | true            | invalid_root_ref       |
| S4.4  | Positive       | status is valid enum (settled, etc.).           | true            | invalid_status         |
| S4.5  | Positive       | close_at >= max_end_at.                         | true            | premature_close        |
| S4.6  | Positive       | If settled, winning_bid tag present.            | true            | missing_winning_bid    |
| S4.7  | Positive       | If settled, winner matches bid author.          | true            | winner_mismatch        |
| S4.8  | Positive       | If settled, path_release tag present and valid. | true            | missing_path_release   |
| S4.9  | Positive       | Payout sum == final_amount (for rebid chains).  | true            | payout_sum_mismatch    |
| S4.10 | Positive       | All chain legs have corresponding Kind 1025.    | true            | partial_chain_release  |
| S4.11 | Positive       | NUT-7 state for proofs is spent.                | true            | redemption_unconfirmed |

## Appendix C: Implementation Guidelines

- Function Signatures: Each validator must return a standardized result object: { isValid: boolean, error: string | null, details: Record<string, any> }.
- Error Codes: Use the exact Failure Label strings defined above for consistent logging and UI messaging.
- Short-Circuit Evaluation: Validators must fail fast. If a structural check fails, do not proceed to expensive cryptographic or network checks.
- Test Coverage: Every row in the Atomic Checklists must have at least one corresponding unit test (positive and negative).
- Extensibility: New auction policies or curve shapes must add new rows to these checklists without altering existing logic.
