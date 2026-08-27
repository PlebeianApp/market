# ADR-019: Wallet State Synchronization — Hybrid WAL + Checkpoint

## Status

Proposed

Pending Hazard (hzrd149) review of the hybrid heap+snapshot design.

## Date

2026-08-27

## Related

- Wallet rebuild research handover (2026-08-27), decisions D5, D6, D7;
  kanban `t_6427128b`
- ADR-0002 — relays as I/O transport; applesauce EventStore→QueryStore
  liveness model
- ADR-017 — `@cashu/coco-core@2.0.0` family provides the local-first
  storage adapters this ADR depends on
- ADR-018 — NUT-09 restore-from-mint is the mint-level backstop; this
  ADR defines the device-to-device sync layer above it
- NIP-60 (Cashu wallet events), NIP-78 (arbitrary custom app data)

## Context

Chiefmonkey wants NIP-60 to sync the web wallet with a planned mobile
app. NIP-60 (still `draft optional`) stores encrypted proofs on relays.
Public relays give no availability guarantees. Known failure modes:
dropped events, replaceable-event races between two devices, and garbage
collection of old events.

Two candidate architectures were evaluated:

**A. Immutable token heap (noStrudel / hzrd149's choice; NIP-60 as
specced):**

- kind 7375 (Cashu Token) events = append-only pile of proofs; kind 7376
  (Nutzap Redemption) events = tombstones marking spent proofs.
- Balance = scan all 7375s minus everything tombstoned by 7376s.
- Safe: nothing is ever overwritten → no merge logic, no version
  counters; double-spend protection at the mint (final arbiter).
- Cost: event proliferation; fresh-device load scans everything; relays
  accumulate dead events forever.

**B. Full-state snapshot (initial proposal):**

- One encrypted 30078 (NIP-78, Arbitrary Custom App Data) replaceable
  event holding entire wallet state.
- Fast read, instant convergence — but replaceable = last-writer-wins by
  `created_at`, which is clock-unsafe for proofs; needed payload-internal
  version counter + 3-way merge; a merge bug loses funds.

Neither is sufficient alone. Pure-A is correct but slow on cold boot.
Pure-B is fast but a merge bug in the 3-way merge loses funds.

## Decision

Adopt decision D5 from the wallet research handover: a hybrid
write-ahead-log (WAL) + checkpoint model, borrowed from database
architecture.

```
CANONICAL TRUTH:  heap (kind 7375 + kind 7376), append-only, never edited
DERIVED CACHE:    30078 snapshot — current unspent set, highest
                 derivation index (skips NUT-09 rescan), pointer into heap
```

### Locked properties

- **Heap is canonical.** Kinds 7375 and 7376 form an append-only truth
  log. Nothing is ever overwritten. Balance = scan 7375s minus 7376
  tombstones. Double-spend protection is at the mint (final arbiter).
- **Snapshot is derived, never authoritative.** The encrypted 30078
  event holds the current unspent set, the derivation counter, and a
  pointer into the heap. It is a rebuildable cache for fast boot. A bad
  merge in the snapshot is an inconvenience, not a fund-loss event.
- **Drift triggers heap rebuild.** If the snapshot is missing, stale,
  or corrupt, the device rebuilds from the heap. The snapshot never
  loses funds; the heap is always there to recover from.
- **Swap-to-self before publish.** After receiving tokens, the wallet
  reissues (swap-to-self) before publishing state. Stale overwriters
  lose economically — their tokens are already spent at the mint — not
  by event ordering. This is Fedimint's restore pattern adapted to our
  sync layer.
- **Local-first storage on both devices** (decision D6). coco-indexeddb
  on web, coco-sqlite on phone (ADR-017). Relays are sync transport,
  not database.
- **NIP-44 decrypt at the sync layer only** (decision D7). Decrypt
  once when syncing, cache plaintext state in local storage. Never
  decrypt in render loops — this matters for mobile CPU.

### Device boot sequence

1. Fetch snapshot (30078) → instant balance.
2. Fetch heap events (7375/7376) newer than the snapshot's pointer →
   incremental catch-up.
3. Verify the merged state against the heap.
4. If snapshot is missing, stale, or corrupt → rebuild from heap.

### Residual unsolved (tracked)

- Device-vs-device spend race is a UX reconciliation problem in every
  design; the mint rejects the loser. Not solved by this ADR.
- Snapshot drift needs periodic verification against the heap plus a
  mint checkstate call.

### Multi-mint hygiene (candidate, not locked)

Auto-melt unknown-mint tokens to primary mint to keep payloads small.
This is a candidate, not a locked decision.

## Consequences

Positive:

- The dangerous 3-way-merge requirement of pure-B is dissolved: a bad
  snapshot merge triggers a heap rebuild, not a fund-loss event.
- Cold boot is fast (snapshot) without sacrificing correctness (heap
  is always authoritative).
- Append-only heap means no version counters, no replaceable-event
  races, no clock-safety dependency for spendable state.
- Swap-to-self before publish means stale overwriters lose
  economically (their tokens are spent), not by relay event ordering.
- NIP-44 decrypt-at-sync-layer keeps render loops cheap on mobile.

Negative / tradeoffs:

- Event proliferation: the heap grows indefinitely; relays accumulate
  dead (spent) events. Compaction is a future concern.
- Fresh-device cold boot scans the full heap when no snapshot exists;
  the snapshot mitigates this only when present and valid.
- Snapshot drift verification adds a periodic mint checkstate call.
- The hybrid is more complex than either pure-A or pure-B alone;
  implementation must enforce the "snapshot is never authoritative"
  invariant rigorously.

## References

- NIP-60: https://github.com/nostr-protocol/nips/blob/master/60.md
- NIP-78: https://github.com/nostr-protocol/nips/blob/master/78.md
- NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md
- Fedimint recovery (snapshot + reissue-on-restore):
  https://github.com/fedimint/fedimint
- GNU Taler sync: https://docs.taler.net
- Wallet rebuild research handover, 2026-08-27 (decisions D5, D6, D7)