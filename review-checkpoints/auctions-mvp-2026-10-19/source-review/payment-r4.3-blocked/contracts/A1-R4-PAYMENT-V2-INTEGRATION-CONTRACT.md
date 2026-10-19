# A1 payment/FROST V2 integration contract

Date: 2026-10-19 UTC  
Status: `FROZEN_FOR_NEXT_INTEGRATION_DELTA`; review-only; no source authorization implied

## 1. Frozen inputs and baseline

- Constitution SHA-256: `6b653a8834776b820ba36737c5af0fef55951ae279baff96cae948a6d541ed62`.
- ADR-001 SHA-256: `ed2c54ba0f44c08d645db8531ed68ab86466825d7e787cd3fec4a8b0fe486437`.
- Payment R16 staged acceptance SHA-256: `49d17fdd968766d8fcfe8ca3e96492727f5be68fae2bdc29e23c51f5a38c3818`.
- Payment R16 overlay SHA-256: `935749707a39f4abc5d6577a9d5108b9ab22b1aa70e0ee25d3c4d9601f9f9e31`.
- Current payment R3 candidate seal SHA-256: `0ee8df48992dacf8b67cf7955986c9aa2342d913775eeee3d1bb870071956b42`.
- Current payment R3 post-source manifest SHA-256: `5770431449dee667a327275b11ef608fc18e4de42d106647003e830eb6d89fe6`.
- Current payment R3 review packet SHA-256: `5c05acb3a9c7840a7d8a4143c962e492442602ceed9a63321e541cb9c233f8a2`.
- Current FIPS/UI R5 seal SHA-256: `b5ce96136c7db50aec4f59a656e90a09aa130bbfd2d31fceaf71d60ecb9a615e`.
- Current FIPS/UI R5 review packet SHA-256: `03a2e06c5dbce3d9cd2aeccef71a5974aad8c36a7b4b84e5afa531fd2e532b71`.

The payment R3 seal and FIPS/UI R5 seal both verified before this contract was
written. R3 source remains unchanged. The earlier canonical-encoding mismatch
is closed by R5 and is not a blocker carried into this contract.

## 2. Canonical bytes and domains

All V2 objects reject missing, extra, duplicate, or wrongly typed fields. All
integers are checked JavaScript-safe integers. Hex is lowercase. Canonical JSON
is the R5 cross-runtime encoding: frozen field order, UTF-8 byte ordering where
sorting is specified, HTML escaping disabled, U+2028/U+2029 escaped, and lone
UTF-16 surrogates normalized to U+FFFD only for in-memory commitment values.
Strict wire JSON containing a lone surrogate rejects.

Every displayed domain is ASCII including its final NUL byte. Except for the
unchanged whole-history digest stated below, a digest is
`SHA-256(domain || canonicalPayloadBytes)`:

```text
COCO_DEMO_PAYMENT_APPROVAL_V2\x00
COCO_DEMO_PAYMENT_APPROVAL_SET_V2\x00
COCO_DEMO_AUTHENTICATED_PAYMENT_EVIDENCE_V2\x00
COCO_DEMO_PAYMENT_COMPLETION_V2\x00
COCO_DEMO_PROOF_STATE_REFS_V2\x00
COCO_DEMO_COMMITTED_AUCTION_HISTORY_CHUNK_V2\x00
COCO_DEMO_COMMITTED_AUCTION_HISTORY_ROOT_V2\x00
```

The recipient import idempotency key remains the accepted R16 value
`SHA-256(UTF8("COCO_DEMO_RECIPIENT_IMPORT_V1\0" || recipientRequestDigest))`.
It is not reinterpreted as an approval or completion digest.

## 3. ApprovalV2 exact schema and signed event

The only accepted literals are:

```text
schema = "DemoPaymentApprovalV2"
approvalLifetimePolicyVersion = "terminal-bound-exact-operation-v1"
refundKeyVersion = "separate-cashu-refund-key-v1"
kind = 28643
```

The full approval canonical field order is:

```text
schema, authNetworkId, chainId, auctionId, operationId, bidId, bidEventId,
bidderActorId, bidderCashuPublicKey, refundCashuPublicKey, refundKeyVersion,
amount, mintUrl, sellerP2pkXpub, sellerDerivationPath,
sellerRecipientPublicKey, conditionFingerprint, winnerPackageDigest,
refundPackageDigest, closeTime, settlementWindowSeconds, validUntil, locktime,
approvalLifetimePolicyVersion, approvalCreatedAt, approvalEventId,
approvalSignature
```

The kind-28643 event has `pubkey == bidderActorId`,
`created_at == approvalCreatedAt`, and exactly these ordered tags:

```json
[["protocol","plebeian-auction-fake-ecash-payment"],
 ["version","2"],
 ["environment","<authNetworkId>"],
 ["bid_event","<bidEventId>"]]
```

Its content is the R5-canonical JSON object with this exact snake-case field
order and no other fields:

```text
schema, auth_network_id, chain_id, auction_id, operation_id, bid_id,
bid_event_id, bidder_cashu_public_key, refund_cashu_public_key,
refund_key_version, amount, mint_url, seller_p2pk_xpub,
seller_derivation_path, seller_recipient_public_key, condition_fingerprint,
winner_package_digest, refund_package_digest, close_time,
settlement_window_seconds, valid_until, locktime,
approval_lifetime_policy_version
```

The event id and BIP340 signature use the standard Nostr event serialization
`[0,pubkey,created_at,kind,tags,content]`. `approvalDigest` is the approval
domain hash of the complete canonical approval, including event id and
signature. The approval-set digest is the set-domain hash of full verified
approvals sorted by the UTF-8 byte tuple `(authNetworkId, chainId, auctionId,
operationId, approvalEventId)`. Duplicate operation tuple, approval event id,
bid event id, bid id, or approval digest rejects; there is no last-write-wins.

V1 approvals remain readable only for historical audit/display. A V1 approval
cannot enter the V2 approval-set digest, produce V2 authenticated evidence, or
authorize execution. There is no implicit V1 upgrade or V2 fallback.

## 4. Identity, exact branches, and timing

- `A = bidderActorId`: lowercase 32-byte x-only Nostr actor key.
- `B = bidderCashuPublicKey`: compressed MAIN Cashu key.
- `C = refundCashuPublicKey`: compressed REFUND Cashu key.
- `D = committeePublicKey`: compressed committee aggregate key.

Their x-coordinates are pairwise distinct. They also cannot alias a validator,
seller root, derived seller child, or role-selected recipient where the R16
rules prohibit it.

Every immutable input must rebuild byte-for-byte as:

```json
["P2PK",{"nonce":"<32-byte-lowercase-hex>","data":"<B>","tags":[
  ["pubkeys","<D>"],
  ["n_sigs","2"],
  ["sigflag","SIG_ALL"],
  ["locktime","<decimal locktime>"],
  ["refund","<C>"]
]}]
```

Every input has the same B, C, D, and locktime and a unique nonce. The REFUND
branch recipient capability must be signed by C, name C as recipient, and bind
the exact refund outputs. The MAIN capability binds the derived seller child
and exact MAIN outputs. B signs the exact Cashu SIG_ALL digest and exact package;
A signs the exact package/approval. C signs the exact REFUND SIG_ALL digest.
The mint capability seal, keyset, fee, inputs, outputs, package digest,
recipient capability digest, and Cashu SIG_ALL digest are reloaded from the
already signed R16 branch and exact-matched before use.

Cashu remains bidder-plus-committee NUT-11 2-of-2. Committee authorization is
one BIP340-compatible FROST 3-of-4 aggregate; it does not change `n_sigs` to 3
or 4 and does not create a second consensus quorum.

No mesh identity, validator/maintainer session, web/auth session, authenticated
transport, or injected port confers payment authority. Those mechanisms may
carry evidence only; authority comes from the exact verified consensus/raw-event
join, ApprovalV2, R16 branch signatures/capability/seal, and role rules above.

The terminal-bound policy is exact:

1. `0 < approvalCreatedAt <= bundle.preparedAt <= admission.admittedAt <=
   min(validUntil, closeTime)`.
2. `closeTime <= validUntil`, `settlementWindowSeconds >= 60`, and checked
   safe-integer arithmetic requires
   `closeTime + settlementWindowSeconds <= locktime - 60`.
3. `validUntil` is a pre-admission deadline, not a post-admission revocation.
   After exact durable admission, the approval remains usable only for its
   immutable operation/branches until verified terminal completion.
4. A new MAIN FROST session or aggregate may start only while
   `nowSeconds < locktime - 60`; equality rejects. A complete, verified, durably
   persisted MAIN signature is not revoked by `validUntil`, the MAIN cutoff, or
   locktime. No timer invalidates a completed signature.
5. REFUND is ineligible while `nowSeconds < locktime` and eligible at equality.
   R16 early return is omitted. REFUND authorization does not revoke retained
   MAIN. After locktime either exact branch can reach the mint; the mint's
   atomic first spend remains authoritative. Cryptography does not remove this
   disclosed race.
6. An unknown response is non-terminal and forbids blind retry. A retry requires
   an authoritative persisted `safe_to_retry` fence and reuses the exact scope,
   operation root, request digest, proof-state refs, mint seal, recipient
   capability, and ordered outputs. It cannot originate a new post-cutoff MAIN
   signature.
7. Once exact mint terminal metadata is durable, only response restoration and
   idempotent recipient import may continue. Once terminal metadata plus exact
   recipient import are verified, no signature, mint request, alternate role,
   or timer transition can reopen the operation.

Unknown network ids, chain ids, seller xpub/path, mint origins, mint seals,
keysets, committee rosters/versions, or operational clock values fail closed.

## 5. Authenticated evidence and bounded complete history

`DemoAuthenticatedPaymentEvidenceV2` has this exact canonical field order:

```text
schema, authNetworkId, chainId, auctionId, operationId, bidId, bidEventId,
bidderActorId, bidderCashuPublicKey, refundCashuPublicKey, refundKeyVersion,
role, amount, recipientPublicKey, outcomeHeight, outcomeAppHash,
approvalLifetimePolicyVersion, validUntil, locktime, approvalEventId,
approvalDigest, packageDigest, cashuSigAllDigest, recipientCapabilityDigest,
outputsDigest, proofStateRefsDigest, canonicalBatchHistorySha256,
verifiedApprovalSetSha256, successorCommitVerified,
rawSignedEventVerified, paymentApprovalVerified,
approvalLifetimePolicyVerified
```

Its schema is `DemoAuthenticatedPaymentEvidenceV2`; the final four flags are
literal `true`. `proofStateRefsDigest` is the proof-state domain hash of the
ordered canonical compressed public refs. The evidence digest is the evidence
domain hash. Evidence contains no proof secret, witness, mint signature,
opening, blinding factor, share, nonce, bearer token, or approval-only field in
`CommittedAuctionBatchV2`.

The storage owner, not A1 payment or FIPS/UI, supplies a chain-wide immutable
history port. Its frozen bounds are 64 batches and 4,194,304 canonical batch
bytes per chunk. Empty heights appear as ordinary empty
`CommittedAuctionBatchV2` values. `batchCount == throughHeight`, heights are
contiguous from 1, and the final batch exact-matches `throughHeight` and
`throughAppHash`.

The exact port surface is:

```ts
interface DemoCommittedAuctionHistoryOpenV2 {
  readonly schema: "DemoCommittedAuctionHistoryOpenV2";
  readonly authNetworkId: string;
  readonly chainId: string;
  readonly firstHeight: 1;
  readonly throughHeight: number;
  readonly throughAppHash: string;
  readonly immutableStorageMarker: string;
  readonly storageRootSha256: string;
  readonly chunkCount: number;
  readonly batchCount: number;
  readonly maxBatchesPerChunk: 64;
  readonly maxCanonicalBatchBytesPerChunk: 4194304;
  readonly finalChunkDigest: string;
  readonly canonicalBatchHistorySha256: string;
}

interface DemoCommittedAuctionHistoryChunkV2 {
  readonly schema: "DemoCommittedAuctionHistoryChunkV2";
  readonly immutableStorageMarker: string;
  readonly storageRootSha256: string;
  readonly index: number;
  readonly firstHeight: number;
  readonly lastHeight: number;
  readonly previousChunkDigest: string;
  readonly batches: readonly CommittedAuctionBatchV2[];
  readonly chunkDigest: string;
}

interface DemoCommittedAuctionHistoryPortV2 {
  open(request: {
    readonly authNetworkId: string;
    readonly chainId: string;
    readonly throughHeight: number;
    readonly throughAppHash: string;
  }): Promise<DemoCommittedAuctionHistoryOpenV2 | null>;
  readChunk(request: {
    readonly immutableStorageMarker: string;
    readonly storageRootSha256: string;
    readonly index: number;
  }): Promise<DemoCommittedAuctionHistoryChunkV2 | null>;
}
```

For chunk `i`, the first previous digest is 32 zero bytes and:

```text
chunkDigest_i = SHA-256(
  ASCII("COCO_DEMO_COMMITTED_AUCTION_HISTORY_CHUNK_V2\0") ||
  hexDecode(previousChunkDigest) || uint64be(i) ||
  R5CanonicalUTF8({
    schema, immutableStorageMarker, index, firstHeight, lastHeight, batches
  })
)
```

The chunk body excludes `chunkDigest` and `storageRootSha256`. The final root
descriptor has exact order:

```text
schema, authNetworkId, chainId, firstHeight, throughHeight, throughAppHash,
immutableStorageMarker, chunkCount, batchCount, maxBatchesPerChunk,
maxCanonicalBatchBytesPerChunk, finalChunkDigest,
canonicalBatchHistorySha256
```

`storageRootSha256` is the history-root domain hash of that descriptor and is
not part of its own preimage. Independently, the consumer streams exact bytes
`[`, each already canonical batch separated by `,`, and `]` into plain SHA-256;
this result is `canonicalBatchHistorySha256`. It never materializes an
unbounded history or approval array. Durable keyed indexes hold per-operation
state; only one bounded chunk and bounded digest state are resident.

The consensus verifier still authenticates canonical blocks `1..H+1`, exact
payment-free `CommittedAuctionBatchV2` bytes through closure H, the H+1
canonical successor commit observed at H+2, and each raw kind-28642 signed
event. A storage marker/root or UI assertion alone confers no authority.

## 6. `processVerifiedBatches` atomic contract and outcomes

The shared payment-writer surface is:

```ts
interface DemoAuthenticatedPaymentCommitmentsV2 {
  readonly schema: "DemoAuthenticatedPaymentCommitmentsV2";
  readonly authNetworkId: string;
  readonly chainId: string;
  readonly auctionId: string;
  readonly closureHeight: number;
  readonly closureAppHash: string;
  readonly immutableStorageMarker: string;
  readonly storageRootSha256: string;
  readonly canonicalBatchHistorySha256: string;
  readonly verifiedApprovalSetSha256: string;
}

processVerifiedBatches(
  history: DemoCommittedAuctionHistoryPortV2,
  expected: DemoAuthenticatedPaymentCommitmentsV2,
): Promise<DemoPaymentBatchResult>;

recoverVerifiedBatches(
  history: DemoCommittedAuctionHistoryPortV2,
  expected: DemoAuthenticatedPaymentCommitmentsV2,
): Promise<DemoPaymentBatchResult>;
```

Both methods enter the existing exclusive execution lock before reading
authority. Inside that lock and before any committed-bid observation, closure claim,
committee/FROST call, mint/recovery call, recipient call, receipt, or state
effect, they must:

1. open and stream-verify the exact immutable history, both history digests,
   closure H/app hash, and the independent H+1/H+2 consensus receipt;
2. read exactly one persisted V2 approval for every exact committed operation,
   verify its raw bid event, identities, signatures, lifetime, branch package,
   recipient capability, and mint seal, and recompute the V2 approval-set digest;
3. exact-match both recomputed digests and every expected domain field;
4. recompute the closure and all dispositions from the verified batches; and
5. reload the exact durable R16 bundle, derive the selected template and
   selection root, and exact-match the operation, outputs, and evidence before
   any effect.

Missing/duplicate/reordered/oversized history, read drift, commitment mismatch,
or an absent/conflicting approval aborts with zero effects.

Outcome mapping is exact: `winner` sends only the certified winner to MAIN and
every other accepted bid to REFUND; `reserve_not_met` sends every accepted bid,
including the final highest bid, to REFUND; `no_bids` requires no accepted bid
and emits no payment disposition. No outcome is collapsed into another.

## 7. Durable completion and crash identity

The completion object has exact canonical field order:

```text
schema, evidenceDigest, selectionRoot, templateDigest, bundleDigest,
operationId, role, recipientPublicKey, amount, proofCount, mintRequestDigest,
mintResponseDigest, recipientRequestDigest, recipientResponseDigest,
recipientImportIdempotencyKey, terminalSource, completedAt, imported
```

Its schema is `DemoPaymentCompletionIdentityV2`; `role` is
`winner_settlement|refund`; `terminalSource` is the immutable persisted R16
terminal fact `mint_response|exact_recovery`; `completedAt` is that terminal's
Unix epoch milliseconds; and `imported` is literal `true`. The completion
digest uses the completion domain. It is persisted only after these equalities:

```text
proofCount == terminal.outputCount == recipient.proofCount
amount == terminal.amountTotal == recipient.amount == evidence.amount
operationId == recipient.operationId == evidence.operationId
recipientPublicKey == recipient.recipientPublicKey == evidence.recipientPublicKey
bundle/template/selection == the reloaded durable R16 branch identity
recipientImportIdempotencyKey == accepted R16 import-key derivation
terminalSource == durable terminal.source
```

`DemoAuthenticatedPaymentReceiptV2` is exactly `{schema, completion,
completionDigest, diagnostics}` in that order. Diagnostics are exactly
`{schema, deliverySource, alreadyImported, observedAt}`; `deliverySource` is
`submitted|terminal_restore|gate_replay`. Diagnostics never change completion
identity. In particular, a later restore does not rewrite `terminalSource`.
The receipt schema is `DemoAuthenticatedPaymentReceiptV2` and the diagnostics
schema is `DemoPaymentDeliveryDiagnosticsV2`.

The durable recovery identity is `(scope, operationRoot=templateDigest,
mintRequestDigest)`, with the exact proof refs, outputs, capability, mint seal,
and bundle/selection binding persisted before submission. Mint terminal metadata
is persisted before recipient delivery. Recipient import is journaled exactly
once by the accepted idempotency key. Crashes before submit, during unknown
response, after terminal persistence, and after wallet import resume only this
identity and cannot create an alternate request, output plan, recipient, role,
or completion digest.

## 8. Exact next-delta file allowlist and ownership

The A1 payment writer may modify only these current payment-R3 paths:

```text
market-app/plugins/demo-payment-coordinator.ts
market-app/e2e/demo-payment-coordinator.e2e.ts
market-app/plugins/demo-certified-disposition.ts
market-app/plugins/demo-certified-disposition.test.ts
market-app/plugins/demo-certified-wallet-adapter.ts
market-app/plugins/demo-certified-wallet-adapter.test.ts
market-app/plugins/demo-frost-participant-evidence.ts
market-app/plugins/demo-frost-participant-evidence.test.ts
market-app/plugins/demo-frost-proof-use-sqlite.ts
market-app/plugins/demo-frost-proof-use-sqlite.test.ts
market-app/plugins/demo-frost-proof-use-sqlite.child.ts
cashu-wrapper/ts/demo-maintainer-offline.ts
cashu-wrapper/ts/demo-maintainer-offline.test.ts
cashu-wrapper/ts/demo-maintainer-offline-sqlite.ts
cashu-wrapper/ts/demo-maintainer-offline-sqlite.test.ts
cashu-wrapper/ts/demo-sigall-disposition.ts
cashu-wrapper/ts/demo-sigall-disposition.test.ts
cashu-wrapper/ts/demo-sigall-settlement.ts
cashu-wrapper/ts/demo-sigall-settlement.test.ts
cashu-wrapper/ts/demo-sigall-recovery.ts
cashu-wrapper/ts/demo-sigall-recovery.test.ts
cashu-wrapper/ts/demo-sigall-recipient.ts
cashu-wrapper/ts/demo-sigall-recipient.test.ts
```

No FROST Rust/process file is in this delta because R3's sealed threshold-three
composition and durable participant proof-use/session/nonce behavior are
preserved, not redesigned. Any need to touch one stops for allowlist expansion.

FIPS/UI owns its R5 Go ingress/handoff/tool files and
`market-app/plugins/committed-bid-consumer.ts`,
`market-app/plugins/demo-certified-closure.ts`, and their tests in its own lane.
Storage owns the immutable marker/root/chunk implementation and adapter. A1
payment owns neither set and must not edit them. The teams may implement the
interfaces above independently; no file has two writers. `CommittedAuctionBatchV2`
canonical bytes remain unchanged and payment-free.

## 9. Focused acceptance evidence required for the next delta

- Cross-runtime ApprovalV2/event/set/evidence/history/completion vectors,
  including empty set, surrogate, ordering, duplicate, extra-field, and every
  one-field drift negatives.
- A/B/C/D alias negatives; wrong/missing C on any input; wrong C in the refund
  capability; wrong package, Cashu, output, capability, seal, or raw event.
- Admission and cutoff boundaries; no new MAIN at cutoff; retained completed
  MAIN after cutoff/locktime; REFUND before/at locktime; no early refund.
- Both mint first-spend race orders, without claiming FROST removes the race.
- Multi-chunk/empty-height streaming, 64/4,194,304 limits, missing/reordered
  chunks, self-reference exclusions, independent whole-history hash, H+1/H+2,
  and bounded-memory instrumentation.
- Execution-lock read drift and commitment mismatch with zero downstream calls.
- Exact `winner`, `reserve_not_met`, and `no_bids` disposition tests.
- Crash points before submit, unknown response, authoritative exact recovery,
  safe retry with unchanged identity, terminal restore, recipient import once,
  immutable terminal source, and completion replay.
- V1 audit read succeeds where supported but V1 execution always refuses.
- Targeted Bun suites and strict TypeScript. Existing Rust binaries are hash
  checked; `cargo test --offline --locked` is required only if a separately
  authorized Rust file changes.

No network, external mint, DKG, real share, real funds, listener, credential,
deployment, publication, commit, or push test is authorized.

## 10. Unresolved decisions / fail-closed checkpoints

1. The storage owner must accept the exact marker/root/chunk port and publish a
   sealed adapter identity. Until then `processVerifiedBatches` and recovery
   refuse before effects.
2. A0 must assign the integration order and exact handoff location for the
   independently sealed payment R3 and FIPS/UI R5 candidates. Neither candidate
   may be edited or merged merely by this contract.
3. Adding `bundleDigest`, `templateDigest`, or `selectionRoot` to the shared
   ApprovalV2 or authenticated-evidence schema is not authorized here. The
   payment lane derives and checks those existing R16 values internally and
   binds them in completion. A cross-lane schema addition requires a new exact
   owner grant.
4. Concrete production values for network, chain, seller xpub/path, mint seal,
   keyset, committee roster/version, storage marker/root, and clocks are not
   invented by this contract. Missing or unknown values refuse.
5. Independent review and real pass/fail/not-run evidence are required before
   any next-delta candidate can be called ready. No behavior in this contract
   is claimed implemented or tested yet.
