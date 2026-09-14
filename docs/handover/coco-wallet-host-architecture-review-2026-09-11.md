# Plebeian Wallet Host — architecture review checkpoint

**Status:** review artifact / architecture freeze candidate; implementation not authorized

**Date:** 2026-09-11

**Review hardening:** 2026-09-13

**As-is Red audit integration:** 2026-09-13

**Governing ADR:** ADR-0010 at `4cbe2b268247e8f3c72875f9d5e60696b38a7530`

**Purpose:** publish the current Wallet Host / Coco integration architecture so maintainers and independent reviewers can inspect the actual design, identify drift early, and comment before implementation resumes.

This document does **not** authorize wallet implementation, migration execution, production cutover, real funds, or a private Coco fork.

---

## 1. Decision carried forward from ADR-0010

Plebeian's approved direction remains:

> Adopt Coco if a pinned upstream release or commit can satisfy Plebeian's monetary-safety invariants without a permanent invasive Plebeian fork.

If the generic wallet-engine invariants cannot be maintained upstream, Coco adoption becomes **NO-GO** rather than moving the missing generic financial state machine into Plebeian.

Current architecture status:

- Coco remains the target Cashu wallet engine.
- A permanent Plebeian Coco fork is not acceptable.
- Current legacy rc11/NIP-60 paths remain transitional only.
- The **currently implemented wallet remains staging-only**; real-value use is NO-GO.
- I1B2 / production Coco integration remains paused.
- Wallet Host implementation remains unauthorized.
- Real-value use remains NO-GO.

## 2. Target architecture

The proposed product-facing "Plebeian Powered Wrapper" is implemented internally as a **Plebeian Wallet Host** plus sealed monetary capability ports.

```text
Application / Auctions / Orders / NIP-60
                    │
                    ▼
          Plebeian Wallet Facade
                    │
                    ▼
           Plebeian Wallet Host
        ┌───────────┼───────────────────┐
        ▼           ▼                   ▼
Host Command DB  sealed             sealed
                 CocoEnginePort      LightningPayerPort
                    │                   │
                    ▼                   ▼
            CocoEngineAdapter       NWC adapter
                    │                   │
                    ▼                   ▼
          official upstream Coco    NWC wallet/server
                    │                   │
                    ▼                   ▼
                Cashu mint          Lightning network
```

The governing boundary is:

> **For Cashu, Coco owns monetary authority. Plebeian owns intent, policy, identity, workflow, migration, interoperability, delivery state, and UX. NWC remains a separate remote Lightning-payment authority behind a sealed capability boundary.**

### Upstream Coco owns

- canonical Cashu proofs;
- spendability;
- proof ownership;
- Cashu monetary operation state;
- Send / Receive / Mint / Melt recovery;
- Restore/replay decisions;
- exact Send result recovery;
- runtime Cashu monetary fencing;
- P2PK witness construction and reclaim execution;
- seed/key custody for Coco's generic wallet key hierarchy.

### Plebeian owns

- workflow/business identity;
- canonical account lifecycle and full account namespace;
- migration phase and epoch;
- host command identity and idempotency;
- durable host-command → Coco-operation binding;
- durable host-command → external-payment binding where NWC is used;
- Auction/business policy;
- application-specific refund-authority policy and protected reference;
- NIP-60 event handling and delivery state;
- business retry policy and UX;
- backup/export policy.

### External Lightning payer boundary

NWC is not a Cashu proof authority, but possession of an NWC URI grants an independently authorized remote Lightning payment capability. The target Host must therefore treat NWC as a separate irreversible external-payment boundary rather than as a UI convenience or fallback wallet engine.

Rules:

- NWC credentials are scoped to the **full canonical account identity and environment**; they never live in a global cross-account wallet list.
- Ordinary application code does not receive raw NWC credentials after Host composition.
- The Host persists the business command, exact invoice/quote identity, account/workflow binding, and related Coco Mint operation binding before authorizing an NWC payment.
- An NWC acknowledgement is not proof that Cashu outputs were issued or durably admitted into Coco.
- A timeout or lost NWC response is ambiguous until the remote Lightning payment is reconciled; it cannot authorize a second payment.
- Direct Auction Lightning funding must reconcile two separate remote boundaries: **Lightning payment** and **Cashu mint issuance**. Neither boundary may be inferred from the other.
- NWC credentials are a migration/credential-domain concern, not Cashu proof inventory, and must never be imported as proof authority.

### Account identity / namespace rule

All target wallet state is scoped by a canonical **full account identity**, plus environment and any other required wallet namespace components. Truncated pubkey prefixes are forbidden for monetary, recovery, command, credential, or Auction-recovery namespaces.

Required behavior:

- account switch/logout closes the old wallet context before the new context becomes writable;
- stale asynchronous callbacks from an old account/session cannot write into the new account;
- Host provenance may identify the creating session, but monetary authorization is revalidated against current Coco OWNER/FENCE state;
- legacy records found under truncated namespaces are migration input only and are **not** automatically attributed to the currently logged-in account;
- if more than one full identity can map to the same legacy namespace, migration quarantines the records until ownership can be proven.

### Refund-authority clarification

ADR-0010 explicitly permits Plebeian to own application-specific Auction refund authority that Coco cannot reconstruct, including a refund private key or a reference to its protected recovery form. That is a **sensitive spending capability**, but it is not a second proof repository or a generic wallet engine.

The target boundary is therefore:

- Prefer Coco seed-derived / KeyRing-managed P2PK authority when upstream Coco can satisfy the Auction sovereignty and recovery requirements.
- If a non-seed-derived application refund authority is required, the **Host Command DB stores only an opaque protected reference and non-bearer condition commitment**, never the raw secret.
- Any raw application refund secret must live in a dedicated protected secret facility or user-controlled recovery artifact with explicit export/recovery policy for the entire lock lifetime.
- Ordinary UI, NIP-60, Auction state, outboxes, and generic stores must not receive that raw secret.
- Generic P2PK witness construction, proof selection, reclaim execution, and monetary recovery remain upstream Coco responsibilities.
- If the sealed adapter cannot hand a protected refund capability to an upstream-supported Coco reclaim path without reimplementing witness/reclaim logic in Market, that is an upstream integration blocker rather than permission to build a Plebeian reclaim engine.

### Explicitly forbidden

- parallel Plebeian proof inventory;
- Plebeian-owned generic recovery state;
- raw bearer-token cache for retry convenience;
- post-cutover NIP-60/legacy wallet fallback;
- exposing Coco Manager/repositories/ProofRepository to ordinary application code;
- exposing raw NWC authorization credentials to ordinary application code after Host composition;
- implementing missing OWNER/FENCE or generic Cashu recovery in Market;
- generic P2PK witness/reclaim implementation in Market;
- treating import containment alone as proof that no second spending capability exists.

## 3. Normative command protocol

Every Cashu command that may cross an irreversible monetary boundary follows this sequence:

```text
persist Host command
→ acquire serialized PREPARE lane
→ Coco PREPARE
→ persist exact Coco binding
→ release PREPARE lane
→ revalidate account/epoch/workflow
→ Coco EXECUTE
→ read authoritative Coco outcome
→ sync business state
→ deliver external side effect
```

Required invariants:

1. **PREPARE must not perform an irreversible monetary effect.**
2. **EXECUTE is forbidden until the Host↔Coco operation binding is durable.**
3. A Host command must be durably journaled before PREPARE starts.
4. At most one unbound PREPARE may be in progress for a wallet namespace under the Host-controlled PREPARE lane unless upstream provides caller-keyed idempotency/correlation that proves otherwise.
5. A new PREPARE must not start while unresolved orphan matching exists for that wallet namespace.
6. After possible execution, retries reconcile the **same Coco operation**; they do not originate a replacement operation.
7. Missing Plebeian business state never releases monetary authority or implies rollback.
8. Business and delivery failures never rewrite Coco's monetary outcome.
9. Orphan ambiguity quarantines; it never guesses.
10. Host/session checks are policy controls only; upstream Coco must enforce monetary OWNER/FENCE inside the authorizing transaction.
11. No background processor, watcher, or startup recovery path may advance a newly prepared operation across its irreversible boundary before the Host binding is durable.

For workflows that additionally invoke NWC, the NWC payment command is separately journaled/bound and follows the same ambiguity rule: a possible remote Lightning payment is reconciled as the **same external payment intent**, never replaced because a response was lost.

### Deterministic PREPARE identity is a production requirement

Stable caller correlation inside Coco remains the preferred mechanism, but the production requirement is broader and normative:

> Every PREPARE must have a deterministic, non-heuristic orphan-recovery identity.

An accepted candidate may satisfy this with one of:

- an upstream caller correlation / `hostCommandId` persisted on the Coco operation;
- caller-keyed idempotent PREPARE;
- another provably unique operation identity/query contract;
- or Host-side serialized PREPARE with durable pre-PREPARE journaling and a proof that exactly one unbound candidate can exist.

Amount/mint/unit/timestamp ordering is **not** sufficient to choose between multiple candidates. If uniqueness cannot be proven, the command and candidates quarantine rather than guess.

## 4. Two-database contract

Plebeian's Host Command DB and Coco's monetary DB are intentionally separate and are **not** atomically transacted together.

Therefore monetary correctness must satisfy all of the following without a distributed transaction:

- Host intent persisted, Coco never started → no monetary effect.
- Coco PREPARE succeeded, Host binding write failed → operation cannot execute irreversibly; reconcile the orphan.
- Host binding persisted, EXECUTE not started → resume exactly that Coco operation.
- Remote monetary mutation happened, Host crashed → Coco remains authoritative; reconcile the same operation.
- Coco result durable, business state missing → rerun business synchronization only after recovering the same operation identity.
- Publication succeeded, delivery marker failed → retry delivery only; never retry the monetary operation.
- Absence of a record in one database is never proof that value is free in the other.

No monetary invariant may require a transaction spanning both databases.

### Differential restore / backup skew

Crash consistency and disaster recovery are separate problems. A user may restore the Host/control database from an older snapshot than the Coco monetary database, or vice versa.

Example:

```text
Host backup = T-2
Coco backup = T-1

between T-2 and T-1:
  Host binding written
  Coco operation advanced/finished

restore:
  Host forgets binding
  Coco remembers operation
```

Required behavior:

- A restored Host snapshot never authorizes execution merely because its local binding/epoch record is absent.
- Restoring Host state independently of Coco enters explicit restore reconciliation before new monetary dispatch.
- Host authority identifiers must not be reusable authorization tokens after snapshot rollback. A fresh session/authority acquisition produces fresh provenance and validates against the current Coco monetary authority generation.
- After cutover, Coco's current OWNER/FENCE generation remains the monetary authority; an older Host epoch is never a substitute.
- Terminal, in-flight, and prepared Coco operations must be discoverable through supported APIs or durable caller correlation sufficiently to reconcile lost Host bindings.
- If a terminal monetary operation cannot be rediscovered/rebound after differential restore, the affected workflow remains quarantined; Market must not infer a replacement operation.
- Backup/restore must not reuse a simple rolled-back counter as if it were fresh authority. Epoch/generation identity must be non-reusable across restored snapshots.

Deterministic caller correlation is therefore valuable for both ordinary orphan recovery and post-backup binding reconstruction.

## 5. Host command / operation binding

A general wallet Host binding must be separate from the accepted migration-only I1A/I1B1 store.

Conceptual immutable identity includes:

- host command ID;
- **full canonical wallet/account namespace**;
- environment;
- authority epoch / current Coco authority-generation reference where applicable;
- workflow type / workflow ID / workflow leg;
- operation kind;
- canonical mint;
- unit;
- amount where relevant;
- immutable intent fingerprint;
- non-bearer lock/refund-condition commitment where relevant.

Write-once binding:

- `cocoOperationId: null → exact ID` only.

Required uniqueness:

- one Host command → at most one Coco operation;
- one Coco operation → at most one Host command;
- no reuse across account, environment, epoch, mint, unit, workflow, Auction, or bid leg.

The stored session generation is **creation provenance**, not permanent authorization. A later legitimate session must be able to resume the command after current authority is revalidated.

The Host binding must never contain proofs, token payloads, OutputData, blind signatures, Coco proof state, seeds, nsecs, KeyRing secrets, application refund secrets, NWC authorization secrets, or generic monetary recovery material.

## 6. Orphan PREPARE recovery

Critical crash state:

```text
Host command durable
→ Coco PREPARE durable
→ crash before Host binding
```

Restart behavior:

```text
open Coco without autonomous monetary advancement
→ load unbound Host commands
→ inspect relevant Coco prepared / in-flight / terminal operations
→ subtract already-bound operation IDs
→ bind only an exact unique candidate
→ safely cancel definitely unmatched pre-execution operations when supported
→ quarantine every ambiguous case
```

Never prepare a second operation merely because the first PREPARE call did not return its ID to the Host.

Prepared/in-flight enumeration exists for several current Coco operation APIs, but production orphan recovery also needs enough supported identity/discovery to handle terminal advancement and differential restore. Caller correlation/query support is strongly preferred and may become mandatory where Host serialization cannot prove uniqueness.

### Quiescent / controlled startup

Mint requires special treatment because current Coco initialization can run recovery automatically. The target integration therefore requires supported **quiescent startup** or equivalent control:

```text
open Coco quiescent
→ acquire OWNER/FENCE
→ reconcile/bind prepared, in-flight, and terminal orphans
→ only then enable recovery/processors
→ READY
```

The same invariant applies after READY: autonomous processors/watchers must not take a newly PREPARED operation across its irreversible boundary before the Host binding is durable. If the upstream API cannot gate that per operation, the relevant autonomous processor must remain disabled and Host-driven execution/reconciliation must use supported public APIs.

The Host must not obtain this behavior by constructing Coco internals manually or copying startup/recovery machinery.

A production candidate also needs one definitive Mint-orphan resolution mechanism: stable correlation, idempotent caller-keyed prepare, provably unique quote→operation identity, or safe cancel/abandon.

## 7. Sealed CocoEnginePort

The adapter boundary is intentionally Coco-specific. It is **not** a generic interchangeable wallet-engine abstraction.

Rules:

- exactly one production implementation: `CocoEngineAdapter`;
- test fakes may exist only in test composition;
- no engine registry;
- no routing by availability;
- no NIP-60/rc11 fallback implementation;
- operation-specific Mint / Send / Receive / Melt / P2PK semantics;
- no raw Manager, repositories, KeyRing, ProofRepository, Proof arrays, OutputData or seed service escapes;
- EXECUTE accepts only a validated bound operation reference;
- any access to an application-specific refund authority is narrowly capability-scoped to the bound P2PK operation and never grants ordinary application code direct proof/token mutation capability.

The separate `LightningPayerPort` is likewise capability-specific: it exists only to isolate account-bound remote Lightning payment authorization. It is not a generic multi-wallet router and cannot substitute for Coco monetary state.

These boundaries isolate upstream API evolution and external payment capabilities; they do not normalize multiple production Cashu engines.

## 8. Error and retry semantics

The Host must preserve monetary ambiguity.

After a possible remote mutation:

```text
UNRESOLVED
+
RECONCILE_SAME_OPERATION
```

is the safe default.

A timeout, lost response, browser cancellation, unknown exception, stale runtime, unavailable mint, failed NWC response, or failed business write is **not** sufficient to authorize a new monetary operation or external payment.

`FAILED_SAFE_TO_RETRY` is allowed only when the **accepted upstream candidate's authoritative semantics** prove that:

- no externally transferable result from the original intent remains outstanding;
- no remote effect remains unresolved;
- no proofs remain reserved/inflight for that operation;
- all value is durably reconciled under canonical ownership;
- and treating the original intent as no-effect/rolled-back does not violate method-specific ownership semantics.

For NWC, safe retry similarly requires authoritative reconciliation that the prior Lightning payment did not settle and cannot still settle under the same invoice/payment intent.

### Ordinary Send response-loss qualification

ADR-0010 G2 is stricter than simple fund conservation. If a Send swap succeeds at the mint and its response is lost, the accepted candidate must recover the exact outgoing token and KEEP/SEND ownership once. It must **not** silently convert intended SEND ownership into ordinary ready wallet value and call that an acceptable production rollback.

Therefore the current upstream ordinary-Send behavior described in §10 is a **candidate G2 failure**, not a Host-level `FAILED_SAFE_TO_RETRY` success condition. The Host must not normalize a non-conforming engine result into compliance.

After adapter exceptions, reload authoritative persisted Coco operation state before deriving user-facing retry disposition whenever possible.

## 9. Token-free delivery outbox

Plebeian's NIP-60/business outbox may durably store:

- Host command reference;
- Coco operation reference;
- logical delivery ID;
- destination/recipient identity;
- protocol/workflow metadata;
- retry scheduling;
- published event IDs;
- sanitized delivery status.

It must **not** durably store:

- encoded Cashu token;
- proofs or proof secrets;
- witnesses;
- OutputData;
- blind signatures;
- application refund secrets;
- NWC authorization secrets;
- generic wallet recovery material.

Required flow:

```text
Coco exact result durable
→ token-free delivery task
→ sealed adapter retrieves exact token transiently
→ interoperability layer publishes
→ delivery marker updates
```

If the exact outgoing token cannot be reconstructed/retrieved after restart, delivery remains blocked for an accepted candidate. Plebeian must not add a bearer-token cache as a workaround.

## 10. Verified current upstream ordinary-Send gap

The original independent Builder and Red-Team review pinned official Coco master at `6945ac41271bc2d1e26a9cc9fdcf8f5ab8076343`.

Fresh review on 2026-09-13 finds current upstream master at `8e6796e2c47f6bd5a51e21efeb04630c8b13e4d7`, six commits ahead through merged #489 (Mint metadata refresh groundwork). The current ordinary-Send response-loss path still has the production-gating behavior described below.

At the reviewed/current line of development:

- after a remotely successful swap with a lost response, recovery can Restore outputs and classify the operation as rolled back;
- restored unspent outputs are persisted as ordinary `ready` proofs;
- the exact outgoing SEND token is not guaranteed to be reconstructed and durably persisted;
- therefore a later operation lookup cannot necessarily return the exact bearer result because recovery never created it;
- this does not establish an accepted `FAILED_SAFE_TO_RETRY` state under Plebeian's G2 invariant because intended KEEP/SEND ownership was changed.

This is a **recovery-semantics gap**, not necessarily a need for a new getter. An existing operation lookup is sufficient if upstream guarantees that response-loss recovery reconstructs and persists the exact result.

Open upstream Send transaction work (#463, checked at head `17f36cf808ac302795fefb64cb6575e8b415c5dd`) appears to implement the required mechanism: it preserves ambiguous execution, reconstructs the persisted output allocation, restores KEEP/SEND ownership, rebuilds the exact token, and applies the recovered result through the Send transaction gateway. It remains **unmerged candidate evidence** until an exact merged/pinned SHA passes Plebeian's G2 crash/response-loss acceptance tests.

Required upstream invariant:

- reuse exact persisted output allocation;
- require complete output evidence or remain unresolved;
- preserve KEEP/SEND ownership;
- reconstruct the exact outgoing token;
- atomically persist the token and proof transitions;
- expose the persisted result through a supported operation-ID path.

## 11. Auction P2PK ordering

Required ordering for Auction locks:

1. persist Host command and exact bid/rebid leg;
2. generate/locate the application refund authority or obtain an upstream Coco-managed refund capability;
3. if application-specific, durably protect the refund authority outside the Host Command DB and retain only its opaque protected reference in Host/business state;
4. verify user-controlled recovery/export coverage for the full lock lifetime;
5. persist only the protected reference and non-bearer lock commitment;
6. acquire the serialized PREPARE lane and verify no unresolved orphan candidate exists;
7. Coco P2PK PREPARE;
8. persist exact Coco operation binding;
9. release PREPARE lane and revalidate account/epoch/workflow;
10. Coco P2PK EXECUTE under upstream OWNER/FENCE;
11. confirm Coco's durable locked result;
12. only then permit bid publication.

Plebeian may own the application-specific refund secret/reference and Auction identity as ADR-0010 allows. Coco must own locked proofs, generic witness construction, reclaim execution, proof recovery, and spendability.

Possession of a non-seed-derived refund secret is itself a spending capability. It must therefore be isolated from ordinary application code and cannot be treated as harmless metadata merely because it is not a proof.

## 12. NIP-60 cutover

Before cutover:

```text
NIP-60 = KEEP_RUNTIME
```

After cutover:

```text
NIP-60 = KEEP_INTEROP
```

Never:

```text
NIP-60 = fallback monetary engine
```

Incoming candidate bearer material must enter through Coco Receive before it can become locally authoritative value.

Outgoing NIP-60 publication must originate from the exact authoritative Coco Send result through the token-free delivery path.

Current direct NIP-60/cashu-ts monetary paths are transitional and must be disabled/contained at cutover rather than retained as availability fallback.

### Cutover single-authority proof

Before `CUTOVER_COMMITTED`, the migration must demonstrate that every currently executable monetary authority has been accounted for. After `CUTOVER_COMMITTED`:

- legacy Coco rc11 cannot originate or commit Cashu monetary mutation;
- NIP-60/direct `cashu-ts` paths cannot originate or commit Cashu monetary mutation;
- Auction bidder/pending/recovery records cannot act as a second proof repository;
- NIP-60 relay state is candidate interoperability input only;
- only official accepted Coco can determine local Cashu spendability and proof ownership;
- NWC remains separately usable only through the account-bound `LightningPayerPort`, never as a Cashu fallback.

## 13. Migration hazards from the current wallet

A blind as-is Red Team review reconstructed the current wallet before comparing it with this target. Its local review target was `6cfc2ebb393c6bc62a19bc7d9c929f686b0bb3fc`; current upstream Auctions was separately verified at `50199dce5a11c1d33d42bfe8bdda55447e6ab5d7`. Findings from the local target are migration evidence, not automatically claims about every upstream file.

Several high-value hazards are independently visible in current upstream Auctions and are now explicit migration requirements:

1. **Multiple local Cashu authorities.** Legacy Coco rc11 remains executable while NIP-60/direct `cashu-ts` is the primary wallet/Auction path. Cutover must retire both legacy mutation paths rather than add Coco as a third co-equal engine.
2. **Truncated legacy namespaces.** Existing wallet localStorage and legacy Coco IndexedDB use first-eight-pubkey scoping in important paths. Migration never guesses a full owner from a truncated namespace; collisions/ambiguity quarantine.
3. **Duplicate Auction bearer material.** Current Auction locking persists the encoded locked token in the strict NIP-60 pending-token store, while bidder recovery records persist full locked proofs and the refund private key. These copies are migration evidence for one locked value, not independent value to import twice.
4. **NIP-60 relay reconstruction may be stale.** Relay events/tombstones are candidate evidence and must be reconciled against mint state and local migration ownership before value becomes spendable.
5. **Unresolved legacy operations remain unresolved.** A timeout, error string, missing local record, or stale relay projection never promotes ambiguous legacy value directly to ready Coco proofs.
6. **Auction recovery data must survive without remaining proof authority.** Refund authority, derivation paths, lock conditions, chain identity, and exact business-event identity are retained/rebound while full proof ownership moves to Coco.
7. **NWC credentials are a separate credential domain.** They require full-account rebinding and teardown but are not imported into Coco proof inventory.

For duplicate bearer material, the migration classifier must deduplicate/reconcile using canonical mint, unit, keyset/proof identity, operation/business binding, and authoritative mint state. A bidder record and pending token that describe the same locked proofs must never produce two ready/imported values.

## 14. Mechanical capability and dependency boundary

Target rule:

- only the final Coco adapter boundary may import `@cashu/coco-*`;
- after cutover, direct wallet-mutating `cashu-ts` use outside the adapter is prohibited;
- import containment is necessary but **not sufficient**: capability containment and dependency resolution are also required.

Implementation acceptance should include mechanical enforcement for:

- static imports;
- dynamic imports;
- type-only imports;
- barrel re-exports;
- production composition;
- test fakes;
- scripts/fixtures;
- legacy transitional allowlist;
- dependency-tree inspection for duplicate or aliased monetary runtimes;
- lockfile checks that the accepted Coco candidate resolves the reviewed `cashu-ts` generation;
- a forbidden-capability/export test proving ordinary application modules cannot obtain Manager, repositories, ProofRepository, KeyRing secrets, raw proofs/tokens, seed services, application refund-secret decryption capability, or raw NWC authorization capability.

The legacy allowlist should be explicit and monotonically shrink. New exceptions should fail CI unless deliberately approved.

During migration, legacy and new package generations may coexist only behind explicit transitional boundaries. Objects from different `cashu-ts` generations must never cross the adapter boundary as shared domain objects. After cutover there must be one active canonical Cashu monetary runtime; a duplicate `cashu-ts` copy or vendored alias must not become a hidden second wallet path.

This is architectural containment, not an XSS security sandbox.

## 15. Upstream evidence status

Evidence is intentionally separated from architectural ownership. "Upstream Coco owns this responsibility" does **not** mean current upstream implements it sufficiently today.

Reviewed baseline for the external LLM sweep: `6945ac41271bc2d1e26a9cc9fdcf8f5ab8076343`.

Fresh upstream master checked 2026-09-13: `8e6796e2c47f6bd5a51e21efeb04630c8b13e4d7`.

| Gate                                      | Reviewed `6945ac4`                                                                        | Current `8e6796e`                                                                                         | Plebeian adoption status                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Wallet-wide OWNER/FENCE                   | No verified wallet-wide generation/fence; in-process locks only                           | No accepted wallet-wide fence identified; `MintScopedLock` remains single-runtime                         | **BLOCKED**                                                                                    |
| Operation-owned proof mutation/release    | Ownership metadata exists but mutation APIs are not uniformly owner-conditioned           | `releaseProofs(mintUrl, secrets)` still has no expected-operation owner in the public repository contract | **BLOCKED**                                                                                    |
| Atomic operation/proof/result transitions | Partial transaction groundwork                                                            | #489 adds Mint metadata transaction groundwork; does not establish all-operation monetary atomicity       | **BLOCKED / partial upstream progress**                                                        |
| Exact Send lost-response recovery         | Gap verified                                                                              | Gap still present on master; #463 is open and appears to implement the required mechanism                 | **BLOCKED pending merge/pin + G2 acceptance**                                                  |
| Receive Restore-before-replay             | Not established by this review                                                            | Not accepted/verified here; #462 remains open                                                             | **BLOCKED pending focused verification/upstream work**                                         |
| Melt/Mint recovery integrity              | Partial recovery exists                                                                   | Partial; exact production invariants remain unaccepted; Mint work remains open                            | **BLOCKED**                                                                                    |
| Crash-safe P2PK reclaim/refund            | Construction/recovery exists, generic refund/reclaim acceptance not established           | No accepted production reclaim path for Plebeian's gate                                                   | **BLOCKED**                                                                                    |
| Quiescent / controlled startup            | Not implemented: initialization runs recovery sweeps                                      | Still unconditional recovery in `initializeCoco()`                                                        | **BLOCKED**                                                                                    |
| Deterministic orphan identity             | `listByQuote` / prepared/in-flight APIs exist; no general caller-keyed idempotent PREPARE | Caller-supplied/idempotent operation identity is tracked upstream in #493                                 | **BLOCKED pending upstream contract**                                                          |
| Coco/cashu-ts pinned compatibility        | Coco core resolves `@cashu/cashu-ts@5.0.0-rc.4`                                           | Still `5.0.0-rc.4` at the checked baseline                                                                | **BLOCKED pending exact compatibility acceptance; RC status is risk, not automatic rejection** |

This table is a point-in-time evidence ledger, not a permanent claim about Coco. It must be refreshed before selecting or accepting a production candidate.

## 16. Remaining upstream gates

An official pinned upstream candidate must still demonstrate at least:

1. wallet-wide OWNER/FENCE and stale-writer rejection;
2. operation-owned proof mutation/release;
3. atomic operation/proof/result transitions;
4. exact ordinary-Send lost-response recovery and supported retrieval;
5. Receive recovery claim + Restore-before-replay;
6. Melt/change and Mint recovery integrity;
7. crash-safe P2PK reclaim/refund;
8. quiescent/controlled startup for orphan reconciliation and per-operation PREPARE/bind ordering;
9. deterministic orphan identity/resolution, including durable caller correlation and terminal discovery after differential restore;
10. pinned Coco/cashu-ts persistence/keyset compatibility.

These are upstream wallet-engine responsibilities. They must not be reimplemented as generic Plebeian monetary logic.

## 17. External LLM review adjudication

PR #1304 received a multi-model adversarial review synthesis based on substantive Qwen and GLM reviews; the attempted Kimi pass failed and produced no review. The two substantive families both agreed that the Wallet Host boundary does **not** inherently create a second wallet engine, but they identified several seams requiring clarification or hardening.

Architect adjudication incorporated here:

| External finding                                                                             | Disposition                                          | Result in this document                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refund authority creates a second spender / contradicts boundary                             | **PARTIAL ACCEPT**                                   | Clarified that ADR-0010 permits application-specific refund authority; raw secrets are excluded from Host/outbox state, capability is explicitly sensitive, witness/reclaim stays Coco-owned |
| Caller correlation cannot remain optional                                                    | **ACCEPT as production liveness/safety requirement** | Added deterministic non-heuristic PREPARE identity, serialized PREPARE lane, durable pre-PREPARE journal, no heuristic matching                                                              |
| Quiescent startup is unavailable at reviewed Coco                                            | **ACCEPT / VERIFIED**                                | Kept as explicit upstream production gate and extended to prevent autonomous advancement before binding                                                                                      |
| Import lint is not capability containment                                                    | **ACCEPT**                                           | Added dependency-tree, alias/duplicate runtime, forbidden-capability, and single-production-runtime checks                                                                                   |
| No operation enumeration APIs exist                                                          | **REJECT / FALSE**                                   | Prepared/in-flight/listByQuote APIs exist; residual issue is deterministic identity/terminal discovery, not total absence of enumeration                                                     |
| Current `rolled_back + restored ready proofs` ordinary Send should be `FAILED_SAFE_TO_RETRY` | **REJECT as accepted-candidate semantics**           | ADR-0010 G2 requires exact outgoing token + KEEP/SEND ownership; current master remains a candidate blocker while #463 is evaluated                                                          |
| Differential Host/Coco backup skew                                                           | **ACCEPT**                                           | Added explicit restore-reconciliation, non-reusable epoch/generation, and terminal-discovery requirements                                                                                    |
| Evidence status should distinguish assertions from verified current code                     | **ACCEPT**                                           | Added reviewed-SHA/current-master/adoption-status ledger                                                                                                                                     |
| `cashu-ts@5.0.0-rc.4` pin is risk                                                            | **ACCEPT as risk**                                   | Kept exact compatibility gate; RC label alone is not an automatic rejection                                                                                                                  |

The later upstream addendum correctly identified #463 as the likely owner of exact-Send G2 recovery and #493 as the caller-correlation issue. It did **not** eliminate the separate quiescent-startup, Receive, Mint, Melt, P2PK reclaim, OWNER/FENCE, or exact compatibility acceptance gates.

The failed third-model run is not treated as a review. Another independent family is welcome on this amended artifact, but completion of that run is not required to record or act on the verified findings above.

## 18. Current-system Red audit adjudication

A separate blind-first Red Team audit reconstructed the currently implemented wallet before reading this target architecture. Its final verdict was:

```text
CURRENT_WALLET_ARCHITECTURE_STAGING_ONLY
REAL_FUNDS_SAFE: NO
SECOND_MONETARY_AUTHORITY_FOUND: YES
```

Architect adjudication accepts the main system-design findings with one terminology refinement: the current system has **two overlapping local Cashu monetary authorities** (legacy Coco rc11 and NIP-60/direct `cashu-ts`) plus **NWC as a separate remote Lightning payment authority**. Auction storage also contains bearer-capable recovery copies, but that does not make it a third general Cashu engine.

This audit supports rather than contradicts the target design. It expands the migration inventory and adds the NWC/account-namespace requirements above; it does not authorize repairing the legacy wallet into the target architecture.

The current wallet remains **staging-only** while these migration and upstream gates are unresolved.

## 19. Current checkpoint

| Item                           | Status                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| ADR-0010                       | governing / unchanged                                          |
| Current implemented wallet     | `STAGING_ONLY` / real funds NO-GO                              |
| Zero-fork adoption gate        | `GO_PENDING_UPSTREAM_CHANGES`                                  |
| Wallet Host architecture       | `FREEZE_WITH_ADDITIONAL_NOTES` / architecture freeze candidate |
| Plebeian I1A                   | Red-pass foundation                                            |
| Plebeian I1B1                  | Red-pass foundation                                            |
| I1B2                           | paused                                                         |
| Current upstream Coco          | not accepted for production                                    |
| Temporary Coco research branch | evidence only                                                  |
| Permanent Coco fork            | forbidden                                                      |
| Wallet Host implementation     | not authorized yet                                             |
| Real-value use                 | NO-GO                                                          |

## 20. Review requested on amended artifact

Maintainer / independent LLM review is now specifically requested on the narrowed remaining questions:

1. Does the clarified application-specific refund-authority boundary preserve ADR-0010 without giving ordinary Market code a second generic spending path?
2. Is the deterministic PREPARE identity requirement sufficient, or should caller correlation/idempotency be mandatory in upstream Coco for every operation kind?
3. Can an official Coco candidate expose supported quiescent startup / per-operation advancement control without Plebeian reconstructing Manager startup internals?
4. Is the differential Host/Coco restore protocol sufficient to prevent lost bindings, epoch reuse, and accidental replacement operations?
5. Does any path still allow current Coco's ordinary-Send rollback-style recovery to be misclassified as accepted G2 semantics?
6. Are the dependency/capability containment checks strong enough to prevent a hidden second Cashu monetary runtime after cutover?
7. Does the full-account namespace rule sufficiently prevent legacy first-eight-prefix ambiguity from being silently reassigned during migration?
8. Is the NWC/`LightningPayerPort` boundary sufficient to prevent Lightning acknowledgement from being confused with Cashu issuance, especially in direct Auction funding?
9. Does the migration rule for duplicate Auction bearer material prevent bidder records and pending tokens from being imported as independent value?
10. Has any remaining responsibility that belongs generically in Coco leaked back into the Host?

Please review the architecture, not just this document's conclusions. Counterexamples at crash/restart, account-switch, stale-runtime, orphan-prepare, differential-restore, response-loss, NWC payment, migration deduplication, and P2PK-refund boundaries are especially useful.

## 21. Non-goals for this review artifact

This PR does not:

- change wallet runtime behavior;
- change dependencies or lockfiles;
- implement the Host;
- resume I1B2;
- change Auctions, NIP-60, or NWC runtime code;
- package the temporary Coco research branch;
- authorize migration/cutover;
- authorize production or real funds;
- resolve the upstream gates by adding Plebeian-owned monetary logic;
- attempt to rehabilitate legacy Coco rc11 or NIP-60 as the long-term monetary authority.

The goal is to push reviewable progress early so architecture feedback happens before implementation gets large.