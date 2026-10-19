# Auctions architecture for maintainers

This document explains the accepted target and the current evidence boundary. Normative details remain in [ADR-001-INDEPENDENT-FIPS-AUCTIONS.md](ADR-001-INDEPENDENT-FIPS-AUCTIONS.md) and the pinned contracts in [PROVENANCE.md](PROVENANCE.md).

## 1. Independent validator mesh over FIPS

The target is four equally weighted CometBFT validators operated independently, with at most one Byzantine maintainer. Three validators must agree. This does not protect against three- or four-maintainer collusion.

Validator traffic is intended to traverse FIPS, meaning the Free Internetworking Peering System, not Federal Information Processing Standards. The reviewed architecture pin is FIPS `v0.5.2` at commit `53a3ec4b2fbaceb7009dd4fbe6974b011e452ae5`. A deployment must freeze its actual FIPS pin and topology again.

Nostr is discovery/bootstrap only. A relay advert or endpoint does not grant FIPS admission, Comet voting power, auction authority, payment membership, or administration. FIPS node identity, Comet node identity, validator identity, auction actor identity, Cashu keys, FROST shares, recipient keys, and administrator credentials are separate authorities.

Consensus code is intended to be deterministic and bounded. It orders admission, bids and rebids, auction close, winner/loser disposition, authorization, ambiguity, and terminal evidence. It must not perform relay, HTTP, mint, wallet, DKG, FROST-round, or wall-clock I/O inside consensus.

## 2. Consensus authority is not spending authority

| Boundary | Authority | What it proves | What it does not prove |
|---|---|---|---|
| Auction consensus | CometBFT validator quorum | Canonical bid order, close result, winner/loser disposition, and committed authorization facts | That a mint accepted a request or a recipient imported funds |
| MAIN spend | Bidder signature plus committee aggregate signature | The exact authorized Cashu spend surface was signed by both required roles | That the mint accepted it or the seller received it |
| Committee aggregate | FROST threshold 3-of-4 | At least three committee shares produced one BIP340-compatible aggregate | A second consensus decision or independent payment receipt |
| REFUND spend | Separate bidder refund key after eligibility | The exact refund branch is authorized | That MAIN was revoked or that the refund won the race |
| Mint | Target Cashu mint | Issuance and atomic first-spend enforcement | Auction correctness, recipient identity, or application authorization |
| Recipient import evidence | Versioned recipient journal and exact response | The exact terminal response was imported under the expected idempotency key | Broader auction or validator correctness |

The Cashu condition remains bidder-plus-committee NUT-11 `SIG_ALL` 2-of-2. The committee's FROST 3-of-4 aggregate counts as the second signature; it does not change Cashu `n_sigs` to three or four. One unavailable committee member can be excluded. Two unavailable members block MAIN.

## 3. Identities and exact outputs

The V2 contract keeps four payment identities distinct:

- `A`: bidder Nostr actor key, which signs the approval/package relationship.
- `B`: bidder MAIN Cashu key, which signs the exact MAIN `SIG_ALL` digest and package.
- `C`: separate bidder REFUND Cashu key, which signs the exact refund `SIG_ALL` digest and recipient capability.
- `D`: committee aggregate key produced by FROST 3-of-4.

Each locked input uses the same B, C, D, and locktime, with a unique nonce. The selected branch must reload and exact-match the mint capability seal, keyset, fee, inputs, ordered outputs, package digest, recipient capability digest, and Cashu `SIG_ALL` digest before any effect.

MAIN binds the exact ordered output set to the derived seller child. REFUND binds the exact ordered output set to the separate refund recipient key C. Amount, recipient, proof count, request/response digests, branch role, template, bundle, and selection root must agree across terminal and recipient records. Changing an amount, blinded output, recipient, ordering, role, or digest is a different request and must refuse.

NUT-11 `SIG_ALL` signs each input's `secret || C` and each output's `amount || B_` in transaction order. It does not itself sign the output keyset id, auction identity, operation identity, role, or recipient mapping. The application envelope binds those fields, but a completed-witness holder may still be able to mutate an unsigned output keyset id and submit directly. Release therefore still requires either a documented mint-enforced constraint or an explicitly accepted economic-equivalence rule with compatibility evidence.

## 4. Outcome mapping

The outcome-to-branch mapping is exact:

- `winner`: only the certified winning operation uses MAIN; every other accepted bid uses REFUND when eligible.
- `reserve_not_met`: every accepted bid, including the final highest bid, uses REFUND when eligible.
- `no_bids`: there are no accepted bids and no payment disposition.

These outcomes must not be collapsed. A refund win never rewrites the canonical auction winner and is never recorded as `seller_paid`.

## 5. Intended offline bidder behavior

The intended flow allows the bidder device to go offline after it has authorized the exact signed approval surface, exact MAIN and REFUND packages, recipient capabilities, and recovery identity, and after the system has durably admitted those bytes. Maintainers can later execute only the already-authorized branch selected by committed consensus.

This does not allow maintainers to choose new outputs, recipients, amounts, keys, roles, or post-cutoff MAIN signatures. The bidder-offline behavior has focused local test evidence, but no full composed FIPS/validator/payment runtime has proved it end to end.

## 6. Cutoff and first-spend race

The accepted timing policy is:

1. A new MAIN FROST session or aggregate may start only while the authoritative observed time is strictly less than `locktime - 60`; equality refuses.
2. A complete, verified, durably persisted MAIN signature is not invalidated by a later cutoff or locktime.
3. REFUND is ineligible before locktime and eligible at locktime equality.
4. Accepted R16 omits early return. A losing bidder is not promised an immediate pre-locktime refund; refund processing is deferred until eligible.
5. After locktime, retained MAIN and REFUND can both be valid. The mint's atomic first spend decides which branch succeeds.

FROST does not remove this race. Local clocks schedule work but do not prove the mint's clock. Production values and clock authority remain deployment decisions.

## 7. Fail-closed recovery

Authorization, submission, terminal mint evidence, and recipient import are separate states. `submitted_unknown` is non-terminal. It forbids a blind retry.

Recovery must reuse the exact scope, operation root, mint request digest, proof references, mint seal, recipient capability, and ordered outputs. An opaque `safe_to_retry` result does not by itself authorize resubmission under the accepted R4.1/R4.2/R4.3 lineage. Exact recovery may restore an already-established response; otherwise the operation remains pending manual resolution.

A generic proof state or `SPENT` result does not identify MAIN versus REFUND and cannot become completion. Completion requires exact mint terminal metadata followed by exact idempotent recipient-import evidence. Ambiguous, missing, conflicting, reordered, or drifting evidence fails closed.

## 8. Storage and runtime boundary

Storage V2 is meant to supply immutable chain-wide history, checkpoint markers, roots, and bounded chunks. The current storage candidate repairs orphan replay selection, checkpoint payload binding, and the M=1 V1-to-V2 mapping. M>1 retained-history migration remains explicitly refused because independently derived V1 height-record bytes and replay evidence are missing.

FIPS/UI R5 provides frozen pure-code ingress and evidence work, but independent review blocked Phase 1 and production storage/runtime adapters are not wired. The frozen work may use in-memory fixtures only; absence, null results, or digest drift must cause zero payment calls. No in-memory or HTTP display feed may silently become production history authority.

