# Auction Multiparty Payout Schedule Wire Profile — Handover

**Date:** 2026-08-21
**Owner:** @maximotodev
**Repository:** `PlebeianApp/market`
**Working copy:** `~/dev/market-auction-multiparty-demo`
**Base:** `upstream/auctions` at `cc200f1702e6a451a6052a989daca492fbf51e3f`
**Checkpoint branch:** `wip/auction-multiparty-demo-2026-08-21`

## Executive summary

The multiparty payout wire work is implemented through the durable activation-authority boundary (Gate C4b) and is locally green.

The implementation is intentionally additive. Existing single-party auction wire/parsers/builders/validation remain untouched.

The next unfinished step is **Gate D1: pure multiparty manifest projection**. A D1 design/candidate was prepared but **has not been applied or validated** at this checkpoint.

This branch is **not production-ready and must not be used with real sats**.

## Frozen implementation state

### Gate A — canonical payout schedule codec — FROZEN

- `src/lib/auction/multipartySchedule.ts`
  - SHA-256: `677a8db8ceafc11535c9459fc733be376315a22f0a1de2e6183885fccbb2fab8`
- `src/lib/__tests__/auctionMultipartySchedule.test.ts`
  - SHA-256: `d99414f6594289c4d5e57fa0cd1bf5b256d05c485d1f24dc0d42659fd1096013`

Profile:

`cashu_p2pk_bidder_path_multiparty_v1`

Key properties:
- canonical schedule ordering;
- validator before V4V;
- canonical uints;
- max 16 entries;
- max 4096 canonical bytes;
- exact SHA-256 commitment domain;
- V4V rows cannot carry validator offer IDs;
- seller remains the residual allocation.

### Gate B — deterministic sat allocator — FROZEN

- `src/lib/auction/multipartyAllocator.ts`
  - SHA-256: `1fb4f201483293b3c759b89679e93e2273e261c43ae34ecea5e40748135a1d71`
- `src/lib/__tests__/auctionMultipartyAllocator.test.ts`
  - SHA-256: `e8b971d9493ce9d1549c393c76e6ad610e62f75bc2e992b361c4e8b19edfa7ca`

All allocation arithmetic is `bigint`; no floating point.

Regression:

- validator: 625 bps
- V4V: 313 bps
- seller: 9062 bps
- principal: 1024 sats
- result: seller 928 / validator 64 / V4V 32

Important unresolved proof task:
- randomized/adversarial recurrence checks passed;
- a general lower-quota theorem proof remains open and should be handled as a separate read-only/property proof exercise before a final production-ready verdict.

### Gate C1 — pure authorization semantics — FROZEN

- `src/lib/auction/multipartyAuthorization.ts`
  - SHA-256: `61986914d5fee9c556f173844570d2705df407cdfc6f4e635ad8a2d483fabf08`
- `src/lib/__tests__/auctionMultipartyAuthorization.test.ts`
  - SHA-256: `42fec66aa6ce7c7e08d1058cd0bcc3dfd59377cf012ea0e41bf3b24b1de2f2df`

Profile-private regular immutable kinds:

- 1027 — payout capability
- 1028 — validator offer
- 1029 — exact-root validator acceptance
- 1030 — seller activation

C1 is bounded/fail-closed and does not perform relay, wallet, Cashu, persistence, or crypto I/O.

### Gate C2 — crypto authentication — FROZEN

- `src/lib/auction/multipartyAuthorizationCrypto.ts`
  - SHA-256: `b207fcc9697f84c45bc15721499e705dbfca5a22c0c082e81c47cb2f7277dda1`
- `src/lib/__tests__/auctionMultipartyAuthorizationCrypto.test.ts`
  - SHA-256: `2d3a2b17e990ba9d5c204f9cf92858dd97040e44ff31bc30ef4cb71b9d7f786a`

Direct dependency:
- `@noble/curves@2.0.1` exact

Crypto boundary:
- NIP-01 event verification;
- whole-xpub BIP340 proof-of-possession;
- process-local WeakSet provenance.

### Gate C3 — exact authorization-ready bundle — FROZEN

- `src/lib/auction/multipartyAuthorizationBundle.ts`
  - SHA-256: `49311dcb255eae0451e1a67679a4690432a8911dacb0c8fe7b47b46ce8c5460d`
- `src/lib/__tests__/auctionMultipartyAuthorizationBundle.test.ts`
  - SHA-256: `68521fa210b2d19de255d950a597ad01a46aaba076ab2331a815815967f36118`

Boundary:

`authorization_ready != fundable`

It proves:
- bounded candidate cardinalities;
- C2 crypto authentication;
- exact C1 authorization relationships.

It does not prove:
- full auction listing validity;
- sticky activation conflict absence;
- mint usability;
- Cashu construction;
- wallet ownership/state;
- settlement.

### Gate C4a — monotonic activation-authority state machine — FROZEN

- `src/lib/auction/multipartyActivationAuthorityState.ts`
  - SHA-256: `aa57cefee72c1a36e0e9496115324cdd2d115c0bae3873c3904d551396c88a5b`
- `src/lib/__tests__/auctionMultipartyActivationAuthorityState.test.ts`
  - SHA-256: `221d54350b312cc0768766895ea575f55bc45613e7066a97bc2cee7c95a0c7f1`

State invariant:

- none + A -> `[A]`, clear
- `[A]` + A -> idempotent clear
- `[A]` + B -> canonical `[A,B]`, sticky conflict
- conflict + anything -> conflict remains sticky

No transition clears previously observed equivocation.

### Gate C4b — durable activation-authority ledger — FROZEN

- `src/lib/auction/multipartyActivationAuthorityLedger.ts`
  - SHA-256: `a619aa78e99ea1d608b1c840b8b6121ae739dde43017f3822bcd4b57a37eded0`
- `src/lib/__tests__/auctionMultipartyActivationAuthorityLedger.test.ts`
  - SHA-256: `22a45518d56455932b3c5e6617a6c32bfc3407f7f0a6e5cba86296168c943819`

Test dependency:
- `fake-indexeddb@6.2.5` exact dev dependency

Frozen dependency identities:
- `package.json`
  - SHA-256: `855a7c2143be89cf40a6dabf30d3af29c4bfba89d3d38a09e86c0fa193c4c602`
- `bun.lock`
  - SHA-256: `a7a38b49cb3785dba81c0625892e0c56821c619aac8ec1f586097214466053f5`

Durability invariant:
- first qualifying activation is committed before durable-clear authority is returned;
- distinct activation commits sticky conflict;
- concurrent A/B observations serialize through the same IndexedDB readwrite domain;
- restart preserves conflict;
- malformed persisted records fail closed;
- unavailable IndexedDB fails closed;
- forced `store.put()` failure aborts and returns no durable-clear authority;
- retry after failed write is again `changed=true`, proving no authority record leaked through the failed transaction.

Final A→C4b train:

- 161 pass
- 0 fail
- 24,574 assertions
- 341 existing repo TypeScript diagnostics unchanged
- 0 C4b diagnostics
- durability static gate PASS
- boundary gate PASS
- diff safety PASS

## Economic semantics resolved for Gate D

The existing auction implementation establishes:

- kind-1023 `amount` = cumulative bid value;
- a rebid locks only `new amount - previous amount`;
- local `legLockedAmount` = sats actually locked by that leg;
- settlement reconstructs each leg as the difference between successive cumulative bid amounts.

For the multiparty profile:

- `gross_sats` = cumulative bid value;
- `principal_sats` = sats newly locked by this specific bid leg;
- first bid: `principal_sats = gross_sats`;
- rebid: `principal_sats = gross_sats - previous_bid.gross_sats`;
- Gate B allocation input is `principal_sats`, never cumulative `gross_sats`.

Cashu input/construction fees are not payout entitlement:
- payout rows sum to principal;
- construction fee/change accounting belongs to the Cashu construction/journal gates, not the payout schedule.

Regression target for later construction:
- selected inputs: 2048
- construction fee: 1
- principal: 1024
- seller: 928
- validator: 64
- V4V: 32
- bidder change: 1023

## Next unfinished work

### Gate D1 — multiparty manifest projection

Status: **LOCAL UNTRACKED DRAFT / NOT VALIDATED / NOT INCLUDED IN THIS CHECKPOINT**

Two D1 draft files currently exist locally:

- `src/lib/auction/multipartyManifest.ts`
- `src/lib/__tests__/auctionMultipartyManifest.test.ts`

They are intentionally untracked and excluded from this checkpoint. They have not passed the D1 gate and must not be treated as frozen or production-ready. Re-review them against the frozen interfaces before deciding whether to continue from, replace, or discard the draft.

Intended D1 boundary:
- pure/additive module;
- no IndexedDB;
- no Nostr publication;
- no wallet/Cashu I/O;
- deterministic projection over normalized authorization relations + Gate-A schedule + Gate-B allocation;
- seller payout first, then canonical schedule order;
- zero-sat logical payout stays represented but has no child/proof/token artifact;
- positive payout requires child key, lock secrets, proof Ys, and a SHA-256 commitment to the exact Cashu token string;
- no derivation path in kind-1023;
- construction fee and bidder change are not payout rows.

Then:
1. D2 canonical manifest wire/parse.
2. E multiparty Cashu construction.
3. F durable construction journal / ambiguous swap recovery.
4. G NIP-60 transition/signing.
5. H multiparty path release.
6. I redemption isolation.
7. J multiparty settlement.
8. K restart/full E2E.

## Important remaining production blockers

Do not describe this checkpoint as production-ready.

Still required:
- full multiparty-compatible auction-root business validation;
- manifest wire + integration into kind-1023;
- actual multiparty Cashu output construction;
- pre-swap durable journal and exactly-once/ambiguous-result recovery;
- NIP-60 state transition correctness;
- multiparty release validation;
- payout redemption isolation;
- settlement semantics;
- restart E2E;
- Gate-B proof/property hardening;
- concrete revocation/compromise semantics remain undefined.

No real-money activation or deployment is authorized by this checkpoint.

## Files intentionally changed in this checkpoint

- `package.json`
- `bun.lock`
- `src/lib/auction/multipartySchedule.ts`
- `src/lib/auction/multipartyAllocator.ts`
- `src/lib/auction/multipartyAuthorization.ts`
- `src/lib/auction/multipartyAuthorizationCrypto.ts`
- `src/lib/auction/multipartyAuthorizationBundle.ts`
- `src/lib/auction/multipartyActivationAuthorityState.ts`
- `src/lib/auction/multipartyActivationAuthorityLedger.ts`
- corresponding seven focused test files under `src/lib/__tests__/`

Existing single-party files such as `events.ts`, `tagBuilders.ts`, `bidEvent.ts`, `validation.ts`, `bidderRecords.ts`, `publish/auctions.tsx`, and `stores/nip60.ts` were inspected but not modified for these gates.

## Suggested restart procedure

1. Fetch latest upstream.
2. Confirm this checkpoint branch still contains the frozen hashes above.
3. Compare `upstream/auctions` with base `cc200f1702e6a451a6052a989daca492fbf51e3f`.
4. Re-run the A→C4b focused train.
5. Reconfirm the 341-diagnostic TypeScript baseline has not changed unexpectedly.
6. Re-review Gate D1 against any upstream drift before applying it.
7. Do not reopen frozen A–C4b files unless a concrete defect or upstream incompatibility is demonstrated.
