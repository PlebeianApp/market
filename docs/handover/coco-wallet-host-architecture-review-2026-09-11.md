# Plebeian Wallet Host — architecture review checkpoint

**Status:** review artifact / non-normative until accepted

**Date:** 2026-09-11

**Governing ADR:** ADR-0010 at `4cbe2b268247e8f3c72875f9d5e60696b38a7530`

**Purpose:** publish the current Wallet Host / Coco integration architecture so maintainers and independent reviewers can inspect the actual design, identify drift early, and comment before implementation resumes.

This document does **not** authorize wallet implementation, migration execution, production cutover, real funds, or a private Coco fork.

---

## 1. Decision carried forward from ADR-0010

Plebeian's approved direction remains:

> Adopt Coco if a pinned upstream release or commit can satisfy Plebeian's monetary-safety invariants without a permanent invasive Plebeian fork.

If the generic wallet-engine invariants cannot be maintained upstream, Coco adoption becomes **NO-GO** rather than moving the missing generic financial state machine into Plebeian.

Current architecture status:

- Coco remains the target wallet engine.
- A permanent Plebeian Coco fork is not acceptable.
- Current legacy rc11/NIP-60 paths remain transitional only.
- I1B2 / production Coco integration remains paused.
- Real-value use remains NO-GO.

## 2. Target architecture

The proposed product-facing "Plebeian Powered Wrapper" is implemented internally as a **Plebeian Wallet Host** plus a sealed **CocoEnginePort**.

```text
Application / Auctions / Orders / NIP-60
                    │
                    ▼
          Plebeian Wallet Facade
                    │
                    ▼
           Plebeian Wallet Host
              ┌─────┴─────┐
              ▼           ▼
     Host Command DB   sealed CocoEnginePort
                              │
                              ▼
                     CocoEngineAdapter
                              │
                              ▼
                    official upstream Coco
                              │
                              ▼
                         Cashu mint
```

The governing boundary is:

> **Coco owns money. Plebeian owns intent, policy, identity, workflow, migration, interoperability, delivery state, and UX.**

### Upstream Coco owns

- canonical proofs;
- spendability;
- proof ownership;
- monetary operation state;
- Send / Receive / Mint / Melt recovery;
- Restore/replay decisions;
- exact Send result recovery;
- runtime monetary fencing;
- P2PK witness construction and reclaim;
- seed/key custody at the engine boundary.

### Plebeian owns

- workflow/business identity;
- account lifecycle;
- migration phase and epoch;
- host command identity and idempotency;
- durable host-command → Coco-operation binding;
- Auction/business policy;
- application-specific refund secret/reference protection;
- NIP-60 event handling and delivery state;
- business retry policy and UX;
- backup/export policy.

### Explicitly forbidden

- parallel Plebeian proof inventory;
- Plebeian-owned generic recovery state;
- raw bearer-token cache for retry convenience;
- post-cutover NIP-60/legacy wallet fallback;
- exposing Coco Manager/repositories/ProofRepository to ordinary application code;
- implementing missing OWNER/FENCE or generic Cashu recovery in Market.

## 3. Normative command protocol

Every command that may cross an irreversible monetary boundary follows this sequence:

```text
persist Host command
→ Coco PREPARE
→ persist exact Coco binding
→ revalidate account/epoch/workflow
→ Coco EXECUTE
→ read authoritative Coco outcome
→ sync business state
→ deliver external side effect
```

Required invariants:

1. **PREPARE must not perform an irreversible monetary effect.**
2. **EXECUTE is forbidden until the Host↔Coco operation binding is durable.**
3. After possible execution, retries reconcile the **same Coco operation**; they do not originate a replacement operation.
4. Missing Plebeian business state never releases monetary authority or implies rollback.
5. Business and delivery failures never rewrite Coco's monetary outcome.
6. Orphan ambiguity quarantines; it never guesses.
7. Host/session checks are policy controls only; upstream Coco must enforce monetary OWNER/FENCE inside the authorizing transaction.

## 4. Two-database contract

Plebeian's Host Command DB and Coco's monetary DB are intentionally separate and are **not** atomically transacted together.

Therefore monetary correctness must satisfy all of the following without a distributed transaction:

- Host intent persisted, Coco never started → no monetary effect.
- Coco PREPARE succeeded, Host binding write failed → operation cannot execute irreversibly; reconcile the orphan.
- Host binding persisted, EXECUTE not started → resume exactly that Coco operation.
- Remote monetary mutation happened, Host crashed → Coco remains authoritative; reconcile the same operation.
- Coco result durable, business state missing → rerun business synchronization only.
- Publication succeeded, delivery marker failed → retry delivery only; never retry the monetary operation.
- Absence of a record in one database is never proof that value is free in the other.

No monetary invariant may require a transaction spanning both databases.

## 5. Host command / operation binding

A general wallet Host binding must be separate from the accepted migration-only I1A/I1B1 store.

Conceptual immutable identity includes:

- host command ID;
- full wallet/account namespace;
- environment;
- authority epoch;
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

The Host binding must never contain proofs, token payloads, OutputData, blind signatures, Coco proof state, seeds, nsecs, KeyRing secrets, or generic monetary recovery material.

## 6. Orphan PREPARE recovery

Critical crash state:

```text
Host command durable
→ Coco PREPARE durable
→ crash before Host binding
```

Restart behavior:

```text
load unbound Host commands
→ inspect relevant Coco prepared / in-flight / terminal operations
→ subtract already-bound operation IDs
→ bind only an exact unique candidate
→ safely cancel definitely unmatched pre-execution operations when supported
→ quarantine every ambiguous case
```

Never prepare a second operation merely because the first PREPARE call did not return its ID to the Host.

Stable caller correlation inside Coco is **strongly preferred**, but not inherently mandatory for safety if matching is proven unique and all ambiguity quarantines.

Mint requires special treatment because current Coco may advance pending Mint work automatically. The target integration therefore requires supported **quiescent startup** or equivalent control:

```text
open Coco quiescent
→ acquire OWNER/FENCE
→ reconcile/bind orphans
→ only then enable processors/recovery
→ READY
```

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
- EXECUTE accepts only a validated bound operation reference.

This boundary exists to isolate upstream API evolution, not to normalize multiple production monetary engines.

## 8. Error and retry semantics

The Host must preserve monetary ambiguity.

After a possible remote mutation:

```text
UNRESOLVED
+
RECONCILE_SAME_OPERATION
```

is the safe default.

A timeout, lost response, browser cancellation, unknown exception, stale runtime, unavailable mint, or failed business write is **not** sufficient to authorize a new monetary operation.

`FAILED_SAFE_TO_RETRY` is allowed only when authoritative Coco state proves that the prior operation has no possible remaining remote effect and owns/reserves no monetary value.

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
- generic wallet recovery material.

Required flow:

```text
Coco exact result durable
→ token-free delivery task
→ sealed adapter retrieves exact token transiently
→ interoperability layer publishes
→ delivery marker updates
```

If the exact outgoing token cannot be reconstructed/retrieved after restart, delivery remains blocked. Plebeian must not add a bearer-token cache as a workaround.

## 10. Verified current upstream Send gap

Independent Builder and Red-Team review against official Coco master `6945ac41271bc2d1e26a9cc9fdcf8f5ab8076343` found a production-gating ordinary-Send recovery gap:

- after a remotely successful swap with a lost response, recovery can Restore outputs and classify the operation as rolled back;
- the exact outgoing SEND token is not guaranteed to be reconstructed and durably persisted;
- therefore a later supported operation lookup cannot necessarily return the exact bearer result because recovery never created it.

This is a **recovery-semantics gap**, not necessarily a need for a new getter. An existing operation lookup is sufficient if upstream guarantees that response-loss recovery reconstructs and persists the exact result.

Open upstream Send transaction work (#463) appears directionally relevant, but an unmerged PR is evidence only.

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
2. generate/locate refund authority;
3. durably protect refund authority;
4. verify recovery/export coverage;
5. persist only the protected reference and non-bearer lock commitment;
6. Coco P2PK PREPARE;
7. persist exact Coco operation binding;
8. revalidate account/epoch/workflow;
9. Coco P2PK EXECUTE under upstream OWNER/FENCE;
10. confirm Coco's durable locked result;
11. only then permit bid publication.

Plebeian may own the application refund secret/reference and Auction identity. Coco must own locked proofs, witness construction, reclaim, proof recovery, and spendability.

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

## 13. Mechanical capability boundary

Target rule:

- only the final Coco adapter boundary may import `@cashu/coco-*`;
- after cutover, direct wallet-mutating `cashu-ts` use outside the adapter is prohibited.

Implementation acceptance should include mechanical enforcement for:

- static imports;
- dynamic imports;
- type-only imports;
- barrel re-exports;
- production composition;
- test fakes;
- scripts/fixtures;
- legacy transitional allowlist.

The legacy allowlist should be explicit and monotonically shrink. New exceptions should fail CI unless deliberately approved.

This is architectural containment, not an XSS security sandbox.

## 14. Remaining upstream gates

An official pinned upstream candidate must still demonstrate at least:

1. wallet-wide OWNER/FENCE and stale-writer rejection;
2. operation-owned proof mutation/release;
3. atomic operation/proof/result transitions;
4. exact ordinary-Send lost-response recovery and supported retrieval;
5. Receive recovery claim + Restore-before-replay;
6. Melt/change and Mint recovery integrity;
7. crash-safe P2PK reclaim/refund;
8. quiescent/controlled startup for orphan reconciliation;
9. deterministic Mint orphan resolution;
10. pinned Coco/cashu-ts persistence/keyset compatibility.

These are upstream wallet-engine responsibilities. They must not be reimplemented as generic Plebeian monetary logic.

## 15. Current checkpoint

| Item | Status |
|---|---|
| ADR-0010 | governing / unchanged |
| Zero-fork adoption gate | `GO_PENDING_UPSTREAM_CHANGES` |
| Wallet Host architecture | `FREEZE_WITH_NOTES` |
| Plebeian I1A | Red-pass foundation |
| Plebeian I1B1 | Red-pass foundation |
| I1B2 | paused |
| Current upstream Coco | not accepted for production |
| Temporary Coco research branch | evidence only |
| Permanent Coco fork | forbidden |
| Wallet Host implementation | not authorized yet |
| Real-value use | NO-GO |

## 16. Review requested

Maintainer / independent LLM review is specifically requested on:

1. Is the Plebeian-vs-Coco responsibility boundary correct?
2. Is the prepare → bind → revalidate → execute protocol sufficient and implementable against the intended Coco APIs?
3. Does any Host responsibility accidentally become a monetary state machine?
4. Is token-free NIP-60/business delivery practical, or is another upstream Coco result primitive needed?
5. Is quiescent startup the right integration boundary for orphan reconciliation?
6. Is any remaining upstream gate incorrectly classified as generic Coco responsibility rather than Plebeian-specific integration?
7. Are there simpler designs that preserve the same safety invariants without introducing dual authority or a permanent fork?

Please review the architecture, not just this summary's conclusions. Counterexamples at crash/restart, account-switch, stale-runtime, orphan-prepare, response-loss and P2PK-refund boundaries are especially useful.

## 17. Non-goals for this review artifact

This PR does not:

- change wallet runtime behavior;
- change dependencies or lockfiles;
- implement the Host;
- resume I1B2;
- change Auctions or NIP-60;
- package the temporary Coco research branch;
- authorize migration/cutover;
- authorize production or real funds.

The goal is to push reviewable progress early so architecture feedback happens before implementation gets large.
