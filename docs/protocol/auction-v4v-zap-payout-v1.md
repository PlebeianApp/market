# Auction V4V zap payout v1 — announced split, automated payout, receipt evidence

## 1. Status and provenance

**Status:** Draft — for review. **No implementation is authorised by this document**; the open
questions in §10 are the maintainer's to rule on.

Maintainer direction **2026-09-27** (the "option C" pivot): the multi-party escrow model is
**retired**. Validators stay and are **unpaid** (as they are today, in the shipped code). V4V is
announced by the **seller** and paid out by **the seller's own app at settlement time** as
**automated Lightning zaps** to whatever `lud16` / LNURL / zap-enabled npub each row names.

This packet **supersedes** `docs/protocol/auction-multiparty-manifest-v1.md` and
`docs/protocol/auction-multiparty-settlement-v1.md` for the payee model they describe: there are no
per-recipient P2PK locks, no payout capabilities, no path releases, no redemption isolation and no
multiparty settlement attestation. Those documents remain as the record of a considered and rejected
route, and the parts of them that survive are named in §9.

## 2. Scope

**In scope:** what a seller announces, how a row's destination is expressed and validated, how the
announced split is committed to so it can be checked afterwards, how the payout is planned and
executed at settlement, what evidence the payout produces, and what a validator verifies.

**Out of scope, deliberately:** any custody of recipient funds (no escrow, no money transmission, no
forwarding service); validator fees and validator payout (validators are unpaid); a bond or deposit
for non-paying sellers (§10); any new event kind beyond the ones already in use (`30408`, `1023`,
`1024`, and the NIP-57 pair `9734`/`9735`).

## 3. The decision, and the trade it makes

A recipient's share is **no longer locked to their key**. Instead:

- the seller **announces** the split and commits to it (§4, §5);
- at settlement the seller's app **pays** each row with a zap (§6);
- the payment produces a **public, server-signed receipt** — the recipient's own LNURL server
  publishes it — which anyone can verify (§7).

**What is given up:** the escrow guarantee. Previously a dishonest seller _could not_ take a
recipient's share, because the proofs were locked to the recipient's key. Now the seller holds the
money and pays afterwards, so enforcement is **reputational plus evidential**: the committed split,
the public receipts, and a validator's refusal to attest a settlement whose receipts do not match.

**What is bought:**

- the recipient needs **no key, no capability, no software and no liveness** — a Lightning address is
  the whole onboarding, and it can even be a non-Nostr one;
- the evidence is **stronger** than the escrow route's: a kind-9735 receipt is signed by the
  recipient's LNURL server, is public, and is cheap to verify, whereas the escrow route could only
  infer "who spent a proof" from a NUT-07 witness;
- the entire capability/discovery/liveness/leg-locking machinery disappears.

**Stated plainly for the record:** a seller can take the money and not pay. The commitment and the
receipts make that _visible and attributable_, not impossible.

## 4. The announcement (seller side)

On the auction root (`30408`), the seller announces the split as rows:

- `role`: `v4v` for a plain recipient row (`validator` rows are not part of the split any more —
  validators are unpaid, so they have no allocation).
- `destination`: a Lightning destination (§5) — the row's whole reason to exist.
- `bps`: the row's share in basis points of the seller's net proceeds.
- `name`: optional display label.
- `locked`: presentation only — freezes a row in the editor.

Constraints: `sum(bps) <= 10000`; the remainder is the seller's; a row with `bps = 0` is legal and
means "announced, pays nothing"; rows are canonicalised (stable order, lowercase destinations) before
commitment.

The split is also rendered for humans as the seller's own copy — with the explicit note that the
payout happens from the seller's wallet at settlement, since that is the whole model.

## 5. Destinations

Three accepted forms, all resolved to an LNURL-pay endpoint at payout time:

1. **`lud16`** — `name@domain` → `https://domain/.well-known/lnurlp/name`.
2. **`lnurl`** — a bech32 `lnurl1…` string → the decoded URL.
3. **`npub`** — a zap-enabled Nostr identity: its kind-0 profile's `lud16`/`lud06` is the destination.

Validation is fail-closed and local where possible: an `lud16` must have a plausible name and a
resolvable-shaped domain, an `lnurl1…` must decode as bech32 to an `http(s)` URL, an `npub` must
decode. Whether the endpoint actually answers, supports NIP-57 (`allowsNostr` + `nostrPubkey`) and
what its `minSendable`/`maxSendable` are is a **runtime fact discovered at payout**, not a claim the
announcement makes — and it can change between announcement and settlement.

Invalid rows never silently disappear: they are reported to the seller at announcement time with the
reason, and at payout time with the failure (§8).

## 6. The payout (seller side, at settlement)

Order of operations, per row, after the seller publishes the settlement:

1. **Plan**: from the settled amount, compute each row's sats (`floor(amount * bps / 10000)` with the
   remainder policy of §6.1).
2. **Floor / roll-up**: a share below the minimum zap is **not** sent as its own zap; it is rolled
   into the next row or paid once as a combined amount (§6.2). Fee arithmetic must not exceed the
   share it moves.
3. **Resolve**: fetch the LNURL-pay document; record `allowsNostr`, `nostrPubkey`, min/max.
4. **Zap**: build and sign a **kind-9734** zap request with `amount` (msat), `relays`, and the auction
   reference; request the invoice from the LNURL callback with that zap request.
5. **Pay**: pay the invoice from the seller's wallet — a Cashu melt or NWC, whichever the app is
   configured with. **The wallet stays the seller's**; no service takes custody.
6. **Collect**: fetch/observe the **kind-9735** receipt published by the recipient's server.
7. **Record**: write the row's outcome into the settlement's payout ledger (§7.2).

A row whose payment fails is **retried or reported**; it is never silently dropped, and a payout is
never claimed without a receipt (or without an explicit `no_receipt_expected` outcome, §8).

### 6.1 Remainder policy

Rounding remainders go to the seller, and the ledger states the exact sats paid per row so the
arithmetic is checkable against the commitment.

### 6.2 Minimum zap / roll-up

The floor concept survives from the escrow design, with a different reason: there it stopped a leg
costing more in fees than it moved; here it stops a zap being smaller than its own routing and melt
fees. Below the threshold, roll up.

## 7. Evidence and confirmation

### 7.1 Receipt verification (client and validator, same rule)

A kind-9735 receipt confirms a row when, and only when:

- its `p` tag is the row's recipient identity (or the row's destination resolves to it),
- it references **this auction** (`a`/`e` tag) or the zap request it answers,
- the amount in its `bolt11` tag equals the row's planned sats (within the row's rounding allowance),
- its author is the recipient's LNURL server (`nostrPubkey`) when the LNURL document declared one,
- its signature verifies and its `description` hashes to the zap request that was sent.

A receipt that fails any of these is **not** evidence of payment. Absent a receipt, the strongest
available claim is `paid_unconfirmed` (§8) — never `paid`.

### 7.2 Payout ledger on the settlement

The settlement (`1024`) carries one entry per announced row:

- `destination`, `bps`, `sats`, `status`, and `receipt_id` when a receipt confirmed it.

This reuses the existing settlement payout shape (`SettlementPayoutEntry`), widened from a bare
`status: string` to the vocabulary in §8, so a client can render each row's true state.

## 8. Statuses and failure codes

**Row statuses, one sentence each (D14 discipline):**

- `planned` — "This share is scheduled to be paid when the auction settles."
- `paid` — "This share was paid and the recipient's server published a receipt."
- `paid_unconfirmed` — "This share was paid, but no receipt was published yet."
- `rolled_up` — "This share was too small to send on its own and was paid together with another row."
- `no_receipt_expected` — "This destination is a plain Lightning address, so no zap receipt exists."
- `address_unreachable` — "The recipient's Lightning address did not answer."
- `not_zap_capable` — "The recipient's endpoint does not accept zaps."
- `below_minimum` — "The share is smaller than this endpoint accepts."
- `payment_failed` — "The Lightning payment did not complete."
- `not_paid` — "This share has not been paid."

**Announcement-time refusals:** `destination_malformed`, `destination_unsupported_scheme`,
`destination_duplicate`, `split_over_allocated`, `row_count_exceeded`.

## 9. What survives from the retired route (and why)

Kept, because this model needs it:

- **the allocation arithmetic** (`src/lib/v4v/allocations.ts` and the bps/seller-remainder rules);
- **the canonical split encoding and its commitment** — the seller publishes a hash of the announced
  split so anyone can check the payouts against what was advertised. This is _the_ structural defence
  the escrow model provided by other means, and it is nearly free: the canonical-bytes discipline
  already exists;
- **the per-row floor**, repurposed as the minimum zap / roll-up rule (§6.2);
- **the settlement payout ledger** (§7.2), widened to a real vocabulary;
- **one sentence per state** (D14);
- the seller-side UI (tab, editor, workflow sequencing) and the validator layer (quorum, pool policy,
  the auction-level invalid claim) — untouched by this packet.

Retired: payout capabilities (kind 1027/1028/1029/1030), announcement discovery, publish-readiness
liveness, activation authority, validator payout key material, the leg lock/swap/journal/recovery
chain, the bid manifest, path releases, redemption isolation, and the multiparty settlement
attestation.

## 10. Open questions for ruling

1. **Are receipts mandatory?** A zap-capable endpoint yields a public receipt; a plain Lightning
   address pays but leaves only a preimage. Mandatory receipts (simpler evidence rule, fewer payable
   destinations) or an accepted `no_receipt_expected` tier?
2. **Per-row destination or a whole-auction mode?** This packet assumes rows are always zap rows.
   If the escrow route is ever wanted for a subset (validators paying themselves?), the wire needs a
   per-row mode — and that is a decision to make now or never.
3. **Who bears the fees?** Routing and melt fees are the seller's cost today in this model. Deduct
   from shares, or leave the split exactly as announced and let the seller carry them?
4. **Does the split commitment bind the seller to anything?** A commitment makes the announced split
   checkable; it does not make non-payment detectable _unless_ someone compares. Should a validator
   refuse to attest a settlement whose ledger does not match the commitment — and is that a protocol
   rule or a client opinion?
5. **Deferred:** a seller bond or deposit, if reputational enforcement proves insufficient. Not in v1.

## 11. Relationship to the in-flight work

- The multi-party escrow branch is **not** merged as-is; its kept parts (allocation, UI, validator
  layer) are re-cut into this work.
- The NUT-07 spend-attribution work (issues #1397–#1400) is **independent of V4V** and remains what it
  always was: a correctness improvement to the shipped single-party settlement path.
