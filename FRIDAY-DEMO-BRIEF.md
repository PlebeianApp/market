# Friday Auctions Demo — Tier 1 Brief

> **Superseded target notice (2026-10-21 UTC):** The owner later requested
> integration of the originally intended payment and networking pieces: real
> bidder-plus-committee Cashu `SIG_ALL`, a FROST 3-of-4 committee, and
> jmcorgan/fips validator transport. This document remains the approved
> custodial Tier 1 checkpoint; it must not be relabelled as that integrated
> target. See `FRIDAY-FROST-FIPS-INTEGRATION-INVENTORY.md` for the new target,
> compatibility findings and approval blockers.

## Goal and deadline

Deliver a reviewable, fake-money-only auctions improvement candidate by Friday,
23 October 2026 at 14:00 UTC (15:00 Europe/London, 10:00 owner EDT). The
approximately fifteen-hour budget is a working timebox, not a delivery promise.
No deployment, push, merge, DNS, firewall, TLS, key rotation, real-value contact,
or destructive reset is authorized by this brief.

The candidate remains a POC operated by one person across four distinct
CometBFT validator machines. The coordinator uses one shared application key
and validators trust its funding attestations. This is not FROST, threshold
custody, FIPS work, independent operators, or a production-readiness claim.

## Tier 1 user experience

- Sign in with NIP-07/Plebeian signer or a disposable browser-memory identity.
  Never ask for or accept a normal user `nsec`.
- Use a custodial, server-held fake-sat wallet keyed by the authenticated npub.
  Each faucet grant is 10,000 fake sats; one identity may receive at most
  50,000.
- Create an auction with title, description, optional safe image reference,
  starting bid, optional reserve, minimum increment (100 by default), and a
  5/10/15-minute or bounded custom duration.
- Bid from already funded custodial value. A bid creates a durable application
  reservation; it does not mint a fresh NUT-11 lock and must not be described as
  mint-enforced.
- See auction history, current end, extension/cap status, wallet spendable,
  reserved and pending values, payment/refund receipts, and actual validator
  height/signatures on a phone-width dark UI.

Permanent on-screen labels must say: fake sats/no value; custodial server-held
demo wallet; custodial reservations are not mint-enforced bid locks; shared
committee key is not FROST; coordinator-trusted proofs; four machines, one
operator.

## Money invariants

1. The coordinator serializes every mutation per wallet and also claims every
   reservation ID globally. It signs a non-bearer reservation receipt only
   after proving the wallet has enough unallocated, mint-backed value.
2. Consensus admits a bid only with an unused, correctly signed receipt bound
   to the bidder, auction, amount, replacement (if any), and a bounded expiry.
3. A reservation proposal remains unavailable until consensus either commits
   it or the bounded proposal is reconciled as uncommitted. An accepted bid can
   therefore never outlive its backing.
4. An own raise reserves only the difference while the prior reservation stays
   authoritative. Consensus atomically replaces the prior reservation. An
   outbid from another wallet reserves the full amount before commit.
5. Outbid and no-sale outcomes create refund/release entitlements. A successful
   sale creates one seller-payout entitlement. Durable outbox records exist
   before mint calls.
6. `pending`, `unknown`, and `failed` operations remain unavailable. A mint
   call is never freshly repeated after an unknown outcome; recovery joins the
   same operation identity or fails closed.
7. Conservation at one observation point is:

   `issued = spendable backing + active reservations + in-flight value + fees`

   Fees are zero in this mint. Failed is a status, not a value bucket. Inputs
   and recovered outputs are never counted at the same time.

The deployed Nutshell 0.19.2 evidence advertises NUT-04, NUT-07 and NUT-09. It
does **not** advertise NUT-13 or NUT-19. The candidate must use only verified
capabilities and must document any recovery gap that cannot be closed with
NUT-07/09 plus Coco's durable operation record.

## Deterministic auction rules

- All eligibility and extension decisions use committed block time, never the
  browser clock or the Nostr event timestamp.
- A bid is eligible only when `blockTime < currentEnd`.
- A bid at or after `currentEnd` is late.
- A bid at `t` in `[currentEnd-180, currentEnd)` changes the end to
  `min(max(currentEnd, t+180), originalEnd+1800)`.
- Close is eligible at `blockTime >= currentEnd`.
- Deterministic transaction order is chain order.
- No seller self-bids, replay, equal/lower bids, bids below starting price or
  the current price plus the minimum increment, late bids, or insufficient
  reservations.
- No bid/no reserve result and reserve-unmet result are no-sale outcomes with
  complete release. A successful outcome pays the exact winning amount once.

## Acceptance cases

The isolated suite must cover four identities, 10k faucet grants and the 50k
identity cap; B=1000, C=1500 with B promptly released, B=2000 late-window raise,
D=2500 late-window outbid, capped close and exact 2500 seller receipt; reserve
5000/top bid3000 no-sale; invalid bids; concurrent one-wallet 2000 bids into two
auctions with exactly one success; parallel own raises; raise versus outbid;
lost mint and faucet responses; mint unavailable at close; crashes around
commit/mint/result persistence; exact-deadline and extension-cap boundaries;
conservation; remote offline-endpoint refusal; and phone-width UI.

Tests begin against isolated throwaway local services. They must verify mint
proof outcomes and recipient ownership where a mint is involved, not only
application counters. Live validators are not fault-injected without a separate
action-time confirmation.

## Deliverables and gates

- This brief, `DECISIONS.md`, `RECOVERY.md`, `STATUS.md`, `LIMITATIONS.md`, and
  an updated runbook.
- Safe seed/reset scripts that default to inspection/dry-run. Executing a
  destructive reset is not authorized.
- Reviewable local diff and factual PASS/FAIL/DEFERRED evidence before any
  request to deploy.
- No Tier 2 relay mirror, subdomain or notifications, cross-device wallet,
  NIP-46, NIP-17 DMs, orders, web admin, FIPS, or full-payment-track work.
