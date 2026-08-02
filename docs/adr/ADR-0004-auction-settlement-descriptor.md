# ADR-0004: Unified Auction Settlement Descriptor with Participant-Role Enumeration

## Status

Proposed

## Date

2026-08-02

## Context

The auction settlement UI shows a "settlement-step card" to each participant
in an ended auction — telling them what to do next (release a path, submit
shipping, close the auction) or what happened (you won, you were outbid, the
auction expired). The current implementation uses a boolean-input state
machine that takes 14 flat booleans and scalars and returns a partial
descriptor. The view then runs a second `switch` over the state ID to fill in
the missing fields (icon, button handler, bid amount).

This design has three structural problems:

1. **Participant identity is three independent booleans, not a role.**
   `isSeller`, `isMyBidTop`, and `isWinner` are passed as separate flags with
   no single "who is the viewer to this auction" concept. A self-bidding
   seller hits the bidder's "release your path" branch. A non-participant and
   an outbid bidder are indistinguishable (all three false → blank card).

2. **Participant-agnostic branches shadow participant-specific ones.** The
   `reserve-not-met-refund` and `settlement-expired` branches fire for
   everyone regardless of role, intercepting the seller before the seller's
   own branches are reached. The seller sees the bidder's "Refund Ready" card
   — the seller does not get a refund — and gets trapped by "Settlement
   Expired" with no close-auction button even when the reserve was not met.

3. **The descriptor is partial, forcing a parallel view-side switch that
   drifts.** Copy, tone, and bid amount live in two places with no sync
   mechanism. The griefed original winner — whose settlement names a fallback
   bidder — falls through every branch to a blank card because the machine
   has no state for "you were superseded; your proofs refund at locktime."

## Decision

Replace the boolean-input state machine and the view's parallel switch with a
single pure descriptor function that classifies the participant into an
enumerated role and returns the complete renderable descriptor. The function
lives in `src/lib/auction/`.

### Role-first dispatch

The viewer's relationship to the auction is a single enum, computed up front:

- **`seller`** — the auction author
- **`winning-bidder`** — the validated top bid is mine
- **`fallback-top-bidder`** — settlement names me but I am not the validated
  top bid (reserved; see below)
- **`outbid-bidder`** — I placed a validated bid but am not the top
- **`non-participant`** — none of the above

Every state lives under a `switch (role)`. A state that should only appear
for bidders cannot fire for the seller by construction. This eliminates the
participant-agnostic shadowing bugs.

### Complete descriptor

The function returns everything the view needs: title, message, tone, icon
key, CTA kind + payload, bid amount, and verification badge. The view carries
no per-state copy — it maps icon keys to components and CTA kinds to handlers
via flat registries. Copy lives in one place.

### Pure function with injected clock

The function takes parsed events (auction, bids, settlements, path releases,
claim orders), the current user's pubkey, wallet-local flags, and a `now`
timestamp. No React, no queries, no `Date.now()`. The view assembles the
input from hooks and feeds a ticking clock (`useNow`, 1-second interval) so
time-sensitive transitions (settlement window expiry, refund-ready) fire
without depending on query refetch.

### Optimistic UI as data

After a successful path-release publish, the view appends a synthetic
path-release event to the input array. The descriptor sees it and transitions
immediately to "path released." No boolean flag; no stuck-on-failure state.
The synthetic event is dropped when the real event arrives on refetch.

### Cards for all participants

All participants see a settlement card, not just the seller and winner:

- An **outbid bidder** sees "You were outbid" with the top bid amount, and
  can track the settlement window ("window closes in N minutes") and outcome
  ("this auction settled at X sats").
- A **winning bidder** who was superseded by a fallback sees "Settlement went
  to fallback — your proofs refund at locktime," not a blank card.
- A **non-participant** sees nothing.

### Reserved fallback-top-bidder role

The kind-1026 fallback offer flow is not yet implemented. The
`fallback-top-bidder` role is declared in the type surface so the
architecture accommodates it, and minimum recognition is wired: a settlement
that names a non-top bidder as winner classifies that user as
`fallback-top-bidder` so they do not get a blank card. Full kind-1026
offer/accept UX is a follow-up.

### Verification badge

The badge is a descriptor field, derived from the same validated data as the
state. It confirms "settlement confirmed" or "path release confirmed."
Distinguishing a fallback settlement from a normal one is a state-level
concern, not a badge-level one — deferred until the fallback flow lands.

### Dashboard adoption

The dashboard route's parallel settlement UI (which uses raw, unvalidated
events) adopts the same descriptor function after the public view has shipped
on it without seller-side regression. This is a follow-up PR, not part of the
initial migration.

## Consequences

Positive:

- Participant-agnostic shadowing is structurally impossible — every state is
  role-gated.
- Copy, tone, icon, CTA, and bid amount live in one place; the view's parallel
  switch and its drift risk are removed.
- The descriptor is unit-testable as a `(role × phase)` matrix; impossible
  combinations (e.g. seller + winner) are unrepresentable in tests.
- The griefed/superseded winner and the fallback-named winner both get
  meaningful cards instead of blank ones.
- Outbid bidders and all participants get settlement tracking, not just the
  seller and winner.
- The `fallback-top-bidder` role is reserved, so the future kind-1026 flow
  lands without restructuring the descriptor contract.
- Optimistic UI and clock-freeze failure modes are eliminated by modeling them
  as input data and an independent clock.

Trade-offs:

- The descriptor function is larger than the old state machine because it owns
  role classification, phase classification, and copy. This is intentional:
  complexity moves from the untestable, duplicated view to a testable, singular
  function.
- The `fallback-top-bidder` role carries states that no code path assigns yet
  — deliberate forward-compatibility.
- Until the dashboard route adopts the descriptor, two settlement UIs coexist
  with different validation postures. The ADR sequences the dashboard switch as
  a follow-up to avoid seller regressions.

## Alternatives considered

**Patch the boolean machine with participant guards.** Rejected. Adding
`isSeller` / `!isSeller` guards to the unguarded branches fixes the immediate
bugs but not the root cause — three booleans for one concept. The same class
of bug recurs on every new branch.

**Return JSX from the function.** Rejected. Per AGENTS.md, the function must
stay free of UI/DOM imports. Icons are enum keys; the view maps them.

**Wrap the descriptor in a TanStack Query hook.** Rejected. The descriptor is
pure derivable state from already-validated query data. A query wrapper would
duplicate the cache surface and blur the query-state vs UI-state boundary.

**Collapse the booleans into a role but keep the partial descriptor and view
switch.** Rejected as a half-measure. It fixes the shadowing but leaves the
duplicate switch, copy drift, missing states, and optimistic/clock failure
modes.

## Related

- ADR-0003: Auctions Comprehensive Validation Protocol (the #1170 validators
  the descriptor consumes)
- Protocol spec: `AUCTIONS.md` §4.3–§4.5, §8–§9 (settlement, path release,
  fallback, griefing)
- Implementation handover: `docs/handover/settlement-descriptor-handover.md`
