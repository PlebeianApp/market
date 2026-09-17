# ADR-0012 · Chunk 1 — Amendment Specification (Phase 1 + issue #1315)

**Status:** applied — Phase 1 · **Owner:** Franchovy · **Base:** `auctions` (applied to `8c634c15`) · **Prepared:** 2026-09-17
**Source of truth:** `docs/adr/ADR-0012-bid-validity-selection-and-winner-derivation.md` (Phase 1, on `auctions`, merged via #1314)
**Amends:** `AUCTIONS.md`, `docs/adr/ADR-0003-auctions-comprehensive-validation-protocol.md`, and the validator implementation
**Closes:** #1315 (folded in — see §8 D2)
**Carried by:** this PR — the normative edits mapped in §3/§4 are applied to `AUCTIONS.md` and `docs/adr/ADR-0003-auctions-comprehensive-validation-protocol.md`; §5 line references are against the pre-change base tree, so they are navigation aids rather than current line numbers.

> ADR-0012 states: _"The per-section edit map for Phase 1 is carried by the accompanying amendment specification."_ That document did not exist. **This is it.**

---

## 0. High-level goal

Today a bid's **validity** depends on _other bids_ and on _mutable per-validator state_: the leading-bid minimum increment, the anti-snipe curve floor, and a walk over `prev_bid` references. Two honest validators can hold different views of the same bid (different arrival order, different relay visibility) and therefore publish **different verdicts for the same bid**. That breaks the whole point of a validator quorum, and it retro-condemns funded bids — so an outbid bidder's locked money can be thrown out of the valid set for no structural reason.

**This chunk makes validity a pure function of three things only: the bid event, the auction event, and the moment the validator observed it.** No other bid. No network call. No mutable state. Same inputs ⇒ same verdict, for every honest validator, always.

Everything economic — who leads, current price, who wins — moves out of validity and into the **selection** step, which every participant runs from the same algorithm (that is Phase 2; this chunk only prepares the ground by removing the economic rules from the verdict path).

**Plus:** the `starting_bid` tag becomes a real, documented, REQUIRED auction tag (it exists only in code today and the spec still documents the wrong baseline), so the one remaining amount check — `amount ≥ starting_bid` — is checkable against a documented field.

### What changes for a user, in one line

- Outbid bids stay valid. They can lead again, win later, or refund cleanly.
- An unresolvable `prev_bid` no longer condemns a bid.
- Validators stop watching the mint and the auction graph to decide validity, so their verdicts converge.
- Sellers must always publish `starting_bid` — no more silent 10-sat floor, and the spec stops telling implementors to use `reserve`.

### What deliberately does **not** change

- `reserve` stays exactly what it is: a **close-time** winner gate. It was never a bid-time check.
- Validator **policy** (blacklists, scoring, KYC, published as kind-30441 opinion) stays — it is attributable opinion, not structure.
- The minimum increment and the anti-snipe curve remain real, but as **advisory display hints** (`current price`) and as **selection-time** rules, not as gates that can invalidate a bid.

---

## 1. Normative requirements

Each requirement is independently verifiable. R-numbers are the contract the reviewer checks against.

**R1 — Validity is a pure function of its declared inputs.**
`validateBid` accepts exactly `{ auction, bid, observedAt, policy? }`. The following inputs are removed from `ValidateBidInput`: `currentTopBid`, `bidChainLegAmount`, `bidChainValidation`, `nut7State`, `nut7ProofStates`, `skipNut7Check`.
_Verification:_ type-level — the input interface has exactly four members; no call site passes the removed keys.

**R2 — The only amount-based validity check is the absolute floor.**
Step 5 of the pipeline becomes a single comparison against the auction's declared starting bid: a bid is rejected with the new reason `below_starting_bid` iff `bid.amount < auction.startingBid`.
There is **no** protocol-fixed minimum sat value in the verdict path: neither `AUCTION_MIN_BID_SATS` nor `AUCTION_MIN_BID_LEG_SATS` nor `bid_increment` may appear in it.
_Verification:_ unit tests; plus a source-level assertion that `validation.ts`'s amount step contains no increment/curve/constant term.

**R3 — `computeBidFloor` leaves the verdict path.**
The function survives (the curve maths is Phase 2's input and the display hint's basis), but nothing in the verdict path calls it, and its documented baseline falls back to `starting_bid`, never `reserve`.

**R4 — `prev_bid` is linkage metadata only.**
No verdict may be conditioned on `prev_bid`. An unresolvable, cyclic, or missing parent is **not** grounds for condemnation. The verdict-time chain block and its reason (`replacement_chain_invalid`) and its chain-leg minimum check are removed. Chain integrity becomes a selection/settlement concern.
_Verification:_ a bid with an unresolvable `prev_bid` receives `valid_bid_placed`.

**R5 — No external state queries at verdict time.**
The verdict path performs no mint calls, no NUT-7 spend-state lookups, no relay fetches. The NUT-7 step is deleted from `validateBid` (it is already unreachable — both call sites pass `skipNut7Check: true`), not merely skipped.
_Verification:_ the ADR's zero-external-call test — `fetch` is stubbed to throw for the duration of a verdict derivation.

**R6 — Verdicts carry no ranking markers.**
Any structurally valid bid publishes `valid_bid_placed`, whether or not it leads. No verdict-shaped output gains a ranking field.
_Verification:_ a bid below the current top (but ≥ starting bid) still yields `valid_bid_placed`.

**R7 — The retired concepts do not surface.**
`under_increment`, `under_curve`, and `replacement_chain_invalid` are removed from the emittable reason set. They do not appear in the specification, in validation code paths, in verdict emission, or in UI copy. They remain **readable** on the read path so historical verdict events keep their meaning: the reason type stays wide enough to parse them; the emittable set does not contain them.

**R8 — `starting_bid` is REQUIRED and enforced.**

- The parser rejects a kind-30408 auction that omits `starting_bid` — a hard, structured parse failure, no silent `?? 0` fallback.
- The tag builder emits it unconditionally and rejects a builder call without it.
- `AuctionEventSchema` keeps `startingBid: nonNegativeInt` (a seller MAY set `0`; there is no protocol-fixed minimum — fee coverage is the seller's decision).

**R9 — Reserve is a close-time gate only.**
`pickWinningBid`'s `bid.amount < auction.reserve` gate is unchanged and remains the only reserve check in the protocol. No bid-time reserve check is added.

---

## 2. Deliverable shape

- **One PR** against base `auctions`, containing the specification amendment (AUCTIONS.md + ADR-0003) **and** the implementation, as two separately reviewable commits (docs commit, then code commit).
- **Authored as `maxime-tt`**; branch pushed to the `maxime-tt/market` fork; PR opened with base `auctions`.
- `.github/workflows/` is not touched (the bot token has no `workflow` scope). Consequence stated in §9.

---

## 3. Spec amendment — `AUCTIONS.md`

| #   | Anchor                                                                                     | Current text                                                                             | Required change                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | §3 Required tags (`### Required tags`)                                                     | `starting_bid` absent                                                                    | Add `starting_bid`: unix-sat-free integer, **sats**, absolute floor for any bid on this auction; REQUIRED in v1; may be `0` (seller's fee-coverage decision — there is no protocol-fixed minimum); is the zero-top baseline for §6.1 |
| A2  | §3 `reserve` entry                                                                         | "_minimum acceptable final price (may be `0`, but tag required in v1 for explicitness)_" | Add the disambiguator: reserve is a **close-time winner gate only**, never a bid-time floor                                                                                                                                          |
| A3  | §4.1 optional-tags, floor prose (≈L195–196)                                                | `baseline = top_bid === 0 ? reserve : top_bid + bid_increment`                           | `baseline = top_bid === 0 ? starting_bid : top_bid + bid_increment`                                                                                                                                                                  |
| A4  | §4.2.1 rebid chain (≈L394, L474)                                                           | `replacement_chain_invalid` presented as a verdict break                                 | Reframe: `prev_bid` is declared linkage metadata; chain integrity is selection/settlement-time; **not** a verdict input                                                                                                              |
| A5  | §4.4.1 verdict event reason enum (≈L698)                                                   | enum includes the three retired reasons                                                  | Remove the three; add `below_starting_bid`                                                                                                                                                                                           |
| A6  | §4.4.3 claim taxonomy (≈L766–846, table ≈L822–832)                                         | defines `under_increment`, `under_curve`, `replacement_chain_invalid`                    | Delete those three rows; add `below_starting_bid` = `bid.amount < auction.starting_bid`                                                                                                                                              |
| A7  | §5.5/5.6 validator live duties (≈L1081–1123, esp. L1097)                                   | validator _must enforce_ `bid_increment` + the curve floor                               | Retire: advisory only (display hint); a compliant client MUST NOT hard-reject a bid for sitting below an increment hint or the curve floor                                                                                           |
| A8  | §6.1 bid floor / curve (≈L1254–1308; L1260 `rejecting under_curve`; L1265, L1272 baseline) | curve floor enforced by validators as a validity rule; baseline `reserve`                | Restate as **selection-time** rules over the valid bid set; baseline falls back to `starting_bid`; add a normative pointer to ADR-0012 §2 (Phase 2) as the anchor, not a restatement                                                 |
| A9  | §7.1 pipeline, normative (≈L1374–1423, flowchart L1393)                                    | `Reject: under_increment / under_curve`                                                  | Redraw: the amount branch is a single `amount < starting_bid ⇒ below_starting_bid` check; remove the curve/increment reject nodes                                                                                                    |
| A10 | §7.1 step prose (≈L1471)                                                                   | validator requires high-bid + `bid_increment`                                            | Retire from the verdict path                                                                                                                                                                                                         |
| A11 | §8.0 who computes the winner (≈L1604–1619)                                                 | prose                                                                                    | Add the normative pointer to the Phase 2 selection algorithm                                                                                                                                                                         |
| A12 | §8.1/8.2 close duties (≈L1620–1700)                                                        | —                                                                                        | Confirm in text that reserve is a **close-time** gate only                                                                                                                                                                           |
| A13 | §9.1.1 unverifiable-at-bid-time (≈L1824–1857)                                              | known gap                                                                                | Cross-reference ADR-0011 (DLEQ-verifiable mints). **Not closed by this chunk** — restated as such                                                                                                                                    |
| A14 | §12 Open decisions (≈L2103–2120)                                                           | list                                                                                     | Close the ones Phase 1 settles; retain the Phase 3 ones                                                                                                                                                                              |
| A15 | §13 Compliance checklist (≈L2121–2369)                                                     | —                                                                                        | Align with the new reason set and the REQUIRED `starting_bid` tag                                                                                                                                                                    |

**Historical-compatibility clause** (added once, in §4.4.3): verdict events carrying the retired reasons keep their original meaning. Emission stops; readability does not.

---

## 4. Spec amendment — `docs/adr/ADR-0003-…validation-protocol.md`

| #   | Anchor                                                         | Current                                                      | Required change                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Context / determinism promise (≈L196)                          | "structural invalidity is deterministic"                     | Restate in the pure-function form: pure in (bid, auction, observed_at) + published policy                                                                                 |
| B2  | B §2.4 `validateBidAmount` (≈L256–264)                         | signature takes `topBid, observedTime`                       | Drop `topBid`; pure in (bid, auction, observedAt)                                                                                                                         |
| B3  | B §2.4 F2.1 row (≈L260)                                        | `amount >= reserve` → `below_reserve`                        | **Never implemented** — `below_reserve` appears nowhere in `src/`. Replace with `amount >= starting_bid` → `below_starting_bid`; record that reserve is a close-time gate |
| B4  | B §2.4 F2.2 row (≈L261)                                        | `amount > topBid.amount + bid_increment` → `under_increment` | Retired                                                                                                                                                                   |
| B5  | B §2.4 F2.3 row (≈L262)                                        | `amount >= curve_floor(t)` → `under_curve`                   | Retired                                                                                                                                                                   |
| B6  | B §2.5 `validateRebidChain` (≈L265–275, R2.2–R2.5 at L270–273) | verdict-time chain rules                                     | Moved to selection/settlement                                                                                                                                             |
| B7  | B §2.6 `validateBidMintState` (≈L276–291)                      | NUT-7 spend state at verdict time                            | Retired from the verdict path; ownership is the client's, per ADR-0004                                                                                                    |
| B8  | Amendment log                                                  | —                                                            | Note that this chunk is ADR-0012 Phase 1                                                                                                                                  |

---

## 5. Code change map

Every line verified against `origin/auctions` @ `8c634c15`.

### 5.1 Reason set — `src/lib/auction/constants.ts`

| Line                               | Change                                           |
| ---------------------------------- | ------------------------------------------------ |
| 194 `'under_increment',`           | remove                                           |
| 195 `'under_curve',`               | remove                                           |
| 204 `'replacement_chain_invalid',` | remove                                           |
| —                                  | add `'below_starting_bid',` (amount/floor group) |

`proof_spent` / `proof_missing` stay in the set: the ADR does not retire them, historical verdicts carry them, and clients must still render them. They simply become unreachable from the verdict path (R5).

### 5.2 Verdict path — `src/lib/auction/validation.ts`

| Line                               | Change                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 161–210 `ValidateBidInput`         | delete `currentTopBid`, `nut7State`, `nut7ProofStates`, `bidChainLegAmount`, `bidChainValidation`, `skipNut7Check`; keep `auction`, `bid`, `observedAt`, `policy` |
| 349–361 `computeBidFloor`          | unchanged logic; doc comment: baseline falls back to `starting_bid`; mark it **selection/display only, never a validity gate**                                    |
| 372–373 destructure                | drop the removed keys                                                                                                                                             |
| **503–533 Step 5**                 | replace the whole block with the single floor check → `below_starting_bid`                                                                                        |
| **535–589 Step 6**                 | delete (NUT-7), incl. the `skipNut7Check` bypass                                                                                                                  |
| 1139 `normaliseBidChainValidation` | delete (module-private; sole caller was Step 5)                                                                                                                   |
| Step 7 `policy`                    | keep unchanged                                                                                                                                                    |
| Step 8 success                     | keep — now unconditional `valid_bid_placed` (no ranking marker)                                                                                                   |

Order preserved: 1 reference integrity → 2 time window → 3 mint allowlist → 4 lock structure → 5 absolute floor → 6 policy → 7 valid.

### 5.3 Validator server — `src/server/auction-validator/`

| File:line                                                                               | Change                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `lifecycle.ts:87, 91, 96, 110, 167–186`                                                 | `currentTopBid` removed from `deriveVerdict` / `derivePreCloseVerdict` and the `validateBid` call |
| `lifecycle.ts:181`                                                                      | stop passing `bidChainValidation`                                                                 |
| `lifecycle.ts:190–…` `deriveBidChainValidation`                                         | delete from the verdict path (becomes unused; the settlement-time chain walk at L345 stays)       |
| `lifecycle.ts:496–507` `pickWinningBid`                                                 | unchanged — §8.0/§8.2 close duties and the reserve gate are untouched (R9)                        |
| `lifecycle.ts:537` comment ("replay ordering + `replacement_chain_invalid` transients") | rewrite — no longer true                                                                          |
| `lifecycle.ts:584` comment (self-condemnation via `under_increment`)                    | rewrite verbatim duplication and drop the retired-reason reference                                |
| `lifecycle.ts:588` `currentTopValidBidAmount`                                           | delete (sole purpose was feeding `currentTopBid` into verdicts; Phase 2's `select()` replaces it) |
| `publisher.ts:50, 87, 104`                                                              | `currentTopBid` removed from `PublishVerdictInput` and both `deriveVerdict` calls                 |
| `subscriber.ts:198, 257, 346`                                                           | drop the `currentTopBid: currentTopValidBidAmount(...)` argument                                  |

`nut7Poller.ts` is already removed from the validator (ADR-0004, per the code comment at `lifecycle.ts:167–175`). Confirm no residual caller.

### 5.4 Schema / tags

| File:line                                     | Change                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/schemas/auction/auctionEvent.ts:150` | `readIntegerTag(event, 'starting_bid') ?? 0` → absence is a hard parse failure with a structured error (`{ code: 'missing_required_tag' }`), mirroring the existing `wrong_kind` shape |
| `src/lib/auction/tagBuilders.ts:46`           | `startingBid?: number` → `startingBid: number` (required)                                                                                                                              |
| `src/lib/auction/tagBuilders.ts:90`           | conditional push → unconditional; guard `Number.isSafeInteger(startingBid) && startingBid >= 0`, throw otherwise                                                                       |

### 5.5 UI copy

`AuctionVerdictPanel.tsx:89` renders `v.reason` verbatim — there is **no** reason→label map in the codebase, so nothing needs removing. Add no new copy: `below_starting_bid` renders as-is, like every other reason.

---

## 6. Test plan

### Rewritten (asserting retired behaviour — the assertions change, not just the fixtures)

- `src/lib/__tests__/auctionBidValidation.test.ts` — L417, 435, 462, 492, 512, 532, 550–584 (`under_increment` ×5, `under_curve`, `replacement_chain_invalid`) and the `computeBidFloor` cases at L546–547.
- `src/lib/__tests__/auctionValidatorLifecycle.test.ts` — L263, L300.

Each becomes: _the same input now yields `valid_bid_placed`_ (the point of the phase), or a `below_starting_bid` case where the amount genuinely sits under the floor.

### New — one test per normative requirement

| Test                                                                                                           | Requirement |
| -------------------------------------------------------------------------------------------------------------- | ----------- |
| A bid below `starting_bid` → `below_starting_bid`                                                              | R2          |
| An outbid-but-valid bid → `valid_bid_placed` (no ranking marker)                                               | R6          |
| An unresolvable `prev_bid` → `valid_bid_placed`                                                                | R4          |
| A bid whose amount is under `top + increment`, and one under the active curve floor, both → `valid_bid_placed` | R2, R6      |
| `fetch` stubbed to throw across a full verdict derivation → verdict still returned                             | R5          |
| The same input set evaluated twice, and in reversed order, → identical verdicts                                | R1          |
| `parseAuctionEvent` without `starting_bid` → `ok: false`                                                       | R8          |
| `buildAuctionEventTags` without `startingBid` → throws; with it → tag present                                  | R8          |
| The retired three are absent from `VALIDATOR_REASONS`                                                          | R7          |

### Not triggered

`e2e/` — every kind-30408 fixture already emits `starting_bid` (`e2e/scenarios/index.ts:636`, `auction-bidding-mints.spec.ts:93`, `auction-settlement.spec.ts:158`, `media-rendering.spec.ts:37`), so the strict parser breaks nothing. Noted as verified, not assumed.

### Local gate before push

`bun test --isolate` on the touched unit files, `bunx tsc --noEmit`, `bunx prettier --check` on changed files.

---

## 7. Decision log

| #      | Question                                               | Resolution                                                                                                                                                                                                                                                                                      | Basis                                                                                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1** | Deliverable shape                                      | **One PR: docs then code, as two commits**                                                                                                                                                                                                                                                      | Maintainer decision, 2026-09-17                                                                                                                                                                                                                                                            |
| **D2** | Fold in #1315?                                         | **Fold in.** The PR closes #1315                                                                                                                                                                                                                                                                | Maintainer decision, 2026-09-17. #1315's own scope note (#1314 already proposes the SPEC side) makes it entirely inside this surface                                                                                                                                                       |
| **D3** | `starting_bid`: REQUIRED or defaulted?                 | **REQUIRED and enforced** — parser hard-fails on absence                                                                                                                                                                                                                                        | ADR-0012 Phase 1 states it directly ("becomes a documented, REQUIRED auction tag"); #1315 Q1 recommends REQUIRED. The live publisher already emits it unconditionally (`publish/auctions.tsx:301`) and so do `gen_auctions.ts:111` and every e2e fixture → enforcement breaks nothing real |
| **D4** | Where does the pre-settlement NUT-7 fraud signal live? | **Settlement-window evidence.** It already has a home: the client's `computeValidatedBids` applies NUT-7 evidence _after_ the structural verdict (`bidValidation.ts:434–457`), and ADR-0004 assigns proof-state ownership to the client. Phase 1 removes the validator's verdict-path copy only | ADR-0012 Phase 1 redundancy check + ADR-0004                                                                                                                                                                                                                                               |
| **D5** | Base branch                                            | **`auctions`**                                                                                                                                                                                                                                                                                  | #1314 landed there; sibling ADR work (#1316) is on `master` and carries a different ADR set                                                                                                                                                                                                |

---

## 8. Migration, risk, and explicit non-goals

**Behaviour changes that are real and intended**

1. **Sub-increment and sub-curve bids become valid** (valid but not leading). This is the ADR's _accepted interim window_: between Phase 1 and Phase 2 there is no selection-side gate either, because selection is Phase 2's deliverable. Accepted by the ADR because the feature is pre-public-release and Phase 2 lands promptly.
2. **A "nibbling" bid may legally lead in the flat window.** Mitigation is seller-set increments, client suggestions and validator policy — not validity. Every such bid still locks real capital until locktime.
3. **Historical verdicts may flip.** On upgrade, re-derivation can turn a previously condemned open-auction bid valid. Operators interpret per era; the ADR states this.
4. **Mixed validator fleets.** Old validators emit retired reasons, new ones don't → split verdicts do not form quorum. Existing quorum semantics handle it; pre-start auditor upgrades are recommended for live auctions.

**Risk to flag, not a blocker**

- With `starting_bid` REQUIRED at the parser, a hand-crafted or legacy kind-30408 event without the tag becomes **unparseable** rather than degrading to a 10-sat floor. Every in-repo producer emits it, so this only affects out-of-band events. This is the intended trade: a silent floor is worse than a loud failure.

**Explicit non-goals of this chunk**

- The Phase 2 selection algorithm (`selection.ts`, `select(auction, bids, instant)`), property tests, and the replacement of `pickWinningBid` / `currentTopValidBidAmount` / the client current-price path. **Chunk 2.**
- The Phase 3 fallback/elimination protocol and its evidence standard. **Deferred by the ADR.**
- NUT-7 _client_ ownership changes (already ADR-0004 territory).
- Issue #1315's docs-only half is absorbed, so #1315 closes with this PR.

**Known CI limitation**

The auctions e2e families are gated by the `e2e-grep` whitelist in `.github/workflows/e2e.yml`, which the bot token cannot push. A green PR therefore does **not** prove the changed auction specs ran; they are verified locally only, and that must be stated in the PR body rather than implied.

---

## 9. Reviewer acceptance checklist

A reviewer verifying this chunk against the specification should be able to answer **yes** to every line:

1. Does `ValidateBidInput` have exactly `{auction, bid, observedAt, policy?}` — nothing else?
2. Is the amount step exactly one comparison, `bid.amount < auction.startingBid` → `below_starting_bid`?
3. Does `validation.ts` contain zero references to `bid_increment`, `minBidCurve`, `AUCTION_MIN_BID_SATS`, `AUCTION_MIN_BID_LEG_SATS`, `computeBidFloor`, NUT-7, and `prev_bid` **inside the verdict path**?
4. Are `under_increment`, `under_curve`, `replacement_chain_invalid` gone from `VALIDATOR_REASONS`, from `src/`, and from UI copy — while remaining parseable on the read path?
5. Does an unresolvable `prev_bid` yield `valid_bid_placed`?
6. Does an outbid-but-valid bid yield `valid_bid_placed`?
7. Does a verdict derivation survive with `fetch` stubbed to throw?
8. Does `parseAuctionEvent` reject a kind-30408 event without `starting_bid`, and does `buildAuctionEventTags` require it?
9. Is `reserve` still only checked in `pickWinningBid` (close-time)?
10. Does every rewritten test assert the **new** behaviour rather than merely deleting the old assertion?
11. Do the AUCTIONS.md and ADR-0003 edits match §3 and §4 of this document, line for line?
12. Is anything from Phase 2 or Phase 3 smuggled in? (Answer must be no.)
