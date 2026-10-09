# Auction Multiparty V4V C2 / Predecessor / D1 Handover — 2026-09-18

## Executive status

This branch contains the historical Auction Multiparty Payout Schedule Wire Profile foundation plus three
additional local slices prepared for maintainer review:

1. Gate C2 exact-envelope ownership hardening.
2. Authenticated multiparty bid-leg predecessor provenance.
3. Gate D1 pure multiparty manifest projection, including owned-observation and bounded-traversal repairs.

The profile remains:

`cashu_p2pk_bidder_path_multiparty_v1`

The latest D1 candidate is locally green and ready for another Red Team rerun. It has **not** been declared
accepted or production-ready. D2 wire encoding, monetary construction, wallet integration, and settlement
remain out of scope.

## Branch and review target

- Repository: `PlebeianApp/market`
- Branch: `wip/auction-multiparty-demo-2026-08-21`
- Historical checkpoint before these commits: `c8ce9e68d4b82aa0cdec12656da580250e127385`
- Draft PR: [#1272](https://github.com/PlebeianApp/market/pull/1272)
- PR target branch: `auctions`
- Historical PR base reported by GitHub on 2026-09-18:
  `c057ec3bd22526dc334eef857a6ba6431b4e1d99`
- Current fetched `upstream/auctions` on 2026-09-18:
  `09e42ae4678226c775fdbe29a72916f9054a48a9`

Do not assume the historical branch can be rebased mechanically. Current upstream includes substantial
auction validity, winner-selection, Applesauce migration, settlement, UI, and test changes.

## Slice 1: C2 exact-envelope ownership hardening

Files:

- `src/lib/auction/multipartyAuthorizationCrypto.ts`
- `src/lib/__tests__/auctionMultipartyAuthorizationCrypto.test.ts`

The authentication entry points now:

- observe every caller-owned Nostr envelope scalar once;
- bound and copy outer tags, inner tag arrays, and tag elements;
- parse and verify the same owned snapshot;
- derive authenticated event identity from that snapshot;
- avoid transferring caller-owned `nostr-tools` verification-cache symbols;
- isolate authenticated semantics from later caller mutation.

The repair closes split-envelope cases where parsing, signature verification, and branded output could
observe different values from getters or mutable tag aliases. It does not change C1 wire semantics or
weaken signature or whole-xpub proof-of-possession checks.

## Slice 2: authenticated bid-leg predecessor provenance

Files:

- `src/lib/auction/multipartyBidLegContext.ts`
- `src/lib/__tests__/auctionMultipartyBidLegContext.test.ts`

`ValidatedMultipartyBidLegContext` is the sole D1 authority for:

- the multiparty settlement profile;
- auction root identity;
- cumulative current gross;
- authenticated predecessor event identity and gross;
- newly locked principal.

For a first bid, principal equals current gross. For a rebid, principal equals current cumulative gross
minus the authenticated direct predecessor gross. Raw caller predecessor economics cannot manufacture a
genuine context.

The builder owns exact Nostr envelopes before verification, validates the supplied predecessor graph,
enforces bounded event/tag/content shapes, and uses process-local provenance. Structural or serialized
clones are not genuine contexts.

## Slice 3: D1 pure manifest projection

Files:

- `src/lib/auction/multipartyManifest.ts`
- `src/lib/__tests__/auctionMultipartyManifest.test.ts`

D1 follows this boundary:

```text
caller-owned data
  -> one bounded owned observation
  -> validation of owned/canonical values
  -> projection from owned/canonical values only
  -> process-local manifest_projected provenance
```

### Schedule and commitment authority

- `input.schedule` is observed once.
- `canonical_bytes` is observed once and copied into an owned `Uint8Array`.
- Gate A parses the owned bytes.
- The caller commitment is captured once and validated against those parsed bytes.
- The relation commitment is captured once and must match the resulting commitment.
- Caller-derived schedule entries, ordering, totals, and indexes are non-authoritative.

This closes the reproduced equal-length mutation from schedule A (`625 / 313`) to schedule B
(`624 / 314`) that previously allowed schedule-A semantics to be paired with commitment B.

### Relation and identity authority

- Relation root, activation, commitment, mints, and bindings are observed once.
- Binding count must equal the canonical schedule entry count before indexed traversal.
- Every consumed binding field is copied into an owned plain record.
- Gate-A entries remain authoritative for schedule index, role, recipient, payout capability,
  validator offer, and allocation.
- Relation bindings must match those fields.
- Only relation-only validator acceptance metadata is emitted from the owned binding snapshot.

Relation data remains projection input, not proof of authorization.

### Resource bounds reused from C1

D1 reuses the frozen C1 limits:

- `AUCTION_MULTIPARTY_MAX_MINTS = 16`
- `AUCTION_MULTIPARTY_MAX_MINT_BYTES = 2048`

Mint count is checked before traversal. Admitted mint values are copied once, must be strings, and are
checked by UTF-8 byte length. No new D1 wire policy was introduced.

Bindings and auxiliary construction rows must exactly match the Gate-A schedule count before traversal.
Gate A already limits that count to 16.

No proof-count, secret-count, token-byte, or aggregate monetary-evidence limit was invented in D1.
Allocation/copy failures are normalized, but resource policy for serialized monetary evidence remains a
D2/composition decision.

### Economic and construction boundary

- The genuine bid-leg context supplies gross, predecessor identity/gross, and principal.
- Compatibility mirrors must match but are not authoritative.
- Gate B allocates principal, never cumulative rebid gross.
- Seller is emitted first, followed by Gate-A canonical auxiliary order.
- The `1024 -> 928 / 64 / 32` regression is preserved.
- Zero-sat logical rows remain present and must carry no Cashu artifacts.
- Positive rows require the existing opaque construction fields.
- Exact child key, secret, proof-Y, and token-hash reuse is rejected.
- Construction inputs are observed once and copied before validation or projection.
- Raw Cashu bearer tokens are not returned; D1 emits only their SHA-256 commitments.

D1 does **not** establish that a token is valid, correctly valued, from the selected mint, correlated with
the supplied secrets/proof Ys, P2PK-locked to the child key, wallet-owned, or spendable.

## Trust-boundary statement

`manifest_projected` means only that the exact D1 function produced the immutable projection.

It does not mean:

- C3 authorization-ready;
- C4b activation-clear;
- fundable;
- wallet-owned;
- Cashu-valid;
- NUT-12/DLEQ-valid;
- durably constructed;
- published;
- settled;
- redeemed or refunded.

Do not use D1 provenance as a monetary or authorization permit.

## Exact file hashes at handover

| Slice               | Source SHA-256                                                     | Test SHA-256                                                       |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Gate A              | `677a8db8ceafc11535c9459fc733be376315a22f0a1de2e6183885fccbb2fab8` | `d99414f6594289c4d5e57fa0cd1bf5b256d05c485d1f24dc0d42659fd1096013` |
| Gate B              | `1fb4f201483293b3c759b89679e93e2273e261c43ae34ecea5e40748135a1d71` | `e8b971d9493ce9d1549c393c76e6ad610e62f75bc2e992b361c4e8b19edfa7ca` |
| Gate C1             | `61986914d5fee9c556f173844570d2705df407cdfc6f4e635ad8a2d483fabf08` | `42fec66aa6ce7c7e08d1058cd0bcc3dfd59377cf012ea0e41bf3b24b1de2f2df` |
| Gate C2 repaired    | `b2a03bab85dcbf0cc427ec68e8a2d85984987c94856dde668965a969277a4dbd` | `9fe476e5b12d5983d705f0f957b0b04ac27472f49ec22c9c2d31a31f20069414` |
| Gate C3             | `49311dcb255eae0451e1a67679a4690432a8911dacb0c8fe7b47b46ce8c5460d` | `68521fa210b2d19de255d950a597ad01a46aaba076ab2331a815815967f36118` |
| Gate C4a            | `aa57cefee72c1a36e0e9496115324cdd2d115c0bae3873c3904d551396c88a5b` | `221d54350b312cc0768766895ea575f55bc45613e7066a97bc2cee7c95a0c7f1` |
| Gate C4b            | `a619aa78e99ea1d608b1c840b8b6121ae739dde43017f3822bcd4b57a37eded0` | `22a45518d56455932b3c5e6617a6c32bfc3407f7f0a6e5cba86296168c943819` |
| Bid-leg predecessor | `b62f97bc48f1ba38ad5920145ef4954140054cd38b96776604e060b2712724c6` | `5f0d5cc913d79c7535b243f17658b17b46203da4848e96af467c53ced4fe5247` |
| Gate D1 candidate   | `37259bb20a354f83bf24769a0dba0f64dd4ad6f8ef06f0fbfe92f6839c358053` | `be1eb40b02fc37c92c5bd628a93dc50045ae5746a12f05719e02d1eb1e998761` |

## Validation recorded before push

- D1 focused suite: 74 passed, 0 failed, 241 assertions.
- Frozen predecessor + repaired C2: 84 passed, 0 failed, 392 assertions.
- Complete Gate A through D1 train: 310 passed, 0 failed, 25,178 assertions.
- Relevant local bid/status/chain/release suites: 84 passed, 0 failed, 147 assertions.
- Focused Prettier: clean.
- `git diff --check`: clean.
- Focused TypeScript: no D1 diagnostics; one unchanged Gate-A diagnostic remains at
  `multipartySchedule.ts:382`.
- Repository-wide TypeScript baseline: 495 diagnostics, none referencing the D1 files.

These results establish local regression status only. They are not Red Team acceptance.

## Current upstream overlap

As of 2026-09-18:

- `upstream/auctions`: `09e42ae4678226c775fdbe29a72916f9054a48a9`
- PR #1272 is still an open draft.
- [PR #1280](https://github.com/PlebeianApp/market/pull/1280) remains open at
  `36cfdbd0d270445da36c5e5e90047be310a2003f` and carries current NUT-12/DLEQ and auction-validation work.
- [PR #1289](https://github.com/PlebeianApp/market/pull/1289) merged at
  `d66298d5d368563e2d28d49bafc024157a450ffb`.

No current upstream file directly replaces the C2 repair, predecessor module, or D1 module. However,
upstream has materially changed `bidValidation.ts`, `validation.ts`, winner derivation, settlement
checks, and related tests. Integration must compare behavior rather than assume clean textual rebasing.

## Explicitly deferred work

Do not start these merely because this branch is available:

- D2 canonical manifest wire/parser/commitments;
- C3/C4b admission composition for funding authority;
- Cashu token decoding or proof-value accounting;
- secret/proof-Y/hash-to-curve correlation;
- P2PK/xpub child derivation validation;
- NUT-12 DLEQ integration;
- proof/token aggregate resource policy;
- monetary construction, refund, redemption, or release execution;
- Coco wallet mutation or migration;
- NIP-60 authority changes;
- real mint, relay, wallet, or sats operations.

## Recommended takeover sequence

1. Verify this document's hashes against the checkout.
2. Review the three commits independently: C2, predecessor provenance, then D1.
3. Rerun the focused suites and the complete A-D1 train.
4. Perform `V4V_D1_RED_RERUN_03` against the exact D1 hashes above.
5. If D1 survives Red Team review, decide whether to freeze it before designing D2.
6. Before integration, compare the branch with current `upstream/auctions` and PR #1280; do not rebase
   or cherry-pick blindly.
7. Keep wallet/Coco integration separate until an explicit composition work order fixes the accepted D2
   and Coco targets.

## Handover status

`V4V_D1_OWNED_OBSERVATION_REPAIRED_AND_GREEN`

`V4V_D1_READY_FOR_RED_TEAM_RERUN_03`

This is a Builder handover, not a gate PASS.
