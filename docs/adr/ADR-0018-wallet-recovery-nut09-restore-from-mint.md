# ADR-018: Wallet Recovery via NUT-09 Restore-from-Mint (+NUT-27 Mint-List Backup)

## Status

Proposed

## Date

2026-08-27

## Related

- Wallet rebuild research handover (2026-08-27), decisions D3 and D4
- ADR-0002 — relays as transport, not database; applesauce I/O seam
- ADR-0005 — mints are external services, must be mocked in tests
- ADR-017 — `@cashu/coco-core@2.0.0` family, transitively pulls
  `cashu-ts@5.0.0-rc.4` which provides `BatchRestoreConfig` /
  `RestoreAllConfig`
- Incident context: 2026-08-21 demo wallet audit (decision D1 — fund-loss
  affordances were unconfirmed destructive actions and unrecoverable
  deletion)

## Context

The 2026-08-21 demo exposed that the bundled wallet had no reliable
recovery path: users deleted proofs and had no way to recover funds, and
the existing restore-from-mint flow is outdated and non-interoperable with
modern mints. NIP-60 relays were the de-facto state of record; when an
event was dropped or a replaceable-event race happened between two devices,
funds could become unrecoverable from the user's perspective.

NUT-09 (Restore Token Outputs) defines a deterministic recovery protocol
that does not involve relays at all:

1. The wallet derives deterministic secrets from its seed using NUT-13's
   HD path (`m/129372'/keyset_id_hash'/counter`).
2. It re-derives blinded messages and POSTs batches to the mint's
   `/v1/restore` endpoint.
3. The mint returns blind signatures for everything still unspent.
4. The wallet unblinds → proofs are rebuilt from scratch.

The mint is the last-resort truth and the final arbiter of spend
validity. Recovery works even if both devices and all relays are lost.

NUT-09 was verified live on 2026-08-27: `testnut.cashu.space` `/v1/info`
reports `NUT-09 supported: true`. cashu-ts v4+ ships restore built-in
(`BatchRestoreConfig` / `RestoreAllConfig`, `src/wallet/Wallet.ts:1991+`).
The proposed dependency stack (ADR-017) transitively pulls cashu-ts
v5, which provides these APIs.

NUT-27 (Nostr Mint Backup) is an `optional` Cashu spec (fetched
2026-08-27 from `raw.githubusercontent.com/cashubtc/nuts/main/27.md`)
that covers the one thing NUT-09 does not: the mint list. The wallet
backs up its list of mints as NIP-44-encrypted addressable Nostr events,
with keys deterministically derived from the mnemonic:
`privkey = SHA256(bip39_seed ‖ "cashu-mint-backup")`. Restores on any
compatible wallet from the seed alone.

## Decision

Adopt decisions D3 and D4 from the wallet research handover:

### D3 — NUT-09 restore-from-mint as first-class recovery

- Restore-from-mint is the first-class recovery path, surfaced in wallet
  settings (not buried behind a destructive action).
- NIP-60 relays are demoted to sync transport. They are never the source
  of truth for spendable state. This aligns with ADR-0002's direction
  that relays are I/O, not state.
- Gap-limit batching: 100 indices per batch; stop after 3 consecutive
  empty batches (matches cashu-ts v4/v5 `RestoreAllConfig` semantics).
- Historical keyset-ID caching: mints rotate keysets; a naive scan
  against the current keyset misses old tokens minted under retired
  keysets. Cache historical keyset IDs in the NIP-60 config event
  (kind 17375) so restore scans cover retired keysets.
- IP-leak mitigation: large restores reveal the client IP to the mint.
  Tunnel (Tor/VPN) by default for the restore operation.

### D4 — NUT-27 mint-list backup

- Adopt NUT-27 for mint-list backup alongside NUT-09 token restore. This
  ensures a user can recover their full wallet configuration (mints
  and tokens) from the seed alone.

### Compatibility question (open — Amperstrand)

NUT-27 derives its Nostr key from the Cashu mnemonic
(mnemonic-primary). Plebeian is nostr-identity-primary. Either we adopt
a seed phrase as root (NUT-27-compatible out of the box) or derive the
Cashu seed from the Nostr key via HKDF (cleaner UX, non-standard).
Awaiting expert input (Amperstrand, message sent 2026-08-27). This
blocks D4 implementation details but not the architectural decision to
adopt NUT-27.

### Test constraints

- Tests must not call live mints (ADR-0005). Restore and mint HTTP paths
  are mocked or intercepted.
- `testnut.cashu.space` NUT-09 verification was a one-time manual probe,
  not a test fixture.

## Consequences

Positive:

- Recovery works even when relays have dropped events, devices are lost,
  or local storage is wiped — the mint is the backstop.
- Demoting relays to sync transport eliminates the replaceable-event
  race and dropped-event failure modes that made the NIP-60-only
  design fragile.
- NUT-27 mint-list backup complements NUT-09 token restore so the user
  can recover from seed alone with no manual mint configuration.
- Historical keyset-ID caching closes the rotation hazard where
  retired-keyset tokens are silently missed by a current-keyset scan.

Negative / tradeoffs:

- Large restores are I/O-heavy and reveal the client IP to the mint;
  the tunneling requirement adds operational complexity.
- Keyset-ID caching in kind 17375 adds a schema field that must be
  maintained and versioned.
- NUT-27 + NIP-60 identity compatibility is unresolved (seed UX
  question blocks implementation details, not the decision).
- NUT-09 and NUT-27 are `optional` Cashu specs; mint support must be
  verified per-mint. Which prod mints to list depends on Amperstrand's
  reply.

## References

- NUT-09: https://github.com/cashubtc/nuts/blob/main/09.md
- NUT-13: https://github.com/cashubtc/nuts/blob/main/13.md
- NUT-27: https://github.com/cashubtc/nuts/blob/main/27.md
- NIP-60: https://github.com/nostr-protocol/nips/blob/master/60.md
- Test mint (NUT-09 verified live 2026-08-27):
  https://testnut.cashu.space
- Wallet rebuild research handover, 2026-08-27 (decisions D3, D4)
