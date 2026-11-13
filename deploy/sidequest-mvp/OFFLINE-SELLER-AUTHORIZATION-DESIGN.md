# Offline seller authorization

## Problem

The deployed Friday flow creates an exact seller payout plan for each bidder operation. The plan contains fresh blinded Cashu outputs whose openings remain in the seller's browser, a Coco recipient-key capability, and a Nostr authorization for that exact operation. This is safe but requires the seller tab and signer for every bid.

A page-only auto-approval toggle cannot operate after the page closes. Moving a reusable seller key or wallet seed to APP would add a persistent credential and expand the server trust boundary.

## Implemented protocol

`demo-friday-auction-payout-authorization.ts` implements the local protocol primitive for one explicit authorization when an auction is created:

1. The seller browser prepares one unique blinded output for each binary denomination needed to cover the auction's maximum permitted payout.
2. The existing seller Coco recipient key signs the complete catalog once. Private openings remain only in the existing browser-private journal.
3. NIP-07 signs one exact auction-scoped authorization containing the seller actor, payout key, mint/keyset, auction terms, original and maximum end time, payout cap, validity window, and the authenticated catalog.
4. For a bid, the authority can deterministically select a subset of those outputs that sums to the exact bid amount. Selection checks the current auction, leader, increment, state height, app hash, bidder, operation and cap. It performs no seller signing and needs no seller tab.

The seller can return after the auction to import the winning signatures using the retained private openings. The public authorization never contains an opening, seed, bearer proof or credential.

## Enforced integration invariant

The catalog is shared across candidate bids because only one bid can win. The authority stores each authorization, observed auction-state floor, and final winning selection in a durable registry with an independent rollback anchor. Every V3 winner template carries the exact authorization, selection and keyset, and each signer verifies them before participating. The terminal executor claims the durable **one winner terminal branch per auction authorization** before any mint effect. Exact replay of that winner is idempotent; another operation, bidder, amount or outcome fails closed.

Seller recovery reads the public winning claim, selects only the corresponding browser-private openings, validates every DLEQ proof, imports the exact token and durably acknowledges it. The older per-operation seller-plan path remains available for auctions created before an auction authorization exists.

This is a protocol change, not a UI-only patch. The implementation is locally built and regression-tested, but is not deployed by this change. A live service must not accept the new path until its successor databases and independent anchor are initialized, compatible authority and terminal binaries are installed, the browser bundle is installed, and a fresh five-profile fake-sat rehearsal passes.

## Security properties

- Exact seller actor and exact Coco payout key; no authority-selected payout destination.
- Exact auction, network, chain, mint, denomination keyset and listing terms.
- Seller-selected payout cap and bounded validity window.
- Authenticated observed leader, replacement ID, increment, height and app hash bound into each deterministic selection. Initial observation freshness is fail-closed under an explicit deployment policy described below.
- Seller self-bids, same-actor raises, stale leaders, extended auctions beyond the signed maximum, altered catalogs and altered signatures fail closed.
- No server-side seller private key, seed, opening, bearer proof or background browser credential.

## Verification completed locally

- Strict Friday TypeScript compilation succeeds.
- The focused authorization, registry, transport, browser, authority, terminal and import tests pass with real Schnorr signatures, blinded signatures and DLEQ proofs.
- The complete Friday regression gate passes, including four child-process threshold participants, restart/rollback detection, lost-response recovery, outbid returns and exact settlement.
- The browser gate, Go server tests, UI tests and separated-topology tests pass.
- The authority, terminal executor, browser bundle and fake-money-only Go site all build from the patched source.

## Remaining deployment acceptance

1. Initialize the create-once auction-payout database and independent rollback anchor on APP.
2. Install the successor authority, terminal executor, site asset and matching units/configuration without replacing predecessor evidence.
3. Verify loopback readiness and the new routes before enabling the existing authenticated HTTPS path.
4. Run a fresh five-profile fake-sat auction: listing authorization, offline-seller bids, outbid returns, automatic close, winning payout import, restart recovery and one-validator outage/rejoin.
5. Treat any unknown mint effect, incomplete terminal acknowledgement, pin drift or nonzero unavailable balance as a failed/incomplete rehearsal. Do not retry under a new operation identity.


## Consolidated winner-fence and freshness review

The common maintainer executor now requires a captured `claimAuctionPayoutWinnerExact` port for V3 winner templates at both `executeExact` and `recoverExact`, before any mint submission, terminal-response restoration or recipient delivery. The Friday queue adapter supplies that port using its authenticated terminal claim. Legacy direct close services without the port refuse V3 effects; they must not be advertised as supporting the new catalog flow. V1/V2 branches retain their existing behavior. Preparation alone does not claim a winner or authorize an unfenced effect.

The payout registry persists a per-auction maximum observed height and exact state digest under the independent rollback anchor. A lower height or conflicting state at the same height is refused, including after restart. This is monotonicity protection, not proof that the first observation is recent.

### Explicit initial-freshness policy

`authenticatedDemoCometState` validates the exact state bytes against a pinned quorum commit and exposes the authenticated next-header `bindingCommit.blockTime`. The payout reader enforces an explicit maximum head age and future-clock skew against a non-regressing host clock before registration or selection. It also bounds each Comet RPC read to five seconds and the complete authenticated read to fifteen seconds. A missing policy, stale state, excessive future skew, clock regression, hung read or wrong chain fails closed for new payout work while existing recovery remains available.

The 2026-11-05 APP preflight reported NTP synchronization and five authenticated H+1 samples 0.152–0.480 seconds old; a later read-only review observed roughly 1.3–1.5 seconds with low NTP offsets and one-second PBTS precision. The undeployed R37 preparation used a conservative proposed 30/5 policy. It is superseded by the approved demo-only R38 preparation, whose guard pins a 10-second maximum head age and two-second maximum future skew. The current R36 environment still contains neither setting. Tests cover both exact 10/2 boundaries, initially stale but correctly authenticated state, future-dated state beyond the bound, clock regression, read timeout, abort propagation, recovery after a timeout and fresh valid state.

### Focused verification and scope

The payout runtime tests include a real two-process SQLite race between conflicting winner claims, plus actual SIGKILL immediately before and after a durable **local mock-mint receipt**, followed by database reopen and exact recovery. They do not exercise a live mint. Existing maintainer tests additionally cover mock-mint lost responses and recipient-delivery restart. Payout authorization, runtime and browser-import tests are included in the standard Friday test and TypeScript gates.

The consolidated current-tree checks completed as follows: 382 Friday tests passed with 1,604 expectations, the expanded Friday TypeScript gate passed, `go test ./...` passed, and both UI test files passed. The seven exact live recipient-pending operation IDs are covered by an isolated restart/acknowledgement compatibility test with zero execute or recovery mint effects. These results are not a claim that live deployment acceptance passed.

The demo-only 10-second authenticated-head age and 2-second future-skew policy is approved for preparation and pinned by the R38 guard. Release remains blocked on fresh live clock/head measurements inside that policy, a quiesced backup, successor database/anchor initialization, compatible artifact installation, authenticated public WebSocket verification and the fresh five-profile fake-sat rehearsal above. This patch does not initialize or modify live state, deploy artifacts, or push commits.
