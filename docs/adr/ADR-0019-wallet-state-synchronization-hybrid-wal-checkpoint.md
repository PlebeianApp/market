# ADR-019: Wallet State Synchronization — ContextVM Primary, Snapshot Backup, Mint Recovery

## Status

Revised — supersedes the original "Hybrid WAL + Checkpoint" proposal on this
branch.

Updated 2026-08-27 after Hazard (hzrd149) identified the zombie token problem
in the NIP-60 heap design. The heap is demoted from canonical truth; ContextVM
becomes the primary sync layer.

## Date

2026-08-27 (original), 2026-08-27 (revision)

## Related

- Wallet rebuild research handover (2026-08-27), decisions D5, D6, D7;
  kanban `t_6427128b`
- ADR-0002 — relays as I/O transport; applesauce EventStore→QueryStore
  liveness model
- ADR-017 — `@cashu/coco-core@2.0.0` family provides the local-first
  storage adapters this ADR depends on
- ADR-018 — NUT-09 restore-from-mint is the mint-level backstop; this
  ADR defines the device-to-device sync layer above it
- ContextVM SDK (`@contextvm/sdk` v0.8.0) — Nostr-native MCP transport
  with `NostrClientTransport`, `NostrServerTransport`,
  `PrivateKeySigner`, `ApplesauceRelayPool` (see `contextvm/server.ts`,
  `src/lib/cvm-identity.ts`, `docs/contextvm-ctxcn-workflow.md`)
- NIP-60 (Cashu wallet events), NIP-78 (arbitrary custom app data),
  NIP-44 (encryption)

## Context

Chiefmonkey wants NIP-60 to sync the web wallet with a planned mobile
app. The original ADR-019 proposed a hybrid WAL+checkpoint model where
the NIP-60 token heap (kinds 7375/7376) was canonical truth and a 30078
snapshot was a derived cache.

### The zombie token problem

Hazard (hzrd149) reported that NIP-60 is unreliable for Cashu proof
storage due to **zombie tokens**: proofs that have been spent at the
mint but whose kind 7375 events remain on relays, and whose
corresponding kind 7376 tombstones are either missing, dropped by the
relay, or arrive out of order. This produces a class of phantom proofs
that appear spendable to any client scanning the heap but are rejected
by the mint on spend.

Specific failure modes observed:

1. **Relay tombstone loss**: A 7376 deletion event is not stored or is
   garbage-collected by the relay before all devices observe it. The
   7375 token event remains, falsely inflating the apparent balance.
2. **Replaceable-event race on wallet config (kind 17375)**: Two devices
   editing mint lists or keyset-ID caches overwrite each other's
   updates. The last writer wins by `created_at`, which is
   clock-unsafe.
3. **Cross-device tombstone gap**: Device A spends a proof and
   publishes a 7376 tombstone. Device B was offline. When B comes
   online, B's local heap scan sees the 7375 but the 7376 has been
   evicted by the relay. B treats the spent proof as spendable.
4. **Heap scan as balance computation**: Balance = all 7375s minus all
   7376 tombstones. This is O(n) in lifetime events and grows
   indefinitely. Every cold boot re-scans the entire history. Zombie
   7375s without matching 7376s produce phantom balance.

The root cause is that an append-only heap of individual proof events
plus tombstone events relies on relay availability for tombstone
delivery. Relays give no delivery guarantees. The heap design assumes
the relay is a reliable message bus; ADR-0002 already established that
relays are best-effort I/O transport, not a database.

### Why ContextVM instead

ContextVM (`@contextvm/sdk`) provides Nostr-native MCP transport:
encrypted, signed, request-response messaging over Nostr relays. The
wallet sync layer can use ContextVM's `NostrClientTransport` to send
structured state (current unspent proof set, derivation counter, mint
list) between devices as an MCP tool call, not as a pile of individual
events. This eliminates the heap-scan problem: the state is a single
authoritative payload, not a reconstruction from scattered events.

ContextVM is already integrated in the repository:

- `contextvm/server.ts` — running currency server using
  `NostrServerTransport`, `PrivateKeySigner`, `ApplesauceRelayPool`
- `src/lib/cvm-identity.ts` — CVM server key resolution
- `src/lib/ctxcn-client.ts` — generated CTXCN client
  (`PlebianCurrencyClient`)
- `docs/contextvm-ctxcn-workflow.md` — client generation workflow

The SDK supports `NostrClientTransport` (client-side) and
`NostrServerTransport` (server-side), both over Nostr relays with
NIP-44 encryption. The payments module adds NIP-47 (NWC) and NIP-57
(zap) support for Lightning integration.

## Decision

Replace the heap-canonical design with a three-tier model:

```
PRIMARY SYNC:    ContextVM — MCP-over-Nostr state transport
                 (encrypted, signed, request-response, single payload)
BACKUP SNAPSHOT: 30078 (NIP-78) — encrypted replaceable event holding
                 current unspent set + derivation counter
RECOVERY:        NUT-09 restore-from-mint + mint checkstate
                 (ADR-018; mint is final arbiter of spend validity)
```

### Tier 1 — ContextVM primary sync

ContextVM is the primary device-to-device sync channel. When a device
receives or spends tokens, it sends a `wallet_state_sync` MCP tool
call via `NostrClientTransport` to a ContextVM wallet sync relay (or
directly to a peer device acting as a CVM server). The payload is:

- Current unspent proof set (grouped by mint, with keyset IDs)
- Highest derivation index used
- Mint list (from NUT-27 backup)
- Monotonic sequence counter (for ordering; not for correctness —
  the mint is the final arbiter)

This is a single encrypted payload, not a pile of events. There is no
heap to scan. There are no zombie tokens because the payload is the
current state, not a reconstruction from history.

**Key design choices:**

- **Swap-to-self before sync.** After receiving tokens, the wallet
  reissues (swap-to-self) before syncing state. Stale overwriters lose
  economically — their tokens are already spent at the mint — not by
  event ordering. This is Fedimint's restore pattern adapted to our
  sync layer (carried over from the original ADR's D5).
- **Sequence counter for UX, not correctness.** The monotonic counter
  lets the receiving device know which state is newer, avoiding
  unnecessary state writes. But correctness does not depend on it:
  the mint's checkstate call validates every proof.
- **NIP-44 encryption at the transport layer.** ContextVM encrypts the
  MCP payload via NIP-44. The receiving device decrypts once and
  caches plaintext state in local storage. Never decrypt in render
  loops (D7 from the original ADR, preserved).
- **No relay availability dependency for correctness.** If a ContextVM
  message is dropped, the receiving device falls back to the 30078
  snapshot (Tier 2) and ultimately to NUT-09 (Tier 3). A missed sync
  message is a stale-view inconvenience, not a fund-loss event.

### Tier 2 — 30078 snapshot backup

An encrypted 30078 (NIP-78, Arbitrary Custom App Data) replaceable
event holds the wallet state as a backup. This is the same role as
in the original ADR, but its meaning changes: it is no longer a
derived cache of a canonical heap. It is a standalone backup that
can be used independently.

Contents:

- Current unspent proof set (same structure as the ContextVM payload)
- Highest derivation index
- Mint list pointer (NUT-27 mint backup events)
- Sequence counter (matches the last ContextVM sync)
- Timestamp

**Snapshot is never canonical.** The snapshot can be stale. It can be
overwritten by a device that has not yet received the latest ContextVM
sync. This is safe because:

1. The mint is the final arbiter. A proof in the snapshot that has
   been spent at the mint is rejected on spend attempt.
2. NUT-09 + checkstate (Tier 3) validates every proof against the
   mint before trusting it.
3. Swap-to-self before publish means a stale overwriter's tokens are
   already spent — they lose economically, not by event ordering.

A bad snapshot is an inconvenience (stale view, forced recovery), not
a fund-loss event.

### Tier 3 — NUT-09 + checkstate recovery

NUT-09 restore-from-mint (ADR-018) is the final recovery path. It
works even if ContextVM sync fails, the 30078 snapshot is corrupt or
missing, and both devices are lost. The mint is the last-resort truth.

**Mint checkstate** validates the proof set from either Tier 1 or
Tier 2 against the mint before the wallet trusts the balance. This
is the defense against zombie tokens: even if a stale sync message
or snapshot contains spent proofs, checkstate filters them out.

The checkstate flow:

1. Fetch state from ContextVM (Tier 1) or snapshot (Tier 2).
2. For each mint in the state, call the mint's checkstate endpoint
   with the proof secret Y values.
3. Remove any proofs the mint reports as spent.
4. The remaining proof set is the trusted balance.
5. If the proof set is empty or the state is missing entirely, fall
   back to NUT-09 restore-from-mint (full rescan from seed).

### Locked properties

- **ContextVM is primary sync.** Device-to-device state transport
  uses ContextVM MCP-over-Nostr. The payload is the current unspent
  set, not an event heap. No heap scan, no tombstone reconstruction,
  no zombie tokens.
- **30078 snapshot is backup, never canonical.** The encrypted
  replaceable event holds the current wallet state as a standalone
  backup. It can be stale. A bad snapshot triggers checkstate
  validation or NUT-09 recovery, not fund loss.
- **NUT-09 + checkstate is recovery.** The mint is the final
  arbiter. Every proof is validated against the mint before
  trusting the balance. NUT-09 restore works from seed alone,
  even if all sync channels and snapshots are lost.
- **Swap-to-self before sync.** After receiving tokens, the wallet
  reissues before publishing state. Stale overwriters lose
  economically (their tokens are spent), not by event ordering.
- **Local-first storage on both devices** (decision D6). coco-indexeddb
  on web, coco-sqlite on phone (ADR-017). Relays and ContextVM are
  sync transport, not database.
- **NIP-44 decrypt at the sync layer only** (decision D7). Decrypt
  once when syncing, cache plaintext state in local storage. Never
  decrypt in render loops — this matters for mobile CPU.
- **NIP-60 heap is not used.** Kinds 7375 and 7376 are not part of
  the sync architecture. The NIP-60 wallet config event (kind 17375)
  may still be used for mint list and keyset-ID caching (per ADR-018),
  but individual proof events are not published to relays.

### Device boot sequence

1. **ContextVM sync** — send a `wallet_state_request` MCP tool call
   via `NostrClientTransport`. If a peer device or CVM server
   responds, receive the current unspent set instantly.
2. **Fallback to 30078 snapshot** — if ContextVM sync is unavailable
   (no peer online, relay issues), fetch the 30078 snapshot for a
   fast approximate balance.
3. **Checkstate validation** — for each mint in the received state,
   call the mint's checkstate endpoint. Remove spent proofs (zombie
   token defense).
4. **NUT-09 recovery** — if both ContextVM and snapshot are missing,
   or if checkstate reports all proofs as spent, run NUT-09
   restore-from-mint (full rescan from seed, per ADR-018).
5. **Local-first persistence** — write the validated state to local
   storage (coco-indexeddb / coco-sqlite). Render from local state.

### Residual unsolved (tracked)

- **Device-vs-device spend race** is a UX reconciliation problem in
  every design; the mint rejects the loser. Not solved by this ADR.
- **ContextVM server availability** — the sync layer depends on a
  CVM server or peer device being reachable. If no peer is online,
  the device falls back to snapshot + checkstate. This is acceptable
  but means sync is eventually consistent, not instant.
- **ContextVM wallet sync tool** — the `wallet_state_sync` /
  `wallet_state_request` MCP tools are not yet implemented in
  `contextvm/server.ts`. The current server only exposes
  `get_btc_price` / `get_btc_price_single`. Implementation is
  required for this ADR to be actionable.
- **30078 snapshot drift** — needs periodic checkstate validation
  against the mint even when ContextVM sync is working, to catch
  proofs spent on another device that haven't been synced yet.

### Multi-mint hygiene (candidate, not locked)

Auto-melt unknown-mint tokens to primary mint to keep payloads small.
This is a candidate, not a locked decision. (Carried over from the
original ADR.)

## Consequences

Positive:

- **No zombie tokens.** The primary sync channel (ContextVM) carries
  the current unspent set as a single payload, not an event heap.
  There is no tombstone reconstruction to get wrong, no relay
  tombstone loss, no O(n) heap scan producing phantom balance.
- **Defense in depth.** Three tiers (ContextVM → snapshot → NUT-09)
  provide graded fallback. Each tier is independently recoverable.
  The mint is always the final arbiter.
- **Cold boot is fast.** ContextVM sync or 30078 snapshot gives
  instant approximate balance. Checkstate validates it. NUT-09 is the
  full-rescan backstop.
- **Swap-to-self before publish** means stale overwriters lose
  economically (their tokens are spent), not by relay event ordering.
- **NIP-44 decrypt-at-sync-layer** keeps render loops cheap on mobile.
- **Leverages existing infrastructure.** ContextVM is already
  integrated in the repo (server, client, identity resolution). The
  wallet sync tool is a new MCP tool registration, not a new
  subsystem.
- **NIP-60 demoted to config-only.** Kind 17375 (wallet config) may
  still carry mint lists and keyset-ID caches (per ADR-018), but
  individual proof events (7375/7376) are no longer published. This
  eliminates the append-only heap and its proliferation problem.

Negative / tradeoffs:

- **ContextVM dependency for primary sync.** If the CVM server or
  peer device is unreachable, sync degrades to snapshot + checkstate.
  This is acceptable but adds a runtime dependency for the fast path.
- **New MCP tool implementation required.** The `wallet_state_sync` and
  `wallet_state_request` tools must be implemented in the ContextVM
  server and client. This is implementation work, not new
  architecture.
- **30078 snapshot is still replaceable (last-writer-wins).** The
  snapshot can be overwritten by a stale device. This is safe
  (checkstate + swap-to-self + NUT-09 recovery) but means the
  snapshot alone is never trusted without validation.
- **Checkstate adds a mint round-trip on boot.** Every proof in the
  received state is validated against the mint. For large wallets
  this is a batch of API calls. Mitigated by batching per mint.
- **NUT-09 restore is I/O-heavy and leaks IP.** Full rescan from
  seed reveals the client IP to the mint. Tunneling (Tor/VPN) is
  required (per ADR-018). This is the backstop, not the common path.
- **NIP-60 compatibility.** Existing NIP-60 wallets (noStrudel,
  other implementations) that rely on 7375/7376 events will not see
  proof events from this wallet. Interoperability with NIP-60-only
  wallets is reduced. This is an accepted tradeoff: the NIP-60 heap
  is the source of the zombie token problem.

## Comparison to original ADR-019

| Property            | Original (heap-canonical)             | Revised (ContextVM-primary)                               |
| ------------------- | ------------------------------------- | --------------------------------------------------------- |
| Canonical truth     | NIP-60 heap (7375/7376)               | Mint (NUT-09 + checkstate)                                |
| Primary sync        | Heap scan (7375 minus 7376)           | ContextVM MCP state transport                             |
| Fast boot           | 30078 snapshot (derived cache)        | ContextVM sync or 30078 snapshot                          |
| Zombie tokens       | Possible (tombstone loss, relay gaps) | Eliminated (current state payload, checkstate validation) |
| Heap scan cost      | O(n) in lifetime events               | Eliminated (no heap)                                      |
| Event proliferation | 7375/7376 accumulate forever          | Eliminated (no proof events published)                    |
| Recovery            | Heap rebuild                          | NUT-09 + checkstate (ADR-018)                             |
| Snapshot role       | Derived cache of heap                 | Standalone backup                                         |
| Swap-to-self        | Yes (preserved)                       | Yes (preserved)                                           |
| Local-first         | Yes (D6, preserved)                   | Yes (D6, preserved)                                       |
| NIP-44 decrypt      | Sync layer only (D7, preserved)       | Sync layer only (D7, preserved)                           |

## References

- NIP-60: https://github.com/nostr-protocol/nips/blob/master/60.md
- NIP-78: https://github.com/nostr-protocol/nips/blob/master/78.md
- NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md
- NUT-09: https://github.com/cashubtc/nuts/blob/main/09.md
- NUT-13: https://github.com/cashubtc/nuts/blob/main/13.md
- NUT-27: https://github.com/cashubtc/nuts/blob/main/27.md
- ContextVM SDK: https://github.com/ContextVM/ts-sdk
- ContextVM documentation: https://contextvm.org
- Fedimint recovery (snapshot + reissue-on-restore):
  https://github.com/fedimint/fedimint
- GNU Taler sync: https://docs.taler.net
- Wallet rebuild research handover, 2026-08-27 (decisions D5, D6, D7)
- Hazard (hzrd149) zombie token report, 2026-08-27
