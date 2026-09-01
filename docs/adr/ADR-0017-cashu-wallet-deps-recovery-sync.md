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
zombie-token report and the colleague's review; the replication candidate and
the NIP-60 interop position are refined 2026-09-01 after the cashu-sync
consultation):

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
- **Mint-authoritative CAS/journal sync is the leading replication candidate
  (2026-09-01 refinement).** The reference is the cashu-sync model
  (brenorb/cashu-sync, "Silent Link"): the mint broadcasts nothing and is not
  a state publisher — it is the arbiter checked at operation time. Wallets
  sync NIP-44-encrypted whole-snapshot revisions with each other through a
  purpose-built compare-and-swap (CAS) relay: a new snapshot must name the
  current head or the relay rejects it, which makes every write atomic,
  unlike NIP-60's last-write-wins replaceable events. Every state-changing
  mint/melt is fenced by a wallet-owned pending-op journal (exactly one
  unresolved pending operation per snapshot; journaled operations are the
  only door to the mint). The correctness mechanism is exact-request
  idempotency — NUT-19 request replay, NUT-04/05 single-use quotes, and
  NUT-09 exact-output restore — not NUT-07 scanning ("Broader NUT-07 proof
  scanning is not part of the current product flow", cashu-sync spec). Honest
  limitation, recorded as an evaluation caveat rather than a blocker: fresh
  recovery from the recovery bundle trusts the relay — bootstrap accepts any
  head at revision ≥ 1. Active devices are rollback-safe (monotonic revision
  plus prev-chain verification); a freshly recovered device is not, until a
  mnemonic-only NUT-13/NUT-09 recovery path ships. brenorb/cashu-sync is
  UNLICENSED (licenseInfo null, verified live 2026-09-01): this ADR cites its
  spec only — spec-first, zero code dependency, never an import.
- **ContextVM is demoted to non-proof state at most.** Proofs are bearer
  credentials whose only arbiter is the mint, so any replication transport is
  at best a cache of them — at worst a second "proofs already spent" authority.
  ContextVM (MCP-over-Nostr, already integrated in this repo) has no CAS
  fencing, no pending-op journal, and no exact-request replay; it is not
  wallet-authoritative. Wallet-scoped metadata (history, labels) rides inside
  the encrypted snapshot; marketplace-scoped state already replicates as
  ordinary nostr events (ADR-0002: relays are transport, not database).
  Residual role: an optional transport for non-proof app-state replication.
- **Required properties for any sync transport.** Final selection stays with
  the Phase 7 evaluation defined in the colleague's safety-boundary ADR, but
  a candidate transport must provide: CAS-or-equivalent fencing (an atomic
  compare-and-swap on a single head, not timestamp last-write-wins); a
  pending-op journal (exactly one unresolved operation per snapshot, so
  journaled operations are the only path to the mint); exact-request replay
  (re-submitted operations are idempotent at the mint: NUT-19 replay,
  single-use quotes, NUT-09 exact-output restore); and admission through this
  ADR's barrier. The relay-side CAS rule is not the admission barrier — it is
  a different layer: a snapshot that clears the relay still passes
  checkstate-at-admission on the device, like every other external state.
- **Mint admission requirements for journaled operations.** Any mint used
  with journaled wallet operations must support NUT-09 (exact-output restore
  of the journaled blinded messages), NUT-19 (request replay), and NUT-05
  quote-check-with-change, verified via NUT-06 mint info at wallet setup.
  This is the admission gate for treasury mints: on a mint without these
  capabilities, a crash after the mint signs outputs but before the wallet
  persists them is a permanent loss — the replay cache and exact-output
  restore are the only recovery path.
- **30078 snapshot is a non-authoritative backup.** An encrypted NIP-78
  replaceable event holds the current wallet state as a convenience backup.
  It can be stale or overwritten by a lagging device; it is therefore **routed
  through the same admission barrier** (checkstate + validation) as any other
  external state before it is ever trusted. A bad snapshot is an inconvenience
  (stale view, forced recovery), not a fund-loss event. Kind 30078 is shared
  app-data space by design (NIP-78), so the snapshot carries a discipline
  list: (a) a unique, versioned, reverse-domain d-tag —
  `app.plebeian.market.wallet.snapshot.v0` — never `mint-list`, never anything
  cashu-sync's or cashu.me's code might filter for; (b) Plebeian-scoped/private
  relays only; (c) never share relays between this snapshot and any CAS
  deployment; (d) one registry convention line in the docs recording every
  kind-30078 d-tag this repo uses, so no two Plebeian uses collide.
- **NIP-60 is kept as an optional interop adapter — import yes, publish no
  (decided 2026-09-01).** Proof events (7375) are not part of the canonical
  sync architecture, and we do not publish them by default. Mechanism
  correction: kind 7375 content is NIP-44-encrypted to the wallet owner's own
  key (the wallet key itself sits encrypted inside the 17375 event), so
  another user cannot read it — importing 7375 events from another user is
  not a thing. The interop vehicle is the raw token string, and a bare token
  has the re-spend race until redemption; a token P2PK-locked to the recipient
  is the safe handoff. An earlier correction on this branch stands: kind 7376
  is **not** the NIP-60 tombstone — it is optional transaction history;
  NIP-60 deletion is successor-7375 `del` lineage plus NIP-09 kind-5 events.
  The zombie-token problem (relay-side loss/gap of deletion signal leaving
  phantom spendable proofs) remains real, and a relay heap cannot be canonical.
  The adapter's value is inbound: users arriving from NIP-60 wallets —
  including along our own applesauce migration (NutWallet is NIP-60-native) —
  import their own 17375/7375 events, decrypt locally, and admit the proofs
  through the barrier (checkstate: they may be stale), optionally
  swap-to-self. A colleague's full-drop retirement after a production failure
  is right for that context but overbroad for a marketplace that wants
  migrating users.
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
- Transports stay pluggable: the leading CAS/journal candidate can be
  replaced by any transport satisfying the recorded properties, decided in
  the Phase 7 evaluation.

Negative / tradeoffs:

- Transitively riding `cashu-ts@5.0.0-rc.4` puts a release candidate in
  production paths until v5 finalizes (Amperstrand gate).
- Admission-time checkstate adds a mint round-trip whenever external state
  arrives (batched per mint); accepted as the cost of correctness.
- NUT-09 restores are I/O-heavy and leak the client IP; tunneling is an
  operational requirement.
- NUT-27 seed-vs-nostr-identity derivation is unresolved; blocks NUT-27
  implementation details only.
- NIP-60 interop is import-only by default (publish no, decided 2026-09-01):
  NIP-60-only wallets cannot receive relay-published proofs from us; inbound
  migration from NIP-60 wallets is supported instead.
- A CAS-style transport depends on its relay for liveness (relay unavailable
  blocks new operations — correctness over availability), and fresh bundle
  recovery trusts the relay's head (evaluation caveat, Synchronization);
  both accepted as the price of fencing.

## References

- NUT-04 (mint quotes), NUT-05 (melt quotes), NUT-06 (mint info),
  NUT-07 (token state check), NUT-09 (restore), NUT-11 (P2PK spending
  conditions), NUT-13 (HD wallets), NUT-19 (request replay),
  NUT-27 (mint backup): https://github.com/cashubtc/nuts
- NIP-44, NIP-60, NIP-78: https://github.com/nostr-protocol/nips
- coco: https://github.com/cashubtc/coco · cashu-ts:
  https://github.com/cashubtc/cashu-ts
- brenorb/cashu-sync (Silent Link) — mint-authoritative CAS/journal sync
  reference model; UNLICENSED (licenseInfo null, verified live 2026-09-01),
  cited as spec only with zero code dependency:
  https://github.com/brenorb/cashu-sync
- Cashu sync consultation verdict (fact-checked), 2026-09-01 — source of the
  2026-09-01 Synchronization refinement
- npm packages verified live 2026-08-27: `@cashu/coco-core@2.0.0`,
  `@cashu/coco-indexeddb`, `@cashu/coco-sqlite`, `@cashu/cashu-ts`
- Wallet rebuild research handover, 2026-08-27 (decisions D2–D7)
- Hazard (hzrd149) zombie-token report, 2026-08-27
- Colleague's transport-independent wallet safety boundary ADR (in review,
  2026-08-27) — Phase 7 replication evaluation
