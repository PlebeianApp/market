# ADR Proposal: Auction V4V participation, validator gating, and the leg floor

## Status

**Proposed — records maintainer direction of 2026-09-21, awaiting focused approval**

## Date

2026-09-21

## Context

The auction V4V / multiparty payout feature has a frozen foundation (gates A–D1,
profile `cashu_p2pk_bidder_path_multiparty_v1`) and a proposed wire profile
(`auction-multiparty-wire-profile.md`) whose packet forbids production
implementation until D1–D12 are approved. Three encoding questions and one
economics question were unresolved, and the UI cannot be written until the
encoding is settled:

- recipients other than validators had no per-auction confirmation artifact;
- the relationship between multiparty validator participation (kinds 1028/1029/1030)
  and the existing per-bid verdict flow (kind 30440) was undefined;
- the minimum amount a bid-chain leg must lock was a single-recipient constant;
- ADR-0003's `v4v_recipient` tag encoding and the profile's canonical
  `payout_schedule` on the kind-30408 root described the same data differently.

The maintainer direction below resolves those four.

## Decisions

### D1 — The seller is the default recipient; multiparty is additive

An auction with no auxiliary entries remains on `cashu_p2pk_bidder_path_v1` (the
existing single-party profile) and pays the seller 100%. This is unchanged and
requires no new work.

### D2 — Recipients announce themselves with a standing capability (kind 1027)

Every potential recipient publishes a payout capability carrying `recipient_pubkey`,
`payout_xpub`, `payout_xpub_pop`, `mints`, `valid_from` and `expires_at`. Validators
publish the same thing plus an offer (kind 1028) that adds
`payout_capability_event_id`, `allocation_bps` and the service contract string. Both
validators and ordinary recipients use the **same underlying scheme**; the offer is
the validator-specific overlay, and it is where the validator states the share it
expects.

### D3 — The whole-xpub proof of possession stays

`payout_xpub_pop` is retained, and its purpose is recorded here because it was
questioned:

- it binds the announced xpub to the announcing Nostr identity, so a third party
  cannot advertise someone else's xpub and make that person's legs unspendable or
  unattributable (an impersonation and griefing vector otherwise);
- it is the only way a validator, a bidder or a client can check at release time
  that the child pubkey a leg was locked to really derives from the xpub the
  recipient announced;
- it proves control of the **account-level** key, not a derived leaf, which is why
  the reviewer note about key ownership applies (see Open questions).

Without it, "the funds were locked to a key derived from your xpub" is unverifiable.

### D4 — Recipients confirm per auction, on the same scheme as validators

Acceptance (kind 1029) is generalised from validator-only to **every scheduled
recipient**. A validator's acceptance additionally references its offer; a plain
recipient's acceptance references only its capability. Silence is not a
confirmation: an auction whose scheduled recipients have not confirmed is either
not activated or carries unconfirmed legs, and clients must show that.

### D5 — Validator participation gates auction validity, at quorum not totality

Validator verdicts (kind 30440) count only if the validator confirmed participation
in that auction. Rationale: a verdict from a validator that never announced
participation cannot be distinguished from a stale or unowned voice.

The gate is the **quorum**, not every configured auditor. Requiring all of them
would fail auctions over relay propagation differences — a client that cannot see
one validator's acceptance event may simply be reading a different relay set. With
quorum satisfied, a client can rely on seeing that set's verdicts.

### D6 — Clients and validators check participation at four points

1. **Auction publish (seller client)** — run the draft-time liveness check of D13 and
   block publishing while any scheduled entry is unconfirmed, rather than warning on
   unconfirmed acceptances alone.
2. **Auction read (any client)** — derive participation status and surface it.
3. **Before bidding (bidder client)** — a bid requires quorum participation; if it
   is missing, the bid control warns explicitly that the auction's configured
   validators have not announced participation and that bids may never become
   valid.
4. **Settlement (validators and clients)** — verify that the released derivation
   path derives, for **every** scheduled entry, the child pubkey the funds were
   locked to, using that entry's announced xpub.

### D7 — Grief is a missing or mismatched recipient leg at release

The existing grief concept is reused; no new state is invented. A release that
omits an announced recipient's leg, or whose derivation does not reproduce that
recipient's locked child pubkey, is **grief**. The griefed bid is not a valid
winner. Fallback settlement behaviour is **not** defined here and is explicitly
deferred; what is required now is that validators emit grief in their verdict
(claim `griefed` / `griefed_pending_fallback`) and that clients, especially the
seller client, flag it.

### D8 — Derivation model: one shared path, per-recipient xpub

The model is the existing single-party model, extended: each scheduled entry
announces its own `payout_xpub`; the bidder derives **one child per entry** from
that entry's xpub using the **same shared derivation path**; the path stays secret
until release. Nothing new is required mathematically. What the profile defers, and
what D2/H must now specify, is the **encoding**: where the shared path and the
per-entry children are carried in the bid manifest and in the path release, and
how a recipient learns the path. That remains open work, not an open model.

### D9 — The leg floor is a client policy, not a protocol rule

The floor stays a client policy. It is applied **per payout leg per bid increment**,
not once per bid:

```
payout_legs        = 1 (seller, always) + scheduled auxiliary entries
fee_reserve_sats   = estimated inbound fee + (payout_legs x estimated swap fee)
minimum_bid_sats   = (payout_legs x leg_floor_sats) + fee_reserve_sats
```

with `leg_floor_sats` defaulting to the current 10. Five recipients therefore
require a minimum bid of 60 sats before fees, not 10. This is deliberately not
proportional to the split: the floor exists to keep every leg above mint and proof
edge cases, and the excess sats simply stay with the seller as the residual.

The floor is applied to _legs_, so the same rule governs rebid deltas.

### D10 — The bidder pays the extra outputs

The bidder funds the additional legs and their fees; each leg is not silently
reduced. Total bid cost therefore rises with recipient count, and the funding
dialog must show it. A per-mint fee estimate (NUT-02 `input_fee_ppk` and any mint
minimum) is **future work**; until then the existing conservative padding
(`getAuctionDepositFeePadding`, 0.5% clamped to 5–100 sats) is reused, and the
reserve is computed from it.

### D11 — ADR-0003 is superseded for the auction case

ADR-0003 is auction-scoped (splits as `['v4v_recipient', pubkey, bps]` tags on
kind-30408, seller as remainder, set at creation). Its _intent_ — splits on the
auction root, seller residual, set at creation — is kept, and its bps unit and
seller-remainder arithmetic agree with the profile.

Its **encoding** cannot be authoritative for the multiparty profile, because the
schedule must additionally bind, per entry, an exact payout-capability event ID, a
role, and for validators an exact offer event ID — none of which a
`(pubkey, bps)` tuple can express, and all of which the canonical
`payout_schedule` + `payout_schedule_commitment` on the root already carry.

**Harmonisation: none. The tag is discarded outright.** An earlier draft proposed
keeping `['v4v_recipient', '<pubkey>', '<bps>']` as a non-authoritative display
mirror. Maintainer direction of 2026-09-22 drops it entirely, for two reasons:

- a tag that looks authoritative but is not will eventually be parsed as if it were;
- no auction ever carried a real V4V participation under that encoding, so nothing
  depends on it and there is nothing to migrate.

Implementations MUST NOT emit `v4v_recipient` tags. The authoritative form is the
`payout_schedule` blob plus `payout_schedule_commitment` on the root. Products keep
their own encoding (kind 30078, percentages); the auction form is basis points.

### D12 — Auto-settlement is deferred

Recipient and seller auto-settlement (issues #1327 and #1328) are **not** built now.
Participation stays manual; the presence/announcement machinery from #1328 is
deferred with it. This is a staging-phase decision: keep the logic lean.

### D13 — A draft-time liveness check is a client obligation, not a protocol rule

Before an auction is published, the seller's client **must** check that every
scheduled entry — validators and V4V recipients alike — is reachable and willing to
take part, and must surface the result before publishing. An entry that cannot be
confirmed is reported to the seller with its pubkey, and publishing is blocked by
default while any entry is unconfirmed (the seller may override, and the override is
recorded in the publish flow).

This is deliberately **not** a protocol requirement:

- nothing on the wire mandates a liveness signal, and no new event kind is
  introduced for one;
- a third-party client that skips the check produces a still-valid auction, it
  simply publishes one more likely to have dead legs;
- the check exists because auctions are time-sensitive and live: fixing a
  dead-leg auction after publication means re-publishing the root, which changes
  the schedule commitment that bidders' locks are bound to.

The check is therefore an obligation on our client, enforced at the point where it
is cheap, and it must be explicit in the UI rather than silent.

### D14 — One shared client wording per state

An under-confirmed auction is a single state with a single explanation. Every surface
that has to describe it — the publish screen, the auction page, the bid button, the
validator service — **must** use one sentence, owned by one function:

> Configured _N_ validator(s) with quorum _X_, only _Y_ confirmed (_Z_ not seen).
> Bids may never become valid.

The owner is `describeBidBlock` in `src/lib/auction/multipartyParticipation.ts`,
which owns the participation state; the four check points in
`src/lib/auction/multipartyCheckPoints.ts` delegate to it through
`describeValidatorShortfall`. The sentence is gated on the participation **status**,
never on the derived `bidAllowed` flag, so no caller can silence it by passing an
inconsistent object.

Two reasons this is a decision rather than an implementation detail:

- the same state described differently on two surfaces reads as two different
  problems, and the bidder is the one who pays for that confusion;
- the sentence is the client's only lever on this state, so it is the one place
  where the wording is worth fixing by spec.

### D15 — Quorum is a strict majority of the validator pool

A bid outcome is accepted only when confirmed by **more than half** of the
auction's validators: `floor(P / 2) + 1` **distinct** auditor pubkeys, where `P`
is the number of distinct pubkeys in the auction's `auditors` tags. The seller's
declared `auditor_quorum` may only **raise** this requirement, never lower it; a
declared value below the floor is raised to the floor and reported
(`quorum_below_majority` / `declaredBelowMajority`).

The reason is consensus safety. With a four-validator pool and a declared quorum
of two, validators `{A,B}` can confirm a bid while `{C,D}` condemn the same bid,
and _both_ results satisfy the quorum. An auction with two "valid" outcomes has no
canonical winner, and every downstream read — ranking, display price, winner
derivation, settlement, grief classification — becomes ambiguous. Two disjoint
sets cannot each exceed half of a pool, so a majority floor removes the fork by
construction.

Recorded normatively in `AUCTIONS.md` §4.1 and `docs/adr/ADR-0003-…` Appendix D.
Implemented once, in `src/lib/auction/verdictMajority.ts`, and consumed by both
the verdict tally and the participation gate so the two cannot drift.

Consequences that shape the product rules:

- **Pool size is a real trade-off, and the count alone does not describe it.**
  `P = 2` forces unanimity: one unavailable validator stalls the auction. `P = 3`
  (floor 2) is the smallest pool that is both fork-proof and tolerates one
  absence. A rule of "at least 2 validators" is therefore incomplete — it must be
  stated with the quorum.
- **Preferred mandate: at least 3 validators, odd where possible**, minimum 2.
  Mandating 2 gives availability only if the quorum were 1, which the majority
  floor forbids.
- **Grandfathering: single-validator auctions keep working.** `P ≤ 1` has floor 1,
  so every auction already published behaves exactly as before; the mandate and
  the floor apply to auctions that declare more than one validator. Blocking
  existing auctions on the day this ships would invalidate live sales for a rule
  their sellers never had the chance to meet.

### D16 — A leg is locked one swap per row, and no mint call is atomic across rows

A multiparty leg is **one output per manifest row**, and cashu-ts `SwapOptions.p2pk` takes
**one** lock configuration per call (`pubkey: string | string[]` is the n-of-m multisig form,
not a per-output key map — cashu-ts 2.9.0, `lib/types/model/types/index.d.ts`). No single mint
call can lock every row to its own child key, so a leg's construction is **N swaps at one
mint**, in manifest index order:

- each row's swap locks that row's amount to that row's **compressed** child key, carrying the
  same `locktime` and the same per-leg `refundKeys`;
- the rows must each be fundable from a **disjoint** subset of the leg's input proofs, and that
  partition is settled _before_ the first swap is sent — a row that cannot be funded is a
  refusal, never a partial lock;
- a failure between rows leaves a **partially locked leg**. That state is inherent to the
  construction rather than a defect to be hidden, and it is why the leg's pre-lock recovery
  record carries every row (compressed key, x-only projection, path, amount) under the leg's
  single refund authority, why each row's returned proofs are verified against **that row's own
  key** before anything is published, and why a leg whose rows do not all come back is reported
  as incomplete instead of published short.

Multi-mint legs stay deferred (gates E/F): one mint per leg until that is decided.

Recorded normatively in the manifest profile's verification section
(`docs/protocol/auction-multiparty-manifest-v1.md` §6), which is the same set of checks applied
here on the near side of the mint call.

### D17 — The construction journal holds the sequence, not the keys, and an attempt precedes the request

Because a leg is N swaps (D16), the state that has to survive a crash is _which rows were sent_.
Two records split that work and neither duplicates the other:

- the **recovery record** (D16) protects the key material — each row's compressed child key, its
  projection, its path, its amount — under the leg's one refund authority;
- the **construction journal** protects the sequence: per row, whether it is `planned`, `attempted`,
  `locked`, `failed_pre_mint` or `uncertain`. It is keyed by the same refund authority and stores
  **no proofs and no keys**, so it is a second store, never a second spendable-proof authority.

The rule that makes recovery possible: `planned → attempted` is written with **confirmed-write
semantics before the swap is sent**, and there is no transition back. An attempted row is **never
sent again** — a swap whose outcome is unknown may already have consumed its inputs, so a retry
either double-spends them or locks the same amount twice. A row whose outcome cannot be determined
stays `uncertain`, and the leg's verdict is then `uncertain` rather than `partial`, because claiming
"partial" would assert that the unknown row is not locked.

Resolution is **evidence, and only evidence**: proofs (verified against that row's own key before the
row may be called locked), a failure proved to precede the mint call, or nothing — and nothing leaves
the row uncertain. Silence is not evidence of failure, nor of success.

The verdicts are `complete`, `partial`, `unsent` and `uncertain`, one sentence each (D14), and the
summary names the locked rows, because on a partial leg those are exactly the ones a refund branch
can reclaim once the locktime opens.

## Consequences

- The UI can be written against one encoding: the schedule, with capabilities and
  offers referenced by event ID.
- A bid can be refused before money moves whenever quorum participation is absent,
  which is the cheapest possible place to catch a dead auction.
- Recipients gain a confirmation obligation that is symmetric with validators, at
  the cost of one more event per recipient per auction.
- The seller's client gains a draft-time liveness obligation (D13) before publishing,
  which needs no protocol support but does need a reachability probe per scheduled
  entry.
- `v4v_recipient` tags are never emitted, so there is no second encoding to keep
  honest in review or to migrate later.
- A multiparty leg costs **one swap per row** and its construction is not atomic
  across rows (D16); a partial lock is handled by the per-row recovery record and
  per-row verification rather than prevented.
- A pending leg therefore occupies **two stores** (the record and the journal), each
  fail-closed at its own bound (D17); whether they should share one budget is open.

## Files affected

- `docs/adr/proposals/adr-0003-v4v-splits-on-30408.md` — supersede the encoding outright, keep the intent.
- `docs/adr/proposals/auction-multiparty-wire-profile.md` — record D4–D7 and D9–D10.
- `src/lib/auction/multipartyLegFloor.ts` — the per-leg floor (landed with this proposal).
- `src/lib/auction/multipartyParticipation.ts` — participation and quorum status (landed with this proposal).
- `src/lib/auction/multipartyPublishReadiness.ts` — the draft-time liveness obligation (landed with this proposal).
- `src/lib/auction/multipartyLegSwapPlan.ts` — the per-row swap requests and the disjoint input partition (D16).
- `src/lib/auction/multipartyLegLockOutcome.ts` — per-row verification of what the mint returned (D16, manifest §6).
- `src/lib/auction/multipartyRecoveryRecord.ts` — the multi-row pre-lock recovery record (D16).
- `src/lib/auction/multipartyLegJournal.ts` — the construction journal: per-row sequence state, the attempt-before-request rule, and reconciliation against evidence (D17).
- Later: the auction root tag builder, the bid manifest (Gate D2), the path release (Gate H), the validator service, and the auction detail UI.

## Open questions

- **Key ownership for the PoP.** The verifier uses the xpub's internal x-only key, so
  a recipient must be able to sign with the account-level master. If that is
  intended, it should be stated in the capability; if not, the expected derivation
  and signer must be defined. (Reviewer finding, still open.)
- **Capability window.** `valid_from > root.start_at` currently rejects late-issued
  capabilities. With recipients registering on their own schedule, the intent needs
  restating: either require only `expires_at >= max_end_at`, or document the
  exclusion.
- **Liveness signal.** D13 fixes the obligation, not the mechanism: what the probe is
  (a direct message, a capability read with a fresh timestamp, a presence event), its
  timeout, and how many retries count as unconfirmed. Deferred with D12 but needed
  before the pre-publish screen can be built.
- **Fee estimation.** Per-mint NUT-02 `input_fee_ppk` estimates and mint minimums,
  to replace the padding heuristic in D10.
- **Fallback settlement.** Undefined, intentionally deferred with D7.
