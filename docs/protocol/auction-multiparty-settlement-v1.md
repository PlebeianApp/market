# Auction multiparty settlement v1 — payout delivery, confirmation and redemption

## 1. Status and provenance

**Status:** Draft — for review. **No implementation is authorised by this document.**
Nothing here is production-authorised until the open questions in §14 are ruled on.

Inherits from, and does not restate:

- `docs/protocol/auction-multiparty-v1.md` — the schedule packet (encodings, compile/parse,
  resource limits, zero-leg boundary). Its §15 explicitly does not decide token/proof
  transport, settlement and recipient-confirmation events, or NUT-06/NUT-07 evidence rules:
  **those are this packet's subject.**
- `docs/protocol/auction-multiparty-manifest-v1.md` — root tags, the bid's payout manifest,
  the release binding, path commitment, verification (§6) and the failure-code set (§7). Its
  §8 defers settlement, redemption isolation and fallback (gates H/I/J), multi-mint payout
  construction, how a recipient learns its path, proof-level lock verification, and D13
  presence.
- `docs/adr/proposals/auction-v4v-participation.md` — D7 (grief is a missing or mismatched
  recipient leg at release), D8 (one shared path, per-recipient xpubs), D10 (the bidder pays
  the extra outputs), D12 (auto-settlement deferred), D14 (one shared client wording per state).
- `ADR-0011` — proof-level lock verification; `ADR-0003` appendices — verdicts, the
  `auction_policy_invalid` claim, strict-majority quorum.

## 2. Scope

In scope: how each payout leg's proofs reach its payee; what a payee does on receipt; what a
payee publishes to confirm; what a validator verifies before an auction is treated as settled;
how one payee's failure is isolated; the payout key material the validator needs; the evidence
rules those decisions depend on.

Out of scope: the schedule and manifest encodings (normative elsewhere); the auction feed and
UI; auto-settlement (D12, deferred); presence (D13, issue #1328).

## 3. Actors and obligations

- **Bidder** — locks one output per manifest leg at bid time (D10). Obligation ends at lock.
- **Seller** — publishes the release bound to the schedule and manifest commitments. Cannot
  redirect a leg: the commitments make a different split unverifiable.
- **Validator** — verifies the split against the commitments before treating the auction as
  settled (§9), and publishes its verdict on it. A validator that is also a payee must not let
  its payout interest change what it verifies (manifest §6: verification is required for
  **every** row).
- **Recipient (including a validator receiving a fee)** — redeems its own leg and confirms
  receipt (§7).
- **Mint** — custodian for each leg; NUT-07 state is the evidence layer (§10).

## 4. Payout key material — DECIDED

This section is settled; the rest of the packet is not.

### 4.1 What the validator needs

To be paid, the validator needs key material it controls, and it must publish the public half:

- a **master payout seed** (private, never published);
- the **per-mint payout xpub** derived from it, published in its kind-1027 capability together
  with the existing whole-xpub proof of possession (D3) — this is the "public key of an e-cash
  wallet it can redeem from";
- the matching **private** material at redemption time, to unlock each leg locked to
  `child_pubkey = derive(payout_xpub, shared_path)` (D8).

The operator handles the **seed only**. The xpub is derived and published; the
operator-facing artifact is a **fingerprint** of the xpub, printed when the seed is created and
shown on the validator's profile, so it can be checked that the key receiving funds is the one
being held.

### 4.2 One variable, two provisioning paths

Both paths use the same variable:

```
CVM_PAYOUT_SEED=<64 lowercase hex, 32-byte master seed>
```

- **CI-deployed instance (auctionsdev and equivalents):** the operator adds
  `CVM_PAYOUT_SEED` as a **repository or environment secret** and the deploy workflow passes it
  through into `.env` exactly like `APP_PRIVATE_KEY` and `CVM_SERVER_KEY`. The secret is the
  source of truth, because CI rewrites `.env` on every deploy — a value written into `.env` on
  the host does **not** survive.
- **Self-hosted instance:** the operator generates the seed locally (script, §4.3) or pastes a
  seed they already have into their own `.env`. Here `.env` is the source of truth and is
  theirs to keep.

The error paths in §4.4 must name the correct instruction for the deployment in play, so an
operator is never told to "put it in `.env`" on a host where CI owns that file.

### 4.3 Generation script

A manual, one-shot generator — `scripts/generate-validator-payout-seed.ts`:

- draws 32 bytes from a CSPRNG (no passphrase, no default seed, no derivation from machine
  identity);
- **refuses to run if a seed already exists**, in the environment or in the target `.env`
  ("a payout seed already exists at <location>; refusing to overwrite — rotating a payout key
  while funds remain locked to the old xpub strands them");
- on the self-host path: writes `CVM_PAYOUT_SEED` into `.env` (file mode 0600) and prints the
  **xpub fingerprint** and where the file is;
- on the CI path: prints instructions to add the value as the `CVM_PAYOUT_SEED` secret, and
  nothing else sensitive;
- prints both instruction sets so a reader can see which one applies to them.

### 4.4 Startup checks — fail loudly, three cases

The validator refuses to start unless all three pass:

1. **No seed configured** → error naming both provisioning paths and the script.
2. **Seed malformed** (not 64 hex characters) → error, never coerced. Any 32 bytes are a valid
   BIP32 seed, so there is no scalar check to make — only a length and alphabet check, so a
   truncated or quote-wrapped value fails loudly instead of deriving a different wallet.
3. **Seed does not reproduce the xpub already announced** → error naming the announced xpub
   and the newly derived one. This is the case that looks healthy: everything is configured and
   the validator would silently publish a new xpub while funds remain locked under the old one.

Case 3 is overridable deliberately, and only deliberately:

```
CVM_ALLOW_PAYOUT_KEY_CHANGE=1
```

With the flag the validator starts, logs a warning that names both xpubs, and publishes the new
capability. Without it, it does not start. Detecting the announced xpub uses the same
read-your-own-history pattern as `observedAtRecovery.ts`: fetch the validator's own latest
kind-1027 capability from its relays at startup and compare.

### 4.5 Rotation is additive

Publish a new capability with the new xpub; keep the old seed until nothing remains locked
under the old xpub. Discarding a seed is the one irreversible act in this flow.

### 4.6 Runtime scope

Provisioning (§4.1–§4.3) is necessary but not sufficient. Redemption needs a runtime path:
derive the per-mint child keys, unlock the P2PK legs, swap at the mint, record the outcome.
That is part of §6–§8, not of key generation.

## 5. Token/proof transport — OPEN

How a leg's proofs physically reach its payee. Options, with trade-offs:

- **A. In the release event (kind 1025).** One event carries every leg. Simple, one artifact,
  no new channel — but every payee's proofs are public to anyone reading the auction, and the
  event grows with the row count.
- **B. Per-payee delivery (e.g. NIP-17 gift-wrapped message to each payee).** Each payee
  receives only its own leg. Better privacy, more moving parts, delivery failure needs its own
  retry semantics.
- **C. Hosted blob (Blossom or equivalent) referenced by the release.** Off-relay for size, and
  addresses the 4,096-byte class of limits — but adds a third-party dependency and a fetch step
  before anyone can redeem.

**Recommendation:** B for payee privacy, with the release carrying commitments (already
specified) rather than proofs, and A as the fallback carrier when direct delivery cannot be
confirmed. Needs a ruling before code.

## 6. Settlement lifecycle and states — OPEN

Proposed states, each with the one-sentence client wording D14 requires:
`published → delivered → redeemed → confirmed → complete`, with `griefed` and `abandoned` as
terminal alternatives. Open: which actor asserts each transition, and whether a payee's
non-confirmation is `griefed` (a protocol verdict) or merely unresolved (a client opinion).

## 7. Recipient confirmation — OPEN

D4 already fixes that recipients confirm per auction on the same scheme validators use. Open
here: the exact claim, whether confirmation is required for completion or only recorded, and
the expiry/replay rules. Note the zero-leg rule from the schedule packet: a zero-fee validator
has a logical leg but no proofs, and is excluded from redemption-completion requirements.

## 8. Redemption isolation and fallback — OPEN

Gates H/I/J. One payee failing (offline, mint down, lost key) must not strand the others.
Open: whether each leg is redeemable independently by construction (expected, given per-leg
child keys), what the seller/validator does when one leg is never redeemed, and how this
interacts with D7 grief.

## 9. Validator verification of the split

Extends manifest §6 with what a validator attests and when: the three per-row checks
(derivation reproduces `child_pubkey`; the leg's proofs are P2PK-locked to that key; amounts sum
to the released leg total) plus the three commitment matches, performed for **every** row,
before publishing a verdict that the auction settled. Failure codes already exist for these in
manifest §7.

## 10. Evidence rules — OPEN

Which mint identifier grammar (NUT-06) is accepted; which NUT-07 observations count, by whom,
and at what point in the lifecycle; whether NUT-12 DLEQ proofs are required or optional. The
app already queries mint state directly (`checkProofStateBatch`, ADR-0004) — this section fixes
what the _validator_ must observe, not just the client.

## 11. Failure codes

Extends manifest §7, which already covers `release_derivation_mismatch`,
`release_schedule_commitment_mismatch`, `release_manifest_commitment_mismatch`,
`release_path_commitment_mismatch`. This packet adds the settlement-side codes once §5–§8 are
ruled on (transport failure, delivery unconfirmed, leg unredeemed, mint unreachable at
redemption).

## 12. Resource limits

Per-leg proof counts, release event size, delivery payload size, and redemption retry budgets.
To be fixed with §5, since the transport choice determines what is bounded.

## 13. Explicitly out of scope

Auto-settlement (D12); presence and the draft-time liveness probe (D13, #1328); the schedule and
manifest encodings; UI copy beyond the D14 state sentences.

## 14. Open questions for ruling

1. **Transport (§5):** A, B or C — or B with A as fallback?
2. **Lifecycle (§6):** who asserts each transition, and is non-confirmation a protocol verdict
   or a client opinion?
3. **Confirmation (§7):** required for completion, or recorded only? Expiry and replay rules?
4. **Isolation (§8):** what happens to a leg that is never redeemed?
5. **Evidence (§10):** NUT-12 required or optional; which NUT-07 observation is normative?
6. **CI secret name (§4.2):** `CVM_PAYOUT_SEED`, and does it go on the `staging` environment or
   the repository?
