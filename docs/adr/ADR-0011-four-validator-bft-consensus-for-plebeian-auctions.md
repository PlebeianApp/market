# ADR-0011: Four-Validator BFT Consensus for Plebeian Auctions

## Status

Proposed

## Date

2026-10-01

## Context

Plebeian Auctions need one canonical answer to:

- which bids were accepted and in what order;
- when the auction ends;
- who the winner is;
- which collateral is already reserved;
- when a previous bidder becomes refundable.

Nostr relays are useful transport and audit infrastructure, but relay arrival order is not consensus. A single coordinator must also not be able to choose the winner by itself.

The reviewed no-money P0 prototype is frozen at:

`6084756a747c62c5f18f47ec0e783b129c9d962b`

Final adversarial review found no remaining repair before ADR and returned:

`FREEZE_WITH_DOCUMENTED_LIMITATIONS`.

## Decision

Use **CometBFT v1.0.0** with **4 fixed, equal-power validators**.

- Finality: **3-of-4**
- Fault model: tolerate **at most 1 Byzantine/offline/censoring validator**
- If 2 validators are unavailable, the auction stops safely.
- CometBFT owns ordering/finality; Plebeian owns the deterministic auction state machine.
- Nostr remains transport/audit, not consensus.
- Coco/Cashu remain outside consensus and are a later monetary-security phase.

The core rule is:

> A bid counts when the validator network commits it, not when the bidder clicks or a relay first receives it.

## Time and anti-sniping

The P0 profile uses CometBFT PBTS:

- enabled from height 1;
- precision: **505 ms**;
- message delay tolerance: **15 s**;
- auction time resolution: **1 second**.

The 15-second value is a PBTS network-delay tolerance, not an intentional bid delay.

A bid is timely only when:

`accepted_time < effective_end`

Anti-sniping currently uses:

- trigger: final **60 s**;
- extension: **60 s**;
- maximum total extension: **1,800 s / 30 min**.

These are tested prototype values, not automatically final production tuning.

## Winner and collateral rules

The winner is derived only from canonical committed auction state. A caller cannot supply an arbitrary winner.

Collateral reservation is global across auctions. A proof already reserved by one accepted bid cannot also be reserved by another auction.

When a new bid becomes the leader, superseding the previous leader and marking the previous bid refundable must happen atomically.

## Security boundary

Consensus execution must be deterministic and must not depend on live external services.

Do not call from consensus execution:

- Nostr relays;
- Cashu mints;
- Coco;
- DNS/HTTP;
- local wall-clock time;
- randomness.

Cashu proof secrets, wallet seed material and arbitrary spend construction must remain outside the BFT state machine.

## Why four validators

Four validators are the smallest profile we chose that meets the MVP goal:

> one malicious validator must not be able to finalize arbitrary auction state.

Three validators are required to commit. One bad validator is therefore insufficient to finalize a conflicting winner by itself.

Seven validators would allow a stronger `f=2` target, but add more operators and deployment complexity. That remains a future option.

## Rejected alternatives

### Single coordinator

Rejected because one compromised operator/key would have too much authority over ordering and winner selection.

### Custom FROST/threshold-signature consensus

Rejected because threshold signatures do not provide complete replicated-state consensus: ordering, rounds, locks, view changes, catch-up and finality would still need to be designed.

FROST may still be useful later for monetary authorization.

### Relay arrival order

Rejected because Nostr relays do not provide one trusted global order or timestamp.

## Explicit limitations

Maintainers accepting this ADR accept all of the following:

1. Four validators tolerate at most **one Byzantine validator**.
2. **Two unavailable validators halt progress safely**.
3. A bid submitted just before the deadline is **not guaranteed to be included in time**.
4. PBTS time is **consensus time**, not exact client/UTC submission time.
5. A Byzantine proposer may **omit a bid** from its proposal.
6. A Byzantine proposer has **bounded timestamp flexibility** inside PBTS-valid rules.
7. Current live evidence is **single-host**, not yet WAN/multi-operator.
8. Arbitrary stale signer restoration or cloned active validator keys are **prohibited**.
9. Power-loss durability is hardened but **not experimentally proven**.
10. If app state gets ahead of retained CometBFT storage, the node **fail-stops and needs operator recovery**.
11. P0 uses **fake collateral only**.
12. **Cashu/Coco/SIG_ALL monetary security is a separate gate**.
13. PBTS **505 ms / 15 s** values are prototype defaults, not final production tuning.
14. Accepted wire JSON is not always byte-unique: one irrelevant exact-canonical zero/empty/null field may canonicalize to omission while canonical transaction identity remains stable.

## Evidence

The frozen P0 survived adversarial testing for:

- one validator offline;
- SIGKILL/restart;
- racing bids;
- global collateral conflicts;
- canonical winner derivation;
- anti-sniping boundaries;
- receipt reconstruction;
- replay/operation-ID ownership;
- malformed and ambiguous JSON/Unicode inputs;
- bounded block execution.

The final four-validator run converged with all validators caught up and matching app state.

## Real-money gate

**Accepting this ADR does not authorize real-money auctions.**

Before real value is enabled, a separate review must cover at minimum:

- safe SIG_ALL behavior with no vulnerable fallback;
- Coco-owned prepare/sign/execute lifecycle;
- exact refund and settlement binding;
- threshold monetary authorization where needed;
- crash/recovery and ambiguous mint responses;
- custody/authority boundaries;
- interoperability with the chosen Cashu stack;
- new A2/A3 monetary-security review;
- explicit human maintainer approval.

## Consequences

### Positive

- No single validator directly controls the winner.
- Plebeian does not build its own BFT protocol.
- Relay behavior cannot redefine canonical auction order.
- One unavailable validator does not stop progress.
- Monetary authority stays outside consensus.

### Negative

- Four validators are operationally heavier than one service.
- Two unavailable validators halt the auction.
- Only one Byzantine validator is tolerated.
- Last-second inclusion is not perfectly fair.
- Production still needs independent hosts/operators and real-money review.

## Maintainer decision requested

Approve this ADR only if maintainers agree with:

1. **4 validators / 3-of-4 / f=1** for the MVP;
2. **CometBFT** as the consensus engine;
3. commit-time, not click-time, bid acceptance;
4. the documented near-deadline fairness limitation;
5. Nostr as transport/audit rather than consensus;
6. independent validator failure domains before production claims;
7. a separate explicit gate before any real-money activation.
