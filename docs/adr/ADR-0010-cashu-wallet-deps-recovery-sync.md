# ADR-0010: Cashu Wallet — Coco Engine, Monetary Authority, Recovery, Migration, and Replication

## Status

**Proposed — conditional adoption**

This ADR selects **Coco v2+ as Plebeian's target Cashu wallet engine**, subject
to the acceptance gates in this ADR.

This is a strategic architecture decision. It is **not** approval to ship:

- the current Plebeian `coco-cashu-core@1.0.0-rc11` integration;
- released `@cashu/coco-core@2.0.0` unchanged;
- an unmerged Coco development branch;
- or any wallet candidate that has not passed the crash, concurrency,
  migration, and Auctions acceptance gates below.

The decision is:

> Adopt Coco if a pinned upstream release or commit can satisfy Plebeian's
> monetary-safety invariants without a permanent invasive Plebeian fork.

If the generic invariants cannot be provided or maintained upstream, this ADR
must be revisited and the wallet-engine selection becomes **NO-GO**, rather
than moving the missing financial state machine into Plebeian.

## Date

2026-09-02

## Supersedes / consolidates

This ADR replaces the earlier, never-merged ADR-017/018/019 dependency,
recovery, and synchronization proposals. It incorporates the Coco go/no-go
safety spike performed after the 2026-08-21 wallet incident.

## Related

- ADR-0002 — NDK footprint / relays are transport, not database
- ADR-0005 — external mint test boundaries
- ADR-0008 — signer migration
- PR #1255 — original bundled Cashu wallet ADR
- PR #1235 — direct Lightning auction funding
- Wallet rebuild research handover (2026-08-27), decisions D2–D7
- Hazard `hzrd149` — zombie-token report
- 2026-08-21 wallet incident and subsequent wallet-safety audit
- Coco upstream transaction, recovery, keyset, and operation-orchestration work

---

## Context

Plebeian currently has multiple overlapping Cashu state authorities:

- Coco-managed proofs in local IndexedDB;
- NIP-60 / `NDKCashuWallet` proof state;
- separate pending-token storage;
- and Auctions bidder records containing refund material and locked proofs.

Different product flows select different authorities. Some send and withdrawal
paths may use Coco, while receive, deposit, Auctions, and proof-display paths
continue through NIP-60.

That is not an acceptable steady-state architecture for bearer money.

The audited checkout resolves the deprecated unscoped
`coco-cashu-core@1.0.0-rc11` and `coco-cashu-indexeddb@1.0.0-rc11`, alongside a
direct `@cashu/cashu-ts@2.9.0` resolution. Rc11 has no durable monetary
operation repositories. Its mint, send, receive, and melt paths cross remote
boundaries before all corresponding proof, token, quote, and operation results
are durably committed. The current integration is therefore **NO-GO for real
funds** and is not a base on which Plebeian should build more financial state
machinery.

The incident review also established that wallet correctness cannot be reduced
to “we can restore from the seed.” Cashu operations have irreversible remote
boundaries. A mint can consume old proofs, issue new proofs, pay a Lightning
invoice, or create P2PK-locked outputs before the application has durably
committed the corresponding local outcome.

Recovery has three separate jobs:

1. **operation recovery** — determine and durably reconcile what happened
   across a crash or lost response;
2. **disaster recovery** — reconstruct deterministic wallet material and
   recover non-derivable application secrets after loss of local storage; and
3. **replication** — move subordinate recovery or interoperability state
   between devices without defining spendability.

NUT-09 is important for disaster recovery and can participate in operation
recovery, but it does not replace a durable operation state machine. It also
cannot recreate an application-generated random auction refund private key
that was never placed under a user-controlled recovery mechanism.

Coco v2 materially improves on rc11 by introducing persistent operation
models, proof reservations, deterministic output recovery material, P2PK send
support, and method-specific recovery. Released v2.0.0 nevertheless leaves
production gates unresolved around cross-repository transaction enforcement,
exact ordinary-send response-loss semantics, interrupted rollback/reclaim,
keyset compatibility, and cross-runtime ownership. Unmerged upstream work is
evidence of direction, not production functionality.

---

# Decision

## 1. Monetary authority

Plebeian will converge on exactly one local Cashu monetary authority.

### Canonical authority after cutover

- **Coco `ProofRepository` is the only local authority for spendable and
  reserved Cashu proofs.**
- **Coco durable operation state is the authority for in-flight monetary
  operations and their monetary recovery material.**
- **The mint is the remote arbiter of known proof and quote state.**
- Plebeian domain stores may hold business state and secrets that Coco cannot
  own, but must not become another spendable-proof or monetary-operation
  authority.
- NIP-60, Nostr events, ContextVM, snapshots, caches, and future replication
  mechanisms are subordinate transports or recovery inputs.

Remote state never directly makes value spendable. External proof material
becomes locally authoritative only after admission through the wallet boundary
and any required cryptographic validation and mint reconciliation.

### Conceptual monetary states

The implementation may use different names, but it must preserve the
distinction between at least:

- spendable;
- reserved by one identified operation;
- outbound / awaiting counterparty outcome;
- application-locked, including auction P2PK state;
- consumed;
- and unresolved/ambiguous.

“Balance” is a projection over these states, not an authority.

## 2. Irreversible-operation invariant

Every operation that may cross an irreversible remote boundary must satisfy
the following invariant.

An irreversible boundary includes exposing a payable mint invoice to a user or
external wallet: once exposed, the invoice can be paid even if Plebeian closes
before recording a later callback.

### Before remote submission or payable-invoice exposure

Durable local state must contain:

1. a stable operation identity;
2. the user/wallet, mint, unit, method, and relevant business bindings;
3. ownership/reservation of every affected input;
4. the exact request semantics or a stable fingerprint sufficient to prevent
   materially different retries;
5. sufficient deterministic or otherwise durable recovery material for
   expected outputs and change;
6. operation-specific secrets that cannot be reconstructed later;
7. any quote or invoice identity whose external use can advance money;
8. and a state proving that remote submission or payment may already have
   occurred.

No request may rely on writing those facts only after the network call
succeeds.

### After the remote side may have advanced

- old inputs must not return to spendable merely because a response was lost;
- stale writers must not overwrite or release the operation;
- consumed proofs must not resurrect;
- one remote result must not be committed twice;
- outgoing bearer tokens and KEEP/SEND ownership must not be lost;
- paid-melt change must not be lost or duplicated;
- ambiguous value must remain unavailable for a new spend;
- and only locally reconciled, durable value may become spendable.

Every interrupted operation must eventually converge to one of:

1. **recovered** — resulting or change proofs and required outgoing tokens are
   validated and durable;
2. **authoritatively complete** — the intended external outcome is proven
   complete and any local change is durable; or
3. **unresolved but safe** — affected value remains reserved or quarantined
   until authoritative reconciliation succeeds.

“Unresolved but safe” is nonterminal. When the mint, quote, Lightning, or other
authoritative reconciliation source becomes available again, a bounded
recovery worker must resume progress. It must not silently abandon the
operation or require normal users to manipulate proof state.

This invariant applies to mint/deposit, send, receive/redeem, swap/change,
melt/Lightning payment, melt change, auction P2PK locking, rebids,
refunds/reclaims, seller settlement, consolidation, migration, and recovery
itself.

## 3. Coco dependency decision

Plebeian selects the **Coco v2 architecture**, not the literal released 2.0.0
artifact as an unconditional production dependency.

The production dependency must be one exact pinned upstream release or commit
that satisfies this ADR’s acceptance gates. Plebeian must record and test the
exact resolved versions of both Coco and its resolved `cashu-ts` dependency.

`cashu-ts` is not a harmless implementation detail. Changes in output
allocation, stale-keyset behavior, restore semantics, request replay, or proof
handling can change the safety of already-persisted Coco operations. Plebeian
must not independently upgrade or override Coco’s `cashu-ts` version without
an operation-recovery compatibility review.

The accepted candidate may temporarily pin an unmerged Coco commit for
evaluation. Such a pin does not become a silent permanent shadow fork. Generic
transaction, recovery, and operation-ownership changes must either reach an
upstream release or have an upstream-accepted maintenance path before
production adoption.

The rc11 integration is not a migration target and should receive no new
financial state-machine work.

## 4. Repository transactions

Safety-critical state transitions must be atomic at the repository boundary
where partial persistence would change monetary ownership.

This includes, as applicable:

- operation creation and transition;
- proof reservation and release;
- proof state mutation;
- deterministic counter and key allocation;
- recovered or result-proof insertion;
- consumed-input marking;
- outgoing-token persistence;
- quote, invoice, and settlement-result persistence;
- and change-output persistence.

“Stored in the same IndexedDB database” is not sufficient. If an adapter
exposes transactions, the operation service must actually compose related
writes through those transactions.

A storage abort, quota error, transaction failure, process termination, or
restart between any two persistence statements must not create invalid
monetary ownership.

## 5. Operation and disaster recovery

### Primary recovery: operation-local

Normal crash recovery uses the durable Coco operation record. For a remotely
ambiguous operation, recovery uses the persisted request, input ownership,
outputs, quote identifiers, method data, and mint state to determine what
occurred. Recovery must be idempotent, restartable, and itself crash-safe.

Recovery-only executors must be narrowly scoped. They may reconcile and finish
already-owned operations, but cannot originate unrelated payments, release
proofs owned by another operation, or restore the legacy wallet as a second
authority.

### NUT-07

NUT-07 is used where mint proof-state arbitration is required, including
external proof admission, ambiguous operation reconciliation, migration, and
recovery. It is not a replacement for local operation durability or
cryptographic proof validation.

### NUT-09 / NUT-13

NUT-09 deterministic output restoration is an important recovery primitive
and disaster-recovery mechanism. Its derivation scan must cover historical
keysets and maintain monotonic counters. Gap limits, partial responses, stale
keyset metadata, and already-persisted operations must be tested with the exact
resolved `cashu-ts` version.

NUT-09 does not inherently reconstruct:

- intended KEEP versus SEND ownership of an interrupted bearer-token send;
- the business outcome of an ambiguous Lightning payment;
- arbitrary application metadata;
- or randomly generated application secrets such as an auction refund key.

Returned signatures still require correct proof-state reconciliation before
value becomes spendable.

### Mint discovery and NUT-27

Disaster recovery also needs the user’s mint inventory. NUT-27 or another
user-controlled encrypted backup may preserve that inventory, subject to a
separate decision about seed-primary versus Nostr-identity-primary derivation.
No relay copy becomes a monetary authority merely because it assists mint
discovery.

### Restore privacy

Large restore scans expose network metadata to mints. Restore UX and testable
operational guidance must address IP-leak mitigation, such as Tor or another
user-controlled privacy route, without making that route a monetary authority.

### Melt safety

Melt is a production gate. After a Lightning payment request may have been
submitted, recovery must reconcile PAID, PENDING, and unpaid or failed outcomes
without issuing an unsafe second payment. If the invoice was paid, change must
be recovered and committed exactly once. Plebeian never infers Lightning
settlement solely from a wallet/API acknowledgement.

## 6. Runtime ownership and concurrency

Coco’s in-process mutexes are useful but are not Plebeian’s browser ownership
boundary. Plebeian must ensure that a stale runtime cannot mutate monetary
state after another runtime takes authority.

The implementation must provide an equivalent of:

- account-scoped mutation ownership;
- durable ownership epoch/fencing or repository-level ownership/CAS;
- revision-checked operation transitions;
- owner-conditioned proof release and mutation;
- and safe takeover after crash or suspension.

The exact primitive is an implementation choice. No specific remote service is
required.

The invariant is not “only one tab is expected.” It is:

> After ownership changes, the previous writer cannot commit stale monetary
> state.

This holds across tabs, multiple Coco `Manager` instances, workers, recovery
processes, suspended/resumed pages, and account switching.

Account storage namespaces use the complete required identity, not a truncated
pubkey prefix. Logout and account switching stop wallet workers and watchers,
relinquish mutation authority, close the old wallet context, and prevent old
asynchronous work from writing into the new account.

## 7. Auctions and P2PK

Coco’s P2PK support is necessary but does not by itself make Plebeian Auctions
safe. Plebeian owns application-specific auction recovery authority.

Before any irreversible P2PK lock operation:

1. create a Coco operation identity;
2. generate or obtain the refund authority;
3. durably persist and verify the refund authority;
4. bind it to the account, auction, bid or rebid leg, mint, unit, lock
   conditions, and Coco operation identity;
5. place every non-seed-derived refund authority under an explicit,
   user-controlled disaster-recovery or export policy for the lifetime of the
   lock;
6. then allow the Coco operation to cross the mint boundary.

Storage or recovery-policy failure fails closed before the mint lock.

After the mint may have created locked outputs, the canonical Coco operation
must durably contain or reference the exact locked monetary result before
Plebeian signs or publishes the bid. Bid publication is a business side effect,
not proof that the money operation was committed.

Auction state must not become another canonical proof repository. Coco owns
the monetary proof/token lifecycle. Plebeian auction storage owns only the
additional application data Coco cannot reconstruct, such as:

- refund private-key material or a reference to its protected recovery form;
- auction, bid, rebid-leg, and seller-settlement identifiers;
- derivation paths and lock/refund condition metadata;
- and the durable link to the Coco operation.

Duplicating full locked proof sets outside Coco is prohibited unless a later
design proves the copy is non-authoritative, lifecycle-bound, secret-safe, and
incapable of resurrecting spendable value.

Rebid, loser reclaim/refund, seller settlement, and recovery-only execution are
subject to the same crash invariant as ordinary wallet operations.

## 8. NIP-60

NIP-60 has two classifications depending on migration phase.

### Current transition: `KEEP_RUNTIME`

The present application still depends on NIP-60 for working wallet paths and
existing user state. It cannot be deleted, demoted to import-only, or described
as optional at runtime before migration and legacy workflow drainage are
complete.

### Target state: `KEEP_INTEROP`

After Coco becomes canonical, NIP-60 may remain for compatibility,
import/export, backup, or interoperability. It must not remain:

- an alternate spendable-proof repository;
- a fallback payment engine;
- or a remote authority capable of reactivating proofs.

Whether Plebeian publishes NIP-60 state by default is a separate product
decision. Whatever policy is selected, received NIP-60 state passes through
the same admission and reconciliation boundary as any other external proof
material. NIP-60 kind 7376 is optional transaction history, not the proof-event
tombstone mechanism.

## 9. Replication and multi-device sync

Replication is subordinate to monetary correctness.

This ADR intentionally does **not** select ContextVM, NIP-60, a kind-30078
snapshot, a `cashu-sync`-style CAS service, or another transport as part of the
wallet’s monetary state machine. The local durable operation engine remains
crash-safe when replication is unavailable.

Replication may occur after canonical local commits and may carry encrypted
recovery material, history, labels, mint metadata, interoperability state, or
other wallet metadata. Remote replication state is candidate input, not local
spendability authority.

A durable event outbox may make replication side effects reliable, but
successful remote publication is not part of the transaction that determines
whether sats exist locally.

If Plebeian later allows multiple devices to mutate one wallet simultaneously,
that requires an explicit ownership/fencing design satisfying this ADR and a
focused architecture review. A remote CAS service may participate in that
design, but this ADR neither selects one nor makes its availability necessary
for ordinary local crash safety.

NIP-44 decryption belongs at the replication/admission layer, not in render
loops. Kind-30078 snapshots and other replaceable events remain
non-authoritative and require domain-separated identifiers and secret-safe
handling if adopted.

## 10. Migration from the existing wallet

Migration transfers monetary authority exactly once. It does not operate as
two live canonical wallets gradually copying proofs between each other.

### Phase A — prepare in shadow mode

- Introduce the accepted Coco candidate and wallet host without user cutover.
- For real user value, Coco remains read-only/shadow and cannot mint, receive,
  send, melt, lock, reclaim, or otherwise mutate proofs.
- Inventory Coco, NIP-60, pending-token, and auction state.
- Validate the candidate with isolated fixtures and controlled test mints.

### Phase B — establish a durable migration epoch and quiesce

Before any real-value Coco mutation:

- stop legacy wallet mutations account-wide, not merely for matching proofs;
- obtain exclusive migration/mutation authority;
- durably record the migration epoch and current phase;
- prevent stale tabs, workers, and callbacks from writing;
- and snapshot the legacy inventory as non-authoritative, secret-protected
  audit/recovery input.

The inventory partitions value into mutually exclusive per-mint/unit buckets
at that epoch: legacy spendable, legacy reserved/in-flight, active locked,
already Coco-owned, consumed/external, and explicitly unresolved.

### Phase C — classify

For every proof and workflow:

- identify account, mint, unit, provenance, and current executable owner;
- reconcile proof or quote state with the mint where required;
- treat `SPENT` as consumed;
- quarantine ambiguous or pending value;
- identify active P2PK auction locks and all required seller/refund authority;
- and retain durable provenance needed to make import idempotent.

Active legacy auction locks normally drain through their existing
refund/settlement path unless an operation-aware locked-proof migration has
been proven. Every recovery-only legacy executor is limited to its recorded
workflow and cannot create new ordinary wallet activity.

### Phase D — admit

Admit eligible value into Coco through one idempotent migration path. Where
appropriate, after the new engine is independently proven crash-safe, a
self-swap may convert legacy proofs into fresh Coco-owned outputs.

The migration must never make both the legacy copy and Coco copy independently
spendable. Every irreversible admission or self-swap is itself a durable Coco
operation and survives migration restart.

### Phase E — prove conservation and executability

At the durable migration epoch and for each mint/unit, prove conservation over
the disjoint buckets:

`legacy spendable + legacy reserved/in-flight + active locked + already Coco-owned`

equals:

`Coco spendable/reserved/locked + verified consumed/external + explicitly unresolved`

Every term has recorded provenance and one classification. “Unknown” is not a
balancing bucket.

Accounting alone is insufficient. No canonical cutover may occur while active
legacy locked or unresolved value lacks an executable owner that can complete,
refund, settle, or continue authoritative reconciliation after cutover.

### Phase F — cut over once

Commit a durable, one-way authority marker. After that marker:

- Coco is canonical;
- legacy ordinary-wallet mutation paths stay disabled;
- authorized recovery-only legacy executors remain narrow and epoch-bound;
- stale NIP-60 events cannot reactivate old proofs;
- stale pre-cutover runtimes cannot commit;
- and rollback never means restoring the legacy wallet as an independent
  monetary authority.

Only after this point, and after every required legacy workflow has an
executable owner, may NIP-60 move from `KEEP_RUNTIME` to `KEEP_INTEROP`.

## 11. Secret handling and user sovereignty

Plebeian remains non-custodial.

At minimum:

- wallet seeds and recovery secrets are not stored as plaintext application
  settings;
- auction refund private keys receive equivalent protection and an explicit
  user-controlled disaster-recovery/export path while their locks are active;
- bearer ecash and pending-operation artifacts are monetary secrets;
- full tokens, proof secrets, private keys, seeds, and NWC credentials never
  appear in logs;
- account namespaces do not rely on short pubkey prefixes;
- and recovery/export remains under the user’s control.

Encryption at rest is defense in depth. It does not make an XSS-compromised
wallet safe. CSP, dependency hygiene, sanitization, minimal secret lifetime,
auto-lock/session policy, and secret-safe logging remain required.

No replication service becomes a custodian whose availability or cooperation
is required for ordinary local crash safety or for the user to recover funds
covered by their legitimate recovery material.

---

# Coco acceptance gates

Plebeian may move from architecture selection to wallet integration only when
one frozen Coco candidate demonstrates all of the following.

## G1 — Strong transaction boundary

Safety-critical proof, operation, counter, token/result, quote, and change
transitions are atomic wherever a torn write could lose or duplicate monetary
authority.

## G2 — Exact ordinary-send recovery

If a send swap succeeds at the mint and the response is lost, restart recovery
reconstructs the exact outgoing token and KEEP/SEND ownership once. It must not
become a generic failed or rolled-back send while silently changing ownership.

## G3 — Automatic interrupted rollback/reclaim recovery

Operations interrupted during a remotely mutating rollback or reclaim resume
safely after repeated crashes. Manual seed restoration is not the normal
operation-recovery protocol.

## G4 — Melt reconciliation

A restart after a possibly submitted Lightning melt cannot pay the same
invoice twice and cannot lose or duplicate change.

## G5 — Ownership-safe mutation

Proof release and operation changes are conditional so a stale or different
operation cannot take ownership from the current operation.

## G6 — Cross-runtime fencing

A stale tab or runtime that resumes after ownership transfer cannot commit
monetary state.

## G7 — Keyset and recovery compatibility

The exact resolved `cashu-ts` behavior for stale and rotated keysets, output
allocation, restore, and already-persisted operations is validated.

## G8 — Auctions durability and sovereignty

Refund authority is durable and covered by user-controlled recovery before
mint lock; the locked monetary result is durable before bid publication; and
auction storage is not a second proof authority.

## G9 — Migration conservation and executability

Migration is restartable, fenced, idempotent, value-conserving, and cannot cut
over while active legacy value lacks one executable owner.

## G10 — No permanent invasive fork

Generic transaction, recovery, and monetary-operation primitives exist in
upstream Coco or an upstream-accepted path Plebeian can reasonably follow.
Plebeian-specific Auctions, migration, UI, account-lifecycle, and replication
code may remain local. Reimplementing Coco’s generic financial state machine
in a permanent Plebeian fork is not accepted.

---

# Acceptance tests

The accepted candidate is tested under forced crash and persistence failure.
A mocked “success” return or expected UI balance is insufficient.

## T1 — Ordinary send and rollback

Crash before and after every relevant persistence boundary, including a
successful remote swap with a lost response. Recover the exact outgoing token
and KEEP/SEND result once. Repeat fault injection during rollback and remote
reclaim, including after the reclaim response but before local commit.

## T2 — Receive

Allow remote redemption/reissue to succeed, then lose the response or local
result persistence. Inputs do not become reusable while outputs disappear.

## T3 — Mint and payable invoice

Crash after quote persistence, before and after payable-invoice exposure,
after invoice payment, after output issuance, and before final proof commit.
Issued outputs are recovered exactly once.

## T4 — Melt and recovery

Exercise PAID, PENDING, unpaid/failure, response loss, change, repeated restart,
and faults during recovery or rollback. The same Lightning invoice is never
paid twice.

## T5 — Storage faults and recovery progress

Inject transaction abort, quota/error, and process death around operation
transition, reservation, counter allocation, remote result application, proof
consumption, token/change persistence, and recovery transitions. When
authoritative services return, unresolved operations resume progress without
unsafe user intervention.

## T6 — Concurrency and account lifecycle

Race two runtimes for one proof, one operation, leadership takeover, stale
recovery after takeover, logout, and account switching. Exactly one mutation
authority commits; old callbacks cannot write into the new account.

## T7 — Auctions P2PK

Crash or fail storage before/after refund-key persistence, during operation
preparation, after mint lock, before locked-result persistence, before/after
bid publication, during rebid, during reclaim/refund, and during seller
settlement. A mint lock never exists without durable sovereign refund authority
and one canonical monetary record.

Delete the primary wallet storage while an auction lock is active and restore
through the user-controlled disaster-recovery/export path. The correct
per-leg refund authority must remain available without turning the recovered
auction record into a second proof authority.

## T8 — Restore and migration

Cover multiple historical keysets, NUT-09 gaps and partial responses, stale
keyset metadata, NIP-60 duplicate/stale import, active auction locks, migration
restart at every phase, stale legacy writers, recovery-only executors,
conservation buckets, and account switching.

### Universal oracle

For every test:

- every sat is accounted for exactly once;
- no proof is locally spendable twice;
- no Lightning invoice is paid twice;
- no remote result is committed twice;
- ambiguous value remains unavailable but resumes reconciliation;
- every active locked workflow has one executable owner;
- and recovered proofs and tokens are cryptographically valid and usable
  against the controlled test mint.

Crash-consistency acceptance uses a controllable local mint and test harness
capable of proving real protocol state transitions. Public mints are not test
fixtures.

---

# Consequences

## Positive

- One canonical proof authority replaces the split Coco/NIP-60 design.
- Plebeian avoids implementing a bespoke generic Cashu state machine if the
  upstream gates pass.
- Operation recovery becomes a first-class invariant rather than a UI repair
  path.
- NIP-60 and future sync systems remain interoperable without controlling
  spendability.
- Auctions can use Coco P2PK operations while retaining Plebeian’s
  application-specific refund and business authority.
- The boundary can be shared with future Plebeian clients.

## Negative / tradeoffs

- Coco adoption is gated on work beyond released v2.0.0.
- Strict single-writer/fencing and migration boundaries add complexity.
- Existing NIP-60 runtime paths remain temporarily, increasing transition
  complexity.
- Migration requires explicit conservation and workflow executability, not a
  simple proof copy.
- Crash testing requires a more capable controlled mint harness than ordinary
  mocked API tests.
- Secret protection and account lifecycle need hardening before meaningful
  real-value use.
- NUT-09 restore scans are I/O-heavy and expose network metadata to mints.

---

# Rejected alternatives

## Keep NIP-60 as canonical monetary state

Rejected. Relay state is not reliable authority for bearer-proof spendability
and can preserve stale or zombie proof events.

## Run Coco and NIP-60 as permanent co-equal wallets

Rejected. Two proof stores make ownership and recovery ambiguous.

## Ship released Coco v2.0.0 unchanged

Rejected for real-value use. The architecture is promising, but released v2
does not satisfy all transaction, exact-send, rollback, keyset, and concurrency
gates.

## Harden rc11 inside Plebeian

Rejected. It would move generic wallet-engine responsibility into application
code just as Coco v2 is developing those primitives.

## Maintain a permanent invasive Coco fork

Rejected. If generic safety gaps cannot be maintained upstream, Plebeian
reconsiders the engine selection.

## Make replication availability part of every money operation

Rejected. Replication remains subordinate to the canonical local wallet and
cannot become an availability or custody dependency for ordinary local
correctness.

---

# Deferred decisions

This ADR intentionally does not choose:

- the final wallet replication transport;
- whether NIP-60 interoperability publishes by default;
- the exact encrypted backup format;
- the final cross-device active-writer protocol;
- the UX for disaster recovery;
- the exact production Coco version;
- or the implementation used to protect and recover auction refund secrets.

Those decisions may proceed independently only if they preserve this ADR’s
authority, durability, migration, and sovereignty invariants.

---

# Current upstream evidence

At the time of this decision, Coco has active, unmerged work addressing
cashu-ts/keyset compatibility (#446), stronger repository transactions,
transactional key allocation, and Send/Receive transaction hardening
(#460–#463). The durable event-outbox work (#456) concerns reliable side
effects but is not itself a monetary-transaction boundary. Separate mint-swap
orchestration work (#402) provides narrower evidence for durable parent
operations but is not a verified solution for Plebeian’s browser-wide runtime
fencing requirement.

These changes show that several required primitives are directionally
upstreamable. They are not production functionality until merged or explicitly
pinned, independently audited, and tested against this ADR. Their existence
does not establish an accepted upstream path for every gate.

Useful protocol and interoperability references remain:

- NUT-04, NUT-05, NUT-06, NUT-07, NUT-09, NUT-11, NUT-13, NUT-19, and NUT-27:
  https://github.com/cashubtc/nuts
- NIP-44, NIP-60, and NIP-78: https://github.com/nostr-protocol/nips
- Coco: https://github.com/cashubtc/coco
- cashu-ts: https://github.com/cashubtc/cashu-ts
- `brenorb/cashu-sync` as an interoperability/research reference only; it is
  not selected as a dependency or monetary authority:
  https://github.com/brenorb/cashu-sync

---

# Decision summary

Plebeian chooses:

> **Coco as the target Cashu wallet engine, conditionally.**

Plebeian does not choose:

> **The current rc11 integration or released v2.0.0 unchanged as a
> production-safe wallet implementation.**

Migration proceeds only after one frozen candidate passes the crash,
concurrency, melt, P2PK, keyset, migration, recovery-progress, and sovereignty
tests.

Until migration completes:

> **NIP-60 = KEEP_RUNTIME**

After Coco is the sole canonical monetary authority:

> **NIP-60 = KEEP_INTEROP**

At all times:

> **Remote replication state ≠ local spendability authority**

If the generic wallet-engine invariants cannot be delivered upstream without a
permanent Plebeian fork:

> **Coco adoption becomes NO-GO.**
