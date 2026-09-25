# Auction multiparty (V4V) — construction log

A running record of the staged work on the bid path's legs: what each stage did, the decisions taken
while doing it, and the evidence each one leaves behind. Stages follow the gate order in
`docs/handoffs/auction-multiparty-handover-2026-08-21.md` ("Next unfinished work").

Read the branch, not this file, as the authority: this is a log, and where the two disagree the code,
tests and the ADR proposal win. Evidence for each stage is the commit plus its verification numbers.

## How to read an entry

- **Stage** — the gate, and whether it is complete or partial.
- **What changed** — the modules, one line each, and why they exist.
- **Decisions taken** — the calls I made, with the reasoning. These are the parts worth reviewing:
  a decision is where a reviewer's judgement is worth more than mine.
- **Evidence** — the focused tests and the suite numbers for the commit.
- **Left open** — what I deliberately did not decide.

## Earlier stages on this branch (by commit)

Recorded here only as a map, so a reader knows what came before this log starts; the commits and the
PR body's update sections carry the detail.

- `multipartySchedule`, `multipartyAllocator`, `multipartyAuthorization*`,
  `multipartyActivationAuthority*` — gates A–C, frozen in the handover.
- `multipartyManifest`, `multipartyManifestWire`, `multipartyBidManifest`,
  `multipartyReleaseWire`, `multipartyLegFloor`, `multipartyParticipation`,
  `multipartyPublishReadiness`, `multipartyCheckPoints`, `multipartyAnnouncements` — gates D1–D2 and
  the policy layer, landed across 2026-09-21…24.
- `880ab696` — the per-row lock plan (`multipartyLegLockPlan`): one output per manifest row, and the
  parity finding (an x-only child key cannot be completed into a NUT-11 lock key).
- `ed7af790` + `6c41e003` — the mint side (`multipartyLegSwapPlan`, `multipartyLegLockOutcome`,
  `multipartyRecoveryRecord`, the floor's schedule projection) and **D16**.
- `a582c534` + `cd990b7b` — the construction journal (`multipartyLegJournal`), the attempt-before-
  request rule and reconciliation, and **D17**.

---

## Stage E (live half) + F (second half) — the construction loop

**Status:** complete as an unwired module. `src/lib/auction/multipartyLegConstruction.ts`.

**What changed**

- `multipartyLegConstruction.ts` — the loop between the three pure pieces that already existed: plan
  the swaps, record the attempt, send it, verify what came back, settle the row, stop. Its only I/O is
  the journal; the mint is an injected seam, and no wallet store, relay or token store is touched.
- `multipartyLegJournal.ts` — refined while building the loop, in three places: a sixth row state, a
  reopen transition, and a sharper definition of the `unsent` and `partial` verdicts.

**Decisions taken**

1. **The mint is a seam, not an import.** `MultipartyLegMintSeam.swap(request)` mirrors
   `CashuWallet.swap(amount, proofs, { p2pk })` and is injected. This is what makes the loop testable
   with no network at all (ADR-0005), and it keeps the live wallet binding — which the schedule wire
   profile's production gate prohibits until focused approval — outside this stage.
2. **Two orderings, both fail-closed.** The journal entry must be durable _before_ the first swap
   (`leg_journal_not_durable` otherwise), and each row must be recorded `attempted` and confirmed on
   disk _before_ its swap is sent (`leg_attempt_not_durable` otherwise). The tests assert both from
   the far side: the fake mint reads the journal back off disk on every call and refuses to answer
   unless its row is already `attempted`.
3. **The leg stops at the first row that does not lock.** A row whose outcome is unknown may already
   have consumed its inputs, so funding later rows from the same pool builds on a guess; and one pass
   over the leg is what makes the returned summary a statement about one attempt rather than a mixture
   of them. Retry is explicit: reopen a row proved pre-mint, then run again.
4. **A sixth row state: `locked_to_foreign_key`.** A mint that returns a row's proofs locked to a key
   that is not that row's has not given an unknown answer — it has given a definite, bad one, and the
   send set is reclaimable through the refund branch once the locktime opens. Folding it into `locked`
   would hide a leg that cannot settle; folding it into `uncertain` would hide that it can be
   reclaimed. Only the three key-shaped verification failures map here; a short or unparseable return
   stays `uncertain`, because what the mint did is genuinely unknown.
5. **One exception to "never re-sent": `failed_pre_mint` may be reopened.** A failure proved to precede
   the mint call consumed nothing, so a retry is legitimate — the same reasoning the single-party flow
   uses when it lets a provably pre-mint failure stay retryable. `uncertain`, `locked` and
   `locked_to_foreign_key` may not be reopened, for three different reasons, each stated at the
   function.
6. **`unsent` means nothing was sent, and `partial` covers zero locked.** Prompted by the sixth state:
   a leg whose rows were all sent and none of which locked has consumed inputs, so "nothing has to be
   recovered" would be false. The verdicts are now exact (`complete`, `unsent`) or `partial` with the
   counts carrying the detail.
7. **A failure to settle after a swap is reported, not refused.** The swap already happened, so a
   journal write that fails there is not a refusal to send — the summary reports what is on disk and
   the row carries the storage error.

**Evidence**

- 14 focused tests in `multipartyLegConstruction.test.ts`, 29 in `multipartyLegJournal.test.ts`, all
  passing; suite numbers in the commit and the PR body's update section.
- The ordering tests are the ones to read first: they prove the durable-attempt rule from the seam's
  side of the call.

**A defect the full suite caught, and why it is worth recording**

The first version of the test that counts storage writes wrapped the ambient `localStorage` with
`{...globalThis.localStorage}`. A spread copies only **own** properties, and in a full-suite run the
ambient storage carries its methods on the prototype — so the wrapper lost `getItem`, every read threw,
and the leg was refused for a reason that had nothing to do with the assertion. It passed in isolation
(43/43) and failed only in the suite. The wrappers now use `Object.create(real)` with an own `setItem`,
which works whichever shape the ambient storage has. This is the suite earning its keep: a test that
passes alone is not evidence that it passes, and an ambient global is not the same object in a full run
as it is in a single-file run.

**Left open**

- **The live binding.** Nothing calls `constructMultipartyLeg`. Wiring it into the bid flow means
  wallet mutation and a user-visible surface, which the wire profile's production gate withholds until
  the remaining wire sections and their resource limits are approved. That is a gate to open
  deliberately, not a step to slip in behind a module.
- **Whether the single-party and multiparty sentences for an ambiguous lock should be one sentence.**
  This stage adds its own wording per verdict (D14) and leaves the single-party flow's copy untouched;
  unifying them changes live copy, which is the maintainer's call.
- **The two stores' bounds.** A pending leg occupies one entry in the recovery record and one in the
  journal, each fail-closed at 25. Whether one budget should cover both is recorded in D17 as open.

---

## Stage I — redemption isolation

**Status:** the isolation half implemented, unwired; the fallback half deliberately not decided.

### What changed

- `multipartyRedemptionIsolation.ts` — per-row redeemability (`verifyMultipartyRowRedemption`) and the
  leg-level observation (`assessMultipartyLegRedemption`) with one sentence per state.
- `docs/protocol/auction-multiparty-settlement-v1.md` §8 — was `OPEN`; now records what is implemented,
  what is deliberately left to a ruling, and the one rule that constrains any answer.

### Decisions taken

1. **Isolation is a property, so it is checked rather than assumed.** The settlement packet expected
   per-leg redeemability "given per-leg child keys" — true, but the assumption is worth a refusal: a row's
   token holding a proof locked to a **foreign** key is refused (`redemption_row_foreign_proof`), which is
   the isolation violation itself.
2. **The row must be _this_ payee's before anything else is checked.** `derive(payout_xpub, path)` must
   reproduce the row's child key; otherwise the row belongs to another payee and every later check would
   be answering the wrong question.
3. **A proof must be reclaimable under the leg's refund authority, not just locked to the row's key.**
   Both live in the same NUT-11 secret. Without this check a payee could hold a row it can redeem _now_
   but could not reclaim after the locktime — the fallback nobody would notice until it was needed.
4. **Spent is never completion on its own.** A spent proof is ambiguous between the payee redeeming and
   the bidder reclaiming after the locktime, and `bidValidation.ts` already carries that ambiguity for the
   single-party case. So `complete` requires the payee's confirmation, and a fully spent but unconfirmed
   leg reports `spent_awaiting_confirmation`, explicitly not terminal.
5. **A zero-fee logical row is excluded from completion, and a leg with nothing to redeem says so.**
   The schedule packet's zero-leg rule is implemented as `proofBearing: false` being ignored by the
   completion requirement, and `nothing_to_redeem` rather than an empty success.
6. **The fallback is left open on purpose.** What the seller does with a never-redeemed leg (settle, hold,
   or treat the rows as D7 grief) is a ruling, and the module says nothing about it — a client policy here
   would be an assumption the protocol has not made.

### Evidence

- 15 focused tests in `multipartyRedemptionIsolation.test.ts`; suite numbers in the commit and the PR
  body. The two to read first: the foreign-proof refusal, and `spent_awaiting_confirmation` staying
  non-terminal.

### Left open

- **The fallback policy** (§8's second half), pending the transport (§5) and confirmation (§7) rulings.
- **Whether a validator attests redemption at all**, which is §9's business and interacts with this
  assessment: the observation above is a _client_ view of mint state, not a verdict.

---

## Stage H — the multiparty path release

**Status:** implemented as an unwired wire packet (builder + reader + binding check). Nothing publishes
it.

### What changed

- `multipartyReleasePacket.ts` — the kind-1025 release for a leg, written and read: the leg-level tags
  the manifest profile's §4 requires (`payout_schedule_commitment`, `payout_manifest_commitment`, the
  shared `derivation_path`, `path_commitment` when the bid committed one), plus the per-row tags, plus
  `multipartyReleaseBindsLeg` — the replay protection, which compares the release's commitments against
  values the _reader_ holds rather than against anything the release says about itself.
- `docs/protocol/auction-multiparty-manifest-v1.md` §4.1 — the wire decision the section was missing:
  how a leg's N child keys and N tokens travel.

### Decisions taken

1. **One release event per bid, rows repeated in manifest index order.** A leg is one bid that locked N
   outputs, and the manifest is already an indexed list, so positional matching against it is the check.
   Splitting the release across N events would repeat the commitments in every event, make a missing one
   indistinguishable from "not released yet", and destroy the one property worth having: that "all rows
   released or none" is checkable on a single event. Recorded in the profile itself, because it is a wire
   decision rather than a client one.
2. **A partial row set is a refusal, not a partial read.** A release naming three rows of a four-row leg
   is refused outright, because a leg that settles from three rows paid three of its four recipients.
   The same count rule applies to the tokens: absent as a group, or exactly one per row.
3. **The commitments are checked against the reader's own values.** The release carrying a commitment is
   no evidence that it is the right one — the leg's own schedule and manifest commitments, and the bid's
   path commitment when it made one, are what it is compared to. A release that _invents_ a path
   commitment the bid never made is refused as well as one that omits it, since both let a releaser
   choose which binding applies.
4. **A single-party release read as multiparty is refused.** The reader requires both commitments, so a
   §4-era release (path only) cannot be mistaken for a multiparty one — the refusal is explicit rather
   than a reader falling back to a weaker check.
5. **The row keys are x-only, and only x-only.** The manifest records x-only and the verifier derives
   against it, so the packet refuses a compressed key here; the compressed form lives in the bidder's
   records, where a reclaim needs the parity. Same rule as D16, applied at the wire.

### Evidence

- 14 focused tests in `multipartyReleasePacket.test.ts`; suite numbers in the commit and the PR body's
  update section. The two to read first: the partial-row-set refusal, and the binding checks that fail
  on a different bid, schedule, manifest or row count.

### Left open

- **Who publishes the release, and when.** The packet is the event's tag set; the flow that decides a
  winner, derives the shared path and signs the release is the settlement side (stage J) plus the
  release's own trigger, and it is also the point where the production gate applies — publishing is
  relay publication.
- **How a recipient discovers its row.** The profile's deferred list has said "delivery is the release
  plus discovery" since before this stage; the packet makes a row's token findable in the release, but
  the discovery order (which event a recipient watches, on which relay) is still open.

---

## Stage G — the NIP-60 transition, built as data after the wallet-base check

**Status:** implemented as a store-agnostic projection; the wallet _binding_ is the only part left, and
it is one small adapter. The maintainer asked for the wallet-base check before G, because a Coco wallet
migration is in flight and the question is whether the multiparty work should be based on
`feat/coco-v2-wallet-auction-lifecycle` instead of NIP-60.

### What the multiparty layer actually needs from a wallet

Checked by reading what the modules import. **Two of the five touch wallet code at all, and only one
helper**: `multipartyLegJournal` and `multipartyRecoveryRecord` use `loadUserData`/`saveUserData`
(`src/lib/wallet/storage.ts`), which both wallet stores already share. `multipartyLegConstruction`
touches the wallet through an **injected seam** (`MultipartyLegMintSeam.swap`) that mirrors one library
call. The plan, the parity rule, the outcome verification, the state machine, the refusal codes and
every test are wallet-free.

So the wallet surface of this work is three interfaces, not a dependency:

| Interface               | Today (NIP-60)                                                                                              | On Coco (branch)                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lock N outputs          | `CashuWallet.swap(amount, inputs, { p2pk: { pubkey, locktime, refundKeys } })`, once per row                | `manager.ops.send.prepare({ operationId, mintUrl, amount, target: { type: 'p2pk', options: { pubkey, locktime, refundKeys, requiredRefundSignatures } } })` then `.execute(operationId)` — once per row |
| Leg recovery            | `PendingToken[]` under `nip60_pending_tokens`, `AuctionBidPendingTokenContext` (a shape this branch widens) | Coco's IndexedDB operation store + `src/lib/coco/recovery/metadata.ts` (`RecoveryMetadata`: `cocoOperationId`, `derivationPurpose/Version/Reference`, `auctionBinding`, `conditionFingerprint`, status) |
| Proof-state bookkeeping | `wallet.state.update({ mint, store: change, destroy: inputs })` — the caller hands the wallet its delta     | none: the engine owns proofs, change and reclaim. Nothing to hand it                                                                                                                                    |
| Reclaim                 | `nip60` refund flow with the leg's refund private key                                                       | `manager.ops.send.reclaim(operationId, { spendingPath: 'refund' })`                                                                                                                                     |

### Verdict

**Not "renaming API calls", and not "fundamental" either.** Three interfaces differ in kind (a
one-shot swap vs a prepare/execute operation with a caller-supplied id; a pending-token list vs a
recovery-metadata model; a caller-supplied proof delta vs no delta at all), and the `PendingToken`
shape this branch depends on is NIP-60's store, not a shared abstraction. But the _protocol_ work —
which is most of what has been built — is already backend-neutral, and Coco's model supplies **more**
of the durability story than NIP-60 does: `prepare` is durable before `execute`, and the engine runs
recovery sweeps, which is the same problem the leg journal hand-rolled at the leg level.

That last point is the useful one: on Coco the leg journal **narrows** to the row↔operation mapping and
the leg verdict, because the per-operation durability stops being ours.

### Decision taken

**Do not rebase this work onto the Coco branch, and keep stage G store-agnostic.** Reasons, all
checkable on the branch:

- the Coco auction path is **env-gated** (`BUN_PUBLIC_AUCTION_MONETARY_MODE=coco-v2` plus a fake-mint
  allowlist, `src/lib/coco/auctions/mode.ts`), i.e. a fake-funds staging integration, not a merged
  wallet;
- it is large and in flight (126 files, ~17k insertions vs `auctions`), so the multiparty feature would
  join a moving review surface and lose the clean one it has now;
- it contains **zero** multiparty/V4V concepts — `git grep -i multiparty` over `src/lib/coco` is empty —
  so basing the work there means introducing a new protocol shape into an unmerged integration instead
  of onto a stable base and adapting later.

Stage G will therefore produce the transition as **data** — per-row lock records, the row↔operation
mapping, and the leg's change/consumed sets — with persistence behind a thin adapter, exactly as the
mint interaction already is. On NIP-60 those records become pending tokens; on Coco they become the
command bindings and recovery metadata. Nothing in the contract changes.

### What changed

- `multipartyLegWalletTransition.ts` — the leg → wallet projection, as **data**: one record per locked
  row (its `send` set, its change, its encoded token, and a context carrying the leg's facts plus _that
  row's_ compressed key), plus the leg's proof delta (`store` = every row's change, `destroy` = every
  consumed input). The NIP-60 binding is the last, smallest export in the file: `toNip60PendingTokens`,
  one pending token per row.
- `src/lib/wallet/types.ts` — `AuctionMultipartyBidPendingTokenContext`, a context `kind` of its own,
  added to the `PendingTokenContext` union. Its own kind rather than extra fields on the single-party
  context, because a multiparty leg is one token per row and the single-party shape carries exactly one
  lock key: extra fields would leave every existing reader reading a token that describes only one row.
  Committed separately (`9c75df34`) so it can be judged or reverted on its own.

### Decisions taken in the implementation

1. **Data before calls.** Both candidate wallets need the same three facts about a leg (N locks, each
   one's key, which proofs moved) and phrase them differently. The projection therefore produces the
   records and the delta, and only the final adapter knows which store consumes them.
2. **The delta's two sets must be disjoint, and that is a refusal, not a tidy-up.** A proof that is
   simultaneously kept and destroyed makes a balance wrong in both directions; an input destroyed twice
   is the same contradiction with a different cause. Both are refused with their own code rather than
   silently deduplicated.
3. **A row's `send` set must sum to the row's recorded amount.** A wallet told otherwise holds a token
   whose amount is a lie, and the lie surfaces later as a settlement that does not add up.
4. **Compressed keys only.** The row record carries `rowChildPubkeyCompressed` and nothing x-only: the
   parity cannot be rebuilt from x-only, and a reclaim without it locks — or fails to lock — the wrong
   output. Same rule as D16, one layer up.
5. **The token id is injected, and a collision is fatal.** Two rows sharing a token id make a reclaim
   address the wrong row, so the id factory's output is checked rather than assumed unique.
6. **A partial leg transitions only the rows that were sent.** The delta must cover exactly those rows:
   destroying an untouched row's inputs would remove proofs the wallet still holds.

### Evidence

- 15 focused tests in `multipartyLegWalletTransition.test.ts`, all passing; suite numbers in the commit
  and the PR body's update section. The two to read first are the delta-disjointness ones.

### Left open

- **The binding.** `toNip60PendingTokens` is the NIP-60 adapter; on a Coco-style engine the same row
  records would become send-operation bindings and there would be no delta to hand over, because the
  engine owns the proofs. Written to be the only thing that changes.
- **Whether the bids surface shows multiparty legs.** Every reader that lists a bid leg filters
  `context?.kind === 'auction_bid'`, so the new kind is invisible there until that is decided.

### Questions this hands to the Coco work

1. **Is a multiparty leg N send operations (one per manifest row), or does the Coco operation model
   want a single multi-output send?** One per row is what the wire requires (one output per row, each
   locked to its own key) and what Coco's `p2pk` target expresses today; a single send with per-output
   keys does not exist in either library.
2. **Every surface that lists a bid leg filters `context?.kind === 'auction_bid'`** (`nip60.ts`, the
   bids dashboard). A multiparty leg carries its own kind, so those readers decide explicitly whether
   multiparty legs appear there — silence would make them invisible.

### Correction recorded

My earlier Coco notes said no refund-claiming path exists upstream. That was true of the upstream
master snapshot and is **wrong for the pinned Round 16**: `ops.send.reclaim(id, { spendingPath:
'refund' })` exists and the auction engine port calls it. The stale claim is corrected in the skill's
Coco reference so it is not repeated as a blocker.
