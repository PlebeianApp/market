# ADR-0012: Structural bid validity, deterministic selection, and winner derivation under partial observation

## Status

Accepted (2026-09-17). This ADR amends AUCTIONS.md and
ADR-0003 and governs the auction bid lifecycle end to end.

This document supersedes the working draft circulated as `ADR-0020` (2026-09-09);
the substance is unchanged. It is renumbered to follow ADR-0011 and to sit with the
auction ADR set (ADR-0003, ADR-0004, ADR-0011). Revised 2026-09-13: the
settlement-window selection algorithm is now specified here (Phase 2, §2), and the
final phase is restated as the coordination boundaries for deriving a winner from a
partial view (Phase 3).

## Date

2026-09-09 (revised 2026-09-13)

## Context

Auctions on Nostr are decentralized by construction, and three properties of that
environment shape every decision in this document:

- **There is no global state.** Every participant — bidder client, seller, validator —
  observes the event graph partially and differently. No participant has the complete
  picture, and none ever will. The validator quorum exists precisely for this reason:
  correctness comes from consensus over independently derived verdicts, not from any
  single authoritative view.
- **Bids are real, locked capital.** A kind-1023 bid locks Cashu e-cash via P2PK until
  locktime. A verdict label does not move that money: locked funds sit until locktime
  regardless of what any validator says. Removing a funded bid from the valid set for
  the wrong reason does not release it — it only breaks the auction's promise to the
  bidder.
- **Bid amounts are claims, not facts.** The `amount` tag is self-declared by the
  bidder. Collateral verification arrives separately (ADR-0011 bid-time DLEQ proofs;
  settlement preflight). Amounts are usable as ranking input by default, but they must
  never be load-bearing for validity.

Against this backdrop, the current protocol makes a bid's **validity** depend on other
bids and on mutable per-validator state in three places: the leading-bid minimum
increment, the anti-snipe curve floor, and the replacement-chain walk over `prev_bid`
references. All three are verdict-level rules computed from state that two honest
validators can legitimately hold differently — which bids each has observed, which bid
currently leads, whether a referenced parent bid is resolvable. The consequences:

1. **Honest validators can disagree.** The condemn-quorum rationale assumes structural
   verdicts are deterministic; these checks break that assumption, so quorum can fail
   or, worse, flip.
2. **Verdicts churn.** As the leading bid changes, previously valid bids are
   retro-condemned — the verdict is a function of mutable state, not of the bid.
3. **The valid set loses real material.** A funded bid that was merely outbid gets
   condemned and can no longer win later, fall back, or refund cleanly through the
   normal loser path.

The motivation here is not exotic. Being outbid while in the process of bidding is the
ordinary case in any auction — every bidder will experience it, so the protocol must
treat it as a first-class scenario, not an error path. Two scenarios define the
requirement:

1. **The outbid bidder.** A bid that was valid when placed and is later outbid must
   remain in the valid set until close. It may lead again, it may win if higher bids
   later fail, and it must refund cleanly if it does not win.
2. **The griefed or failed leader.** The winning bid may grief — fail to release its
   settlement path, fail to redeem, or turn out to be fraudulent. The auction must
   still settle correctly, which requires the valid set to contain genuine fallback
   candidates. Validity must therefore discard none of them.

What a bid's validity _should_ be follows from the separation of concerns the
environment forces:

1. **Validity** (validators): is this bid structurally and rule-wise sound — a pure
   function of the bid event, the auction event, and observation time, plus the
   validator's published policy (opinion: scoring, blacklists, KYC). Deterministic per
   input. No third event, no other bid's state, no network fetch.
2. **Selection** (everyone): who leads and who wins — the economic rules (the minimum
   increment as the seller's advertised step, the anti-snipe curve, replacement chains)
   applied over the valid bid set by one shared deterministic algorithm.
3. **Derivation and fallback** (validators, seller, bidders): how a single winner is
   agreed under partial observation when the selected winner fails — quorum as the
   verifiable mechanism, elimination on settlement-window evidence, recomputation over
   what remains.

The current spec conflates (2) into (1). This ADR separates them, as a single
development plan in three phases.

## Decision

The plan is three phases. Phase 1 restricts the validator to what it can honestly
decide. Phase 2 builds the shared algorithm that applies the economic rules. Phase 3
fixes the coordination boundaries that make a winner derivable from an imperfect view,
with validators as the verifiable mechanism.

### Phase 1 — Validator role cleanup: structural-only validity

**Validity is a pure function of (the kind-1023 bid event, the kind-30408 auction
event, `observed_at`), plus the validator's published policy (kind-30441).** No third
event, no graph traversal, no fetch, no other bid's state.

- The **only** amount-based validity check is the absolute bid floor:
  `amount ≥ starting_bid`, rejected with `below_starting_bid`.
  `starting_bid` becomes a documented, REQUIRED auction tag. There is no
  protocol-fixed minimum sat value: fee coverage is mint- and network-dependent, so it
  is the seller's decision baked into `starting_bid`, with fee-aware client form
  defaults and validator policy MAY as the remaining enforcement surfaces.
- **`prev_bid` is declared linkage metadata.** Validators MUST NOT condition a verdict
  on the reference; an unresolvable `prev_bid` is never, by itself, grounds for
  condemnation. Chain integrity is a selection- and settlement-time concern.
- **Verdicts carry no ranking markers.** Any structurally valid bid is published as
  `valid_bid_placed`, whether or not it currently leads. A marker derived from mutable
  leading-bid state would re-import the churn this phase removes.
- Validators remain free to apply **policy** (blacklists, scoring, per-bidder floors)
  as published opinion in kind-30441 — attributable, deterministic per policy, and
  distinct from structure.

**Retired concepts — MUST NOT surface anywhere in the specification or the
implementation** (no reason codes, no verdict emission, no validation code paths, no UI
copy):

- `under_increment` (leading-bid minimum increment as a validity rule)
- `under_curve` (anti-snipe curve floor as a validity rule)
- `replacement_chain_invalid` as a verdict-time reason, including the chain-leg
  minimum check

Historical verdict events carrying the retired reasons keep their original meaning.

**Redundancy check — no external queries at verdict time.** Validators perform **no**
external state queries when issuing a bid verdict: no NUT-7 spend-state checks, no mint
calls, no relay fetches to resolve references. (NUT-7 spend-state ownership already
moved to the client under the settlement-descriptor amendment; this phase makes the
absence of validator-side external queries an explicit, tested invariant.) A verdict
that depends on fetching anything is convergence failure by another route.

### Phase 2 — The shared selection algorithm (settlement-window bid selection)

One functional algorithm: **given (the auction, the valid bid set, externally validated
timestamps), compute leadership, current price, and the winner.** Clients run it for
hints, current price, and winner display; validators run it at settlement to pick the
winning bid. Same rule, everywhere.

This hardens the baseline selection rules that AUCTIONS.md already states — the
tie-break rule in §8, the floor/curve formula in §6.1, and the validator duties in
§5.5 — into a single normative algorithm with a defined input/output contract, so that
specification and implementation cannot drift apart. It does not change the economic
rules; it fixes where they live and makes them executable.

#### 2.1 Inputs and outputs

**Inputs**

- the kind-30408 auction event (tags: `start_at`, `end_at`, `max_end_at`, `reserve`,
  `starting_bid`, `bid_increment`, `min_bid_curve`, `p2pk_xpub`);
- the valid bid set — kind-1023 bids marked `valid_bid_placed` by validator verdicts,
  each with its `amount`, `created_at`, `observed_at` (externally validated), event id,
  and optional `prev_bid`;
- the evaluation instant (close, or "now" for hints/current price).

**Outputs**

- the canonically ordered bid list;
- the running trusted top and the leadership-eligible set;
- the current floor (advisory display value);
- the winner at close, or `none` when the reserve gate is not met.

#### 2.2 The algorithm

Deterministic replay over the valid set, in canonical order:

1. **Canonical order.** Filter to bids whose `observed_at` lies within
   `[start_at, max_end_at]`, then sort by validated timestamp ascending, breaking ties
   by lexical event id. Bids with significant `timestamp_skew` are excluded from
   tie-breaking (per AUCTIONS.md §8).
2. **Replay, maintaining the running trusted top.** For each bid in order:
   - no top yet: eligible iff `amount ≥ starting_bid`;
   - flat window (`observed_at ≤ end_at`): eligible iff `amount > top.amount`. The
     increment is the seller's advertised step and a display hint; it is **not** a
     gate;
   - extension window (`end_at < observed_at ≤ max_end_at`): eligible iff `amount`
     clears the curve floor computed against the running trusted top —
     `floor(top, t) = baseline(top.amount) × multiplier(t)` per AUCTIONS.md §6.1, with
     the `BID_FLOOR_TIME_GRACE_SECONDS` lag tolerance and `baseline` falling back to
     `starting_bid` (not `reserve`) when there is no top.
   - On eligibility, the bid becomes the new running trusted top.
   - An ineligible bid is **valid but not leading**: it stays in the valid set, ranks
     by amount, holds its locked e-cash, refunds via the loser path, and becomes
     eligible again if a later elimination recomputes against a lower running top.
3. **Chain handling (selection-time only).** `prev_bid` linkage is walked here — for
   the bidder's own replacement chain, its accumulated commitment and chain integrity —
   and never in verdicts. Cross-bidder bids are independent: each locks its own
   collateral, and no selection rule consults another bidder's chain.
4. **Winner and reserve gate.** At close, the winner is the final trusted top, subject
   to `winner.amount ≥ reserve`; otherwise the auction closes `reserve_not_met`
   (ADR-0004 quorum rules apply).

`current price` is the floor for the next eligible bid derived from the trusted top at
the evaluation instant; it is advisory UI, and a compliant client MUST NOT hard-reject a
bid for sitting below an increment hint or the curve floor.

#### 2.3 Determinism and convergence

- **Determinism, precisely scoped:** same input data ⇒ same output. This is not a claim
  about global state — Nostr has none, and different participants observe different bid
  sets; quorum consensus over settlement is the mechanism that reconciles divergent
  views. The algorithm must simply never widen that divergence: its output depends only
  on its inputs, never on observation order, wall-clock, or mutable derived state.
- **Convergence is a test requirement:** the client-side selection and the validator
  settlement picker must be the same function (or provably equivalent), verified by
  property tests, so a bidder's client and the settling validators agree given the same
  observed data.
- **Elimination hook:** the algorithm recomputes over a reduced set, which is the
  mechanism Phase 3 relies on.

#### 2.4 Implementation notes

- Ship the algorithm as one pure module in `src/lib/auction` (e.g. `selection.ts`) with
  a single entry point `select(auction, bids, instant) → Selection`. No I/O, no store
  access, no clock reads inside it — timestamps and the instant are parameters.
- Replace the ad-hoc leadership proxies with this function: `pickWinningBid`
  (`lifecycle.ts:496–507`), `currentTopValidBidAmount` (`lifecycle.ts:581–597`), the
  client bid-fetch paths in `queries/auctions.tsx`, the UI current price, and the
  AuctionBidder hint.
- Property tests: convergence (client ≡ validator picker over the same input);
  sniper-exclusion (a sub-curve late bid is valid but not leadership-eligible);
  fallback-wins (an outbid bid can lead again after an elimination recomputes the
  running top); monotonic refund eligibility (no funded bid is dropped from the valid
  set by a selection result).
- **Accepted interim window:** between Phase 1 landing and Phase 2 landing, bids can be
  placed irrespective of the anti-snipe curve and minimum increments with no
  selection-side gate either. This is acceptable: the auctions feature is in
  development, pre-public release, and Phase 2 lands promptly after.

### Phase 3 — Coordination boundaries: deriving a winner under partial observation

The final phase is not a feature so much as the set of boundaries that make a winner
derivable at all when no participant holds the complete picture. Nostr has no global
state and no privileged observer: relays deliver events late, out of order, or not at
all, and each participant sees a different slice of the graph. The protocol must be
correct under that condition rather than assume it away.

**Validators are the primary verifiable mechanism.** The winner is never decided by the
seller's local view or by any single observer. Validators independently derive verdicts
and a settlement selection from their own observation; quorum agreement over those
independent derivations is the only settlement signal the protocol treats as
authoritative. A claim that quorum cannot corroborate is not a settled outcome.

**Boundaries — who decides what, on what evidence:**

- **Validity** is decided per-bid by each validator, from the bid, the auction, and
  observation time alone (Phase 1). It is deterministic per input, so independent
  validators over the same inputs agree.
- **Selection** is run by every participant from the same algorithm (Phase 2). It is
  reproducible, so a bidder's client and the settling validators reach the same
  leader and winner from the same observed data.
- **Derivation and fallback** is decided by quorum, from settlement-window evidence —
  never from a participant's private view. When the selected winner proves inactive or
  fraudulent, the protocol eliminates it on verifiable evidence, recomputes selection
  over what remains, and repeats until a genuine winner settles or a documented failure
  cascade completes.
- **Money movement** stays with the seller's client, gated by quorum; the protocol
  never routes settlement authority to a single party's unverified claim.

**The fallback/elimination protocol (future specification).** Objective: when the
selected winning bid proves inactive or fraudulent — the winner fails to release its
settlement path, its proofs are already spent, collateral verification fails — the
auction eliminates the offending candidate, recomputes the selection over the remaining
valid set, and repeats until a genuine winner settles or a documented failure cascade
completes. Constraints the future specification must satisfy:

- Elimination uses **settlement-window evidence** (proof spend states, DLEQ/verifier
  failures, non-release) — never verdict-time fetching.
- **Termination** is guaranteed: a bounded elimination loop with a defined end state.
- **Convergence:** all honest validators derive the same elimination sequence from the
  same evidence.
- Eliminated and losing bids **refund cleanly**; no locked capital is stranded by the
  protocol itself.
- The protocol must **not depend on self-declared amounts**: it builds on ADR-0011
  collateral verification and mint proof-state evidence.
- **Coordination** of timing, seller, bidder, and validator duties is specified
  event-by-event, composing with the existing seller-side fallback cascade.

The exact evidence standard and cascade surfaces remain deliberately deferred: nothing
in Phases 1–2 depends on their details, and until they are specified the existing
settlement cascade (AUCTIONS.md §8.2, ADR-0004) remains the coarse fallback.

## Downstream effects

The per-section edit map for Phase 1 is carried by the accompanying amendment
specification; this ADR fixes the direction:

- **AUCTIONS.md** — reason tables, validator duties, curve/baseline text, close duties,
  winner determination, and the required-tags list are amended; the retired reason codes
  are removed; §6.1/§8 gain a normative pointer to the Phase 2 algorithm; the selection
  algorithm itself is anchored (not restated) so the two documents cannot drift.
- **ADR-0003** — the financial-logic decision rows and the determinism promise are
  restated in the pure-function form; the reserve row is corrected (`reserve` is a
  close-time gate; it was never a bid-time check).
- **ADR-0004** — the settlement cascade is the composition point for Phase 3.
- **ADR-0011** — complementary: collateral verification makes "valid fallback bid"
  economically meaningful and supplies the elimination evidence Phase 3 consumes.
- **Clients** — hints and warnings remain advisory; a compliant client MUST NOT
  hard-reject a bid for being below the increment hint or the curve floor; bid-fetch
  paths feed selection, not validity.

## Alternatives considered

- **Keep increment/curve/chain as validity rules** (status quo): honest validators
  diverge, verdicts churn with leading-bid state, and the outbid / griefed-leader
  scenarios lose their material — the exact failure this plan exists to remove.
- **Validator markers for below-hint or sub-curve bids:** re-introduces
  mutable-state-derived churn on the verdict wire; ranking position is computable by
  any participant from the shared selection algorithm, so no consumer needs a badge.
- **A sequencing or coordination service to force determinism:** contradicts the
  architecture — there is no global state to sequence against. Quorum consensus over
  deterministic per-input verdicts is the design's answer to partial observation.
- **A privileged oracle that publishes the winner:** centralizes a decision the
  environment cannot support; quorum over independently derived selections replaces it.

## Consequences

**Positive.** Every remaining condemn reason converges across honest validators;
verdict churn disappears (the verdict lifecycle becomes monotone: valid → won or lost
→ settled/refunded); the valid set always contains the full fallback material for the
outbid and griefed-leader scenarios; one selection algorithm serves client and
validators, making "same data ⇒ same outcome" testable end to end.

**Costs and risks.** The interim window (Phase 1 before Phase 2) exposes sub-curve
leadership — bounded by the development phase. Sub-increment bids may legally lead in
the flat window ("nibbling"): mitigations are seller-set increments, client
suggestions, and validator policy, and every such bid still locks real capital until
locktime. Sellers who set a low `starting_bid` admit dust bids: that is their
fee-coverage decision, bounded by policy.

**Migration.** The new reason `below_starting_bid` appears; the retired reasons appear
only in historical events; mixed old/new validator fleets are handled by existing
quorum semantics (split verdicts do not form quorum), with pre-start auditor upgrades
recommended for live auctions; on upgrade, re-derivation may flip historical verdicts
of still-open auctions to valid, which operators must interpret per era.
