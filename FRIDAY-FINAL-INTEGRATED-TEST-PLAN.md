# Friday final integrated test plan

This plan applies to source newer than the frozen R5 lab packet. R5 is not
evidence for the authority/API or browser-funding protocol described here.

## Immutable candidate inputs

Before execution, record one Git commit, every Go/Bun/Rust binary SHA-256, the
Nutshell 0.19.2/FakeWallet configuration, active zero-fee keyset, Comet genesis
and four validator identities, DKG/public-package/roster identities, FIPS
binary/config hashes, application config, browser bundle hash and clean-state
database generations. Any source or binary change invalidates the run.

## Browser and admission

1. Open the same-origin site normally with certificate validation.
2. Use NIP-07 (and separately the disposable demo identity) only to sign a kind
   28647 Nostr funding authorization. Generate a different browser-memory
   payment key and sign the exact Cashu SIG_ALL return digest with it.
3. Assert the authorization binds network, chain, auction, amount, mint,
   payment/refund public keys, operation, bundle/return/SIG_ALL digests, exact
   bidder return signature and expiry. Reject a
   changed field, cross-origin request, replay, expired event and equal keys.
4. Exercise the final V4 receipt through TypeScript, Go consensus and each Rust
   participant. Funding remains disabled until all three accept the same
   frozen vector and a real zero-fee test-mint proof pool is reserved.

## Integrated fake-money cases

Run in one bounded throwaway environment with actual four-node Comet,
independent participant-policy services, real 3-of-4 FROST, FIPS transport and
Nutshell proofs:

- fund four identities (10,000 each; 50,000 identity cap) and prove recipient
  ownership with NUT-07;
- B 1,000, C 1,500, B 2,000 late, D 2,500 late; certify each displacement and
  import each cooperative full-pool return, including an offline displaced
  browser after its admission package was pre-signed;
- close and deliver exactly 2,500 to the seller;
- reserve 5,000/top bid 3,000 no-sale and import the exact full-pool return;
- response loss before mint, after request acceptance and after mint result but
  before persistence; resume the same operation with no second spend;
- one validator unavailable and one signer-policy service unavailable while
  the remaining three complete; reject when fewer than three authenticate;
- stop and restart coordinator/signers; reject stale journal/database/anchor
  restoration and leave all affected value unavailable/quarantined;
- duplicate, reordered and cross-auction operations; prove one global proof-Y
  owner and exclusive branch completion;
- exact deadline, extension cap, keyset/fee/DLEQ mismatch and mint-down close.

Every case records actual proof-Y input/output sets, operation identities,
NUT-07 states, recipient import, canonical Comet commits and FIPS packet/socket
evidence without bearer secrets. Unit mocks are reported separately.

## Browser QA and release gate

At phone width, verify funding/bid/history/pending/completed displays and all
permanent fake-money/custody/FROST/coordinator/one-operator disclosures. No
pending or unknown result may appear spendable or paid. The authority status
must expose quarantine without private state; no browser route can trigger a
terminal payout/refund or supply a reader/signer/anchor.

The final candidate then needs independent adversarial review. Deployment is a
separate exact approval and must use clean Friday blue/green paths; it must not
reuse, migrate, overwrite or stop the Wednesday fallback.
