# FundingAbortV1 — approved for offline source and tests

Status: **activation blocked**. The owner approved implementing and testing the
validator-confirmed cancellation protocol with fake funds. This did not
authorize deployment, persistent keys, privileged networking or real funds.
The Go state transition, coordinator contract and browser/Coco recovery client
exist only in the local fake-money branch. Public funding remains disabled;
no privileged FIPS run, persistent key generation or deployment is authorized.

## Consensus rule

An operation and every Cashu proof Y have one permanent consensus origin:

- `committed_bid`: the previously authenticated bid wins the race. The record
  is either active or an exact business-rejection return entitlement.
- `committed_abort`: the abort wins the race. A delayed pre-signed bid using the
  same operation or any proof Y must be rejected by state application.

Both transitions atomically claim the operation ID and sorted proof-Y set. A
local journal, transaction absence, timeout, mempool result, or coordinator vote
cannot create an abort.

The abort certificate has a NIP-07-compatible, exact kind-28650 Nostr actor
authorization and a separate committee signature domain. It
binds the deployment/chain/genesis, auction and operation, actor, canonical mint
and keyset, amount and sorted proof Ys, pool digest, exact two-key NUT-11 lock and
locktime, payment/refund/committee keys, exact return package and SIG_ALL digest,
the bidder return signature, Nostr funding event, validity interval, DKG run,
public package, committee keyset/version, roster and participant-policy digest.
The committee signature also binds the full actor event and policy digest. The
actor, payment, refund and committee keys must be four distinct identities.

## Deliberate non-authority

A committed abort is a return entitlement, not a mint signature. The terminal
worker must independently authenticate the abort at H/H+1/H+2, reconstruct the
exact return from the durable Coco locked token, verify DLEQ/keyset/lock/proof-Y/
amount/owner identity and NUT-07 `UNSPENT`, obtain a distinct 3-of-4 FROST
SIG_ALL authorization, deliver usable fake proofs, import them through Coco, and
persist the recipient ack. `PENDING`, `SPENT`, `UNKNOWN`, identity mismatch, or
stale signer state fails closed.

Failures before either consensus origin still have no cooperative return
authority. The emergency unilateral MAIN/refund first-mint-spend race remains a
separate unresolved product decision.

## Remaining activation work

1. Compose the fixed real-Coco evidence adapter, three independently verified
   signer-policy workers and the authenticated Comet H/H+1/H+2 confirmer.
2. Add a concrete SQLite journal plus independent rollback anchor; its terminal
   adapter must prepare/execute/recover the persisted terminal operation ID
   rather than issue a fresh mint spend after an unknown response.
3. Add matching Go, TypeScript and Rust golden vectors and a real local
   Comet/FROST/Coco recipient-import run against the exact current artifacts.
4. Rebuild the exact-current browser/FIPS action packet and request
   separate privileged execution and deployment approval.

## Acceptance matrix

- Abort commits first; delayed bid and every proof-Y alias are rejected after
  restart and replay.
- Bid commits first; abort is rejected after restart and replay.
- Simultaneous proposal order is deterministic and produces one origin.
- Wrong chain/genesis/mint/keyset/DKG/roster/policy/actor/key/lock/amount/proof-Y/
  package/signature/window is rejected without state or mint effect.
- An abort at `abortExpiresAt` is eligible; one committed second later is not.
- One committee signer unavailable still produces a real 3-of-4 signature;
  two unavailable fail closed.
- Mint `PENDING`, `SPENT`, `UNKNOWN`, lost response and restart never create a
  second return or expose the pool as spendable.
- Exact `UNSPENT` abort return imports once into the actor's Coco v2 wallet and
  conservation holds before, during and after recovery.
- No operation or proof Y can be shared across auctions or between bid and abort.

