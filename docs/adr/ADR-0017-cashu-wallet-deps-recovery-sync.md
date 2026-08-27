# ADR-017: Cashu Wallet — Dependencies, Recovery, and Synchronization

## Status

Proposed

Bundles and replaces the previously proposed ADR-017 (dependency stack),
ADR-018 (NUT-09/NUT-27 recovery), and ADR-019 (state synchronization) per team
decision (2026-08-27): one coherent wallet ADR instead of three overlapping
ones. None of the prior 017–019 ever merged, so slot 017 is reused.

Adoption gates (unchanged from the original dependency proposal): team call on
wallet rebuild vs applesauce migration ordering, and Amperstrand confirmation
that coco 2.0 / a cashu-ts v5 release candidate is production-safe to follow.

## Date

2026-08-27

## Related

- Wallet rebuild research handover (2026-08-27), decisions D2–D7; kanban
  `t_5b37e6d3`, `t_6427128b`
- ADR-0002 — `@nostr-dev-kit/wallet` is NDK-coupled and conflicts with the
  applesauce migration; relays are transport, not database
- ADR-0005 — mints are external services and must be mocked in tests
- ADR-0022 — signer migration (separate ADR, PR #1252)
- Colleague's transport-independent wallet safety boundary ADR (in review,
  2026-08-27) — this ADR composes with it; see "Safety" below
- Incident context: 2026-08-21 demo wallet audit (decision D1)
- Hazard (hzrd149) zombie-token report, 2026-08-27

## Context

The bundled Cashu wallet (audited at `c827ad48` after the 2026-08-21 demo
incident) needs a rebuild across three coupled dimensions. Changing the
dependency stack changes what recovery APIs exist; the recovery model
determines what synchronization must guarantee; and the synchronization model
must respect where spendability actually lives. The team therefore decided to
decide them together.

The 2026-08-21 demo exposed: no reliable recovery path (destructive deletes,
no restore affordance), and NIP-60 relays acting as de-facto state of record —
when an event was dropped or a replaceable-event race occurred between two
devices, funds could become unrecoverable from the user's perspective.

A colleague's adversarial review sharpened the ownership model that this ADR
adopts as its foundation: **the local wallet is the canonical spendability
authority; the mint is the proof-state arbiter; transports (NIP-60, ContextVM,
snapshots) are pluggable replication adapters, none of them authoritative.**

## Decision

### 1. Dependencies

Adopt decision D2 from the wallet research handover:

- Build the wallet on `@cashu/coco-core@2.0.0` with `@cashu/coco-indexeddb`
  for the web app and `@cashu/coco-sqlite` for the phone app. The coco project
  has graduated to the official `@cashu/` scope (published 2026-08-17 by the
  cashubtc team); our current pin is the deprecated unscoped `1.0.0-rc11`.
- Accept `cashu-ts` transitively (coco-core 2.0.0 depends on
  `cashu-ts@5.0.0-rc.4`); do not add a direct pin. cashu-ts is the stateless
  protocol engine (blind signatures, mint HTTP, NUT specs); coco is the
  stateful wallet framework on top; the RC-track risk is gated on Amperstrand
  confirmation.
- Drop `@nostr-dev-kit/wallet`. Wallet code must not introduce new NDK
  coupling (ADR-0002 direction; the NDK footprint guard stays authoritative).
- Treat the migration as a rename from unscoped `rc11` plus a breaking-change
  map covering the `rc11 → 2.0.0` coco jump and the transitive
  `cashu-ts 2.x → 5.0.0-rc` major jump (tracked as `t_5b37e6d3`).

```
App (web / phone)
  └── @cashu/coco-core      — state, storage adapters, lifecycle, event bus
        └── @cashu/cashu-ts — blind signatures, mint HTTP, NUT specs
              └── @noble/*, @scure/bip32
```

### 2. Recovery

Adopt decisions D3 and D4. NUT-09 (Restore Token Outputs) is the first-class
recovery path — deterministic re-derivation of blinded messages from the seed
(NUT-13 HD path), POSTed in batches to the mint's `/v1/restore` endpoint; the
mint returns blind signatures for everything still unspent. Recovery works
even if both devices and all relays are lost. NUT-09 support was verified live
on `testnut.cashu.space` (2026-08-27); cashu-ts v4+ ships restore built-in
(`BatchRestoreConfig` / `RestoreAllConfig`), which the dependency stack above
provides transitively.

- **Gap-limit batching:** 100 indices per batch; stop after 3 consecutive
  empty batches (matches `RestoreAllConfig` semantics).
- **Historical keyset-ID caching:** mints rotate keysets; a scan against only
  the current keyset misses tokens minted under retired keysets. Cache
  historical keyset IDs (e.g., in the kind 17375 wallet config) so restore
  scans cover them.
- **NUT-27 mint-list backup:** back up the mint list as NIP-44-encrypted
  Nostr events derived from the seed, so the full wallet configuration
  (mints + tokens) recovers from seed alone. Open question (Amperstrand):
  seed-primary vs nostr-identity-primary derivation — blocks implementation
  details, not the decision.
- **IP-leak mitigation:** large restores reveal the client IP to the mint.
  Tunnel (Tor/VPN) by default for the restore operation.

### 3. Synchronization

Local-first ownership model (refines decisions D5–D7 after the Hazard
zombie-token report and the colleague's review):

- **Local wallet is the canonical spendability authority.** Proof state held
  and validated locally is spendable. No external store (relay heap, snapshot,
  sync message) ever overrides what the local wallet believes it holds.
- **The mint is the proof-state arbiter.** NUT-07 checkstate validates proofs
  against the mint **on admission and during recovery** — i.e., whenever state
  arrives from outside the device — **not as unconditional boot sweeps**. A
  proof already admitted and held locally is trusted at spend time; the mint's
  spend-time rejection is the final backstop. This avoids a mint round-trip on
  every boot while still filtering zombie tokens (spent proofs with lingering
  relay events) at every ingress point.
- **ContextVM is the leading replication candidate, not a locked choice.**
  ContextVM (MCP-over-Nostr, already integrated in this repo) carries the
  current unspent proof set as a single encrypted, signed payload — no
  append-only event heap, no tombstone reconstruction. Its final selection is
  the Phase 7 evaluation defined in the colleague's safety-boundary ADR; this
  ADR records it as the leading candidate and defines the properties any
  replication transport must satisfy (single-payload state, admission through
  the safety barrier, eventual consistency acceptable).
- **30078 snapshot is a non-authoritative backup.** An encrypted NIP-78
  replaceable event holds the current wallet state as a convenience backup.
  It can be stale or overwritten by a lagging device; it is therefore **routed
  through the same admission barrier** (checkstate + validation) as any other
  external state before it is ever trusted. A bad snapshot is an inconvenience
  (stale view, forced recovery), not a fund-loss event.
- **NIP-60 is kept as an optional interop adapter.** Proof events (7375) are
  not part of the canonical sync architecture; whether to publish them for
  compatibility with external NIP-60 wallets is an open product decision.
  Note a correction to earlier analysis on this branch: kind 7376 is **not**
  the NIP-60 tombstone — it is optional transaction history. NIP-60 deletion
  is successor-7375 `del` lineage plus NIP-09 kind-5 events. The zombie-token
  problem (relay-side loss/gap of deletion signal leaving phantom spendable
  proofs) remains real; this correction changes the mechanism description, not
  the conclusion that a relay heap cannot be canonical.
- **Swap-to-self before sync.** After receiving tokens, the wallet reissues
  before publishing state, so a stale overwriter loses economically (their
  tokens are already spent at the mint), not by event ordering.
- **Local-first storage on every device** (D6): coco-indexeddb on web,
  coco-sqlite on phone. Sync transports are I/O, not database (ADR-0002).
- **NIP-44 decrypt at the sync layer only** (D7): decrypt once when state is
  admitted, cache plaintext locally, never decrypt in render loops.

### Safety

This ADR composes with the colleague's transport-independent safety boundary
ADR (in review): all wallet state crossing a device boundary — ContextVM sync
payloads, 30078 snapshots, NIP-60 interop imports — passes through a single
admission barrier (validation, NUT-07 checkstate, limits) before entering
local spendable state. This ADR defines the wallet's dependency, recovery, and
replication choices; the safety ADR defines the boundary all of them route
through. Neither duplicates the other.

### Test constraints

- Mints are external services: all restore/mint/checkstate HTTP paths are
  mocked or intercepted in unit and e2e runs (ADR-0005). Importing
  `@cashu/cashu-ts` for pure functions remains allowed.
- Live probes (`testnut.cashu.space` NUT-09 verification) were one-time manual
  checks, not test fixtures.

## Consequences

Positive:

- One coherent decision surface for the wallet rebuild; the three areas can no
  longer drift apart in review.
- Official `@cashu/` scope with platform storage adapters; NDK wallet coupling
  removed (ADR-0002 footprint guard unburdened).
- Recovery works from seed alone even with lost devices and dropped relay
  events; the mint is always the backstop.
- Zombie tokens are filtered at ingress (admission-time checkstate) without
  per-boot mint round-trips; no O(n) relay heap scan anywhere.
- Transports stay pluggable: ContextVM can be replaced by any transport
  satisfying the recorded properties, decided in the Phase 7 evaluation.

Negative / tradeoffs:

- Transitively riding `cashu-ts@5.0.0-rc.4` puts a release candidate in
  production paths until v5 finalizes (Amperstrand gate).
- Admission-time checkstate adds a mint round-trip whenever external state
  arrives (batched per mint); accepted as the cost of correctness.
- NUT-09 restores are I/O-heavy and leak the client IP; tunneling is an
  operational requirement.
- NUT-27 seed-vs-nostr-identity derivation is unresolved; blocks NUT-27
  implementation details only.
- Reduced out-of-the-box interop with NIP-60-only wallets if the interop
  adapter is not adopted (open product decision).

## References

- NUT-07 (token state check), NUT-09 (restore), NUT-13 (HD wallets),
  NUT-27 (mint backup): https://github.com/cashubtc/nuts
- NIP-44, NIP-60, NIP-78: https://github.com/nostr-protocol/nips
- coco: https://github.com/cashubtc/coco · cashu-ts:
  https://github.com/cashubtc/cashu-ts
- npm packages verified live 2026-08-27: `@cashu/coco-core@2.0.0`,
  `@cashu/coco-indexeddb`, `@cashu/coco-sqlite`, `@cashu/cashu-ts`
- Wallet rebuild research handover, 2026-08-27 (decisions D2–D7)
- Hazard (hzrd149) zombie-token report, 2026-08-27
- Colleague's transport-independent wallet safety boundary ADR (in review,
  2026-08-27) — Phase 7 replication evaluation
