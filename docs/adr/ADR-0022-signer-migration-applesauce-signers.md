# ADR-0022: Signer Migration to applesauce-signers

## Status

Proposed

## Date

2026-08-27

## Related

- ADR-0002 (Nostr I/O migration; Waves A3/A3b deferred the signer paths — this ADR specifies them)
- ADR-0017 (Cashu wallet dependency stack; shares the unified target stack)
- Supersedes no prior ADR

## Context

All four login paths in the app currently sign through NDK signers, centered on
`src/lib/stores/auth.ts` (572 lines @ `c827ad48`):

| Login path       | Current implementation                                         |
| ---------------- | -------------------------------------------------------------- |
| NIP-46 bunker    | `NDKNip46Signer` (`auth.ts:436`)                               |
| NIP-07 extension | `NDKNip07Signer` (`auth.ts:396`)                               |
| nsec raw key     | `NDKPrivateKeySigner` (`auth.ts:346`)                          |
| NIP-49 ncryptsec | `nostr-tools` `nip49.decrypt` → raw-key signer (`auth.ts:288`) |

A signer audit (verified from package tarballs and live npm, 2026-08-27) found:

- `@nostr-dev-kit/ndk` is stale (~6 months, last release 2026-02-23) and drags
  `shiki`/`sandpack-client` into the client bundle.
- `nostr-tools` is very active (1.5M downloads/week, release 2026-08-24) and is
  already the shared event layer.
- `applesauce-signers` (note: the package name — `@applesauce/signers` does not
  exist) at 6.2.2 (2026-07-01, hzrd149) covers every current login path 1:1:
  `NostrConnectSigner` (NIP-46, with `encodeNbunksec` session strings),
  `ExtensionSigner` (NIP-07, `window.nostr` proxy), `PrivateKeySigner` (raw
  key), `PasswordSigner` (NIP-49, `fromNcryptsec` + `unlock`/`lock`), plus
  `AmberClipboardSigner`, `AndroidNativeSigner`, and `ReadOnlySigner`.
- Cashu libraries **cannot sign nostr events**: `@cashu/coco-core` 2.0.0 and
  `@cashu/cashu-ts` 4.9.0 have zero nostr event-signing capability (verified
  from tarballs). The NUT-27 hypothesis is disproven for the TS libraries.

Three NDK-internal hacks exist in `auth.ts` to work around NDK signer behavior:

1. `_user` cache poke (`auth.ts:103`)
2. RPC listener strip (`auth.ts:90–96`)
3. `userPubkey` clear-restore (`auth.ts:125`)

Additional current-state facts:

- `src/lib/nostr/io-applesauce.ts` `sign()` deliberately throws — "not wired
  until Wave A3".
- `src/lib/nip59.ts` depends on NDK's extended `NDKSigner` interface (nip44
  encrypt/decrypt).
- `NostrConnectQR.tsx` creates a throwaway `NDKPrivateKeySigner.generate()` for
  the NIP-46 handshake.
- The NIP-46 local session key is persisted **unencrypted**
  (`auth.ts:68` and `auth.ts:466`).
- 11 tests cover NIP-46 auth in `src/lib/__tests__/auth-nip46.test.ts`.
- Server-side `EventSigner.ts` is already NDK-free (pure `nostr-tools`
  `finalizeEvent`) and is unaffected by this ADR.

## Decision

Adopt `applesauce-signers` ≥ 6.2 as the app's signer package. The unified
target stack is `@cashu/coco-core` (Cashu) + `applesauce-signers` (nostr
signing) + `nostr-tools` (shared `nip19`/`nip44`/`finalizeEvent` layer). NDK
drops entirely.

Unification is **not** via Cashu: since Cashu libraries cannot sign nostr
events, the signer seat belongs to `applesauce-signers` and the wallet seat to
`coco-core`, with `nostr-tools` shared underneath both.

### Locked decisions

- `applesauce-signers` ≥ 6.2 (6.2.2 audited). Prerequisite:
  `applesauce-core` ^6.2.0 — the repo currently pins ^5.2.0; that upgrade is
  already in flight as task B.2 and must land first.
- `nostr-tools` is retained as the shared event/nip19/nip44 layer. It is not
  replaced by this ADR; `applesauce-signers` interoperates with raw
  `nostr-tools` events.
- The three NDK-internal hacks (above) become inapplicable: they are deleted,
  not ported.
- The 11 NIP-46 tests in `src/lib/__tests__/auth-nip46.test.ts` are ported to
  the new signer, not deleted. Coverage must not regress.
- NIP-46 recovery semantics (reconnect, unreachable bunker, session resume)
  must be re-tested against `NostrConnectSigner`; NDK-era recovery behavior is
  not assumed to carry over.

### Login path mapping

| Login path       | Current (NDK)                             | Target (applesauce-signers)                         |
| ---------------- | ----------------------------------------- | --------------------------------------------------- |
| NIP-46 bunker    | `NDKNip46Signer` (`auth.ts:436`)          | `NostrConnectSigner`                                |
| NIP-07 extension | `NDKNip07Signer` (`auth.ts:396`)          | `ExtensionSigner`                                   |
| nsec raw key     | `NDKPrivateKeySigner` (`auth.ts:346`)     | `PrivateKeySigner`                                  |
| NIP-49 ncryptsec | `nip49.decrypt` → raw-key (`auth.ts:288`) | `PasswordSigner` (`fromNcryptsec`, `unlock`/`lock`) |

`NostrConnectQR.tsx`'s throwaway key moves from `NDKPrivateKeySigner.generate()`
to `PrivateKeySigner.generate()`.

`PasswordSigner` becomes the NIP-49 model: the ncryptsec stays encrypted at
rest, the signer holds the passphrase-derived key only between `unlock()` and
`lock()`, and the app never materializes a persistent raw key for NIP-49 users.

### Session persistence and security

`NostrConnectSigner` persists NIP-46 sessions as nbunksec strings
(`encodeNbunksec`). **nbunksec is an encoding, not encryption** — anyone with
the stored string can resume the session.

This forces an explicit decision on the session key currently persisted
unencrypted (`auth.ts:68`, `auth.ts:466`): either encrypt the stored session
secret (PasswordSigner-style encryption, applied before persistence) or accept
the risk in writing. This ADR records the option and the requirement that the
choice be explicit; the concrete mechanism is decided in the Wave A3b
implementation. Encrypted session keys are the intended security improvement
over the status quo.

### Sequencing

- **Wave A3 — NIP-07 + nsec (mechanical).** Swap `NDKNip07Signer` →
  `ExtensionSigner` and `NDKPrivateKeySigner` → `PrivateKeySigner`, wire
  `sign()` in `io-applesauce.ts`, and move `src/lib/nip59.ts` off NDK's
  extended `NDKSigner` interface onto `nostr-tools` nip44 directly. Low-risk,
  behavior-preserving.
- **Wave A3b — NIP-46 (port tests).** Swap `NDKNip46Signer` →
  `NostrConnectSigner`, port the 11 NIP-46 tests, re-test recovery semantics,
  and implement the session-persistence decision above. Wave D (NDK singleton
  deletion) remains gated on A3b per ADR-0002.

### Bus factor

`hzrd149` is the sole maintainer of all applesauce packages. This is an
accepted risk, consistent with ADR-0002's implicit acceptance for relay I/O.
Mitigations: the signer surface is small and MIT-licensed, `nostr-tools`
remains the shared event layer as an escape hatch, and the package is in
active use across the applesauce ecosystem.

## Consequences

Positive:

- All four login paths map 1:1 onto audited classes; no custom signer code.
- NDK drops entirely (Wave D unblocked), removing a stale dependency and its
  `shiki`/`sandpack-client` baggage.
- Three NDK-internal hacks are deleted instead of ported.
- NIP-49 users gain a proper unlock/lock model instead of a decrypted raw key.
- Persisted NIP-46 session keys gain an encryption option they do not have
  today.
- Server-side signing is already NDK-free and unaffected.

Negative / tradeoffs:

- Requires `applesauce-core` ^6.2.0 (upgrade in flight as task B.2).
- Bus factor of one on the applesauce ecosystem (accepted, see above).
- 11 NIP-46 tests must be ported — real work, though coverage-preserving.
- NIP-46 recovery semantics must be re-validated, not assumed.
- The session-key encryption mechanism is decided later (Wave A3b), so this ADR
  mandates an explicit decision rather than specifying the mechanism.

## References

- ADR-0002: `ADR-0002-nostr-io-migration-ndk-to-applesauce.md`
- ADR-0017: `ADR-0017-cashu-wallet-dependency-stack.md`
- `applesauce-signers` on npm (6.2.2, 2026-07-01, hzrd149)
- Signer audit notes, 2026-08-27 (tarball + live npm verification)
