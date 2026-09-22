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

1. **Auction publish (seller client)** — warn or block when scheduled recipients
   have not confirmed.
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

Harmonisation, so that product and auction read similarly without weakening either:
the `v4v_recipient` tags may be emitted as a **non-authoritative display mirror**
alongside the schedule, clearly documented as never parsed for authorization. The
authoritative form stays the schedule blob and commitment. Products keep their own
encoding (kind 30078, percentages); the auction form is basis points.

### D12 — Auto-settlement is deferred

Recipient and seller auto-settlement (issues #1327 and #1328) are **not** built now.
Participation stays manual; the presence/announcement machinery from #1328 is
deferred with it. This is a staging-phase decision: keep the logic lean.

## Consequences

- The UI can be written against one encoding: the schedule, with capabilities and
  offers referenced by event ID.
- A bid can be refused before money moves whenever quorum participation is absent,
  which is the cheapest possible place to catch a dead auction.
- Recipients gain a confirmation obligation that is symmetric with validators, at
  the cost of one more event per recipient per auction.
- The `v4v_recipient` tag survives only as a display mirror, so nothing may parse
  it for authority — a rule that must be enforced in review.

## Files affected

- `docs/adr/proposals/adr-0003-v4v-splits-on-30408.md` — supersede the encoding, keep the intent.
- `docs/adr/proposals/auction-multiparty-wire-profile.md` — record D4–D7 and D9–D10.
- `src/lib/auction/multipartyLegFloor.ts` — the per-leg floor (landed with this proposal).
- `src/lib/auction/multipartyParticipation.ts` — participation and quorum status (landed with this proposal).
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
- **Confirmation window.** Whether an unconfirmed recipient should block activation
  (a pre-open confirmation window) or merely be marked unconfirmed at release.
- **Presence.** Whether a draft-time liveness check replaces the heartbeat entirely,
  and what event carries it. Deferred with D12.
- **Fee estimation.** Per-mint NUT-02 `input_fee_ppk` estimates and mint minimums,
  to replace the padding heuristic in D10.
- **Fallback settlement.** Undefined, intentionally deferred with D7.
