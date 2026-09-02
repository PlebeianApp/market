# ADR-0008: Signer Migration to applesauce-signers

## Status

Proposed

## Date

2026-08-27 (revised 2026-09-01: reframed to the `master` baseline and renumbered 0022 → 0008, per PR #1252 review)

## Related

- ADR-0002 (Nostr I/O migration; Waves A3/A3b deferred the signer paths — this ADR specifies them)
- ADR-0010 (Cashu wallet; **Proposed via PR #1255**, file `ADR-0010-cashu-wallet-deps-recovery-sync.md`; shares the unified target stack — wallet seat only)
- Supersedes no prior ADR. Wave A3b supersedes the implementation approach of PR #1199 (see "Sequencing").

## Context

All four login paths sign through NDK signers, centered on `src/lib/stores/auth.ts`
(371 lines on current `master`):

| Login path       | Current implementation (`master`)                                    |
| ---------------- | -------------------------------------------------------------------- |
| NIP-46 bunker    | `NDKNip46Signer` (`auth.ts:250`)                                     |
| NIP-07 extension | `NDKNip07Signer` (`auth.ts:208`)                                     |
| nsec raw key     | `NDKPrivateKeySigner` (`auth.ts:158`)                                |
| NIP-49 ncryptsec | `nostr-tools` `nip49.decrypt` → raw key (`auth.ts:9`, `auth.ts:102`) |

### Signer-package findings (verified from package tarballs and live npm, 2026-09-01)

- `@nostr-dev-kit/ndk` (repo pins `3.0.3`, published 2026-02-23) is stale (~6 months
  for the pinned core release) and carries `shiki` and `@codesandbox/sandpack-client`
  as runtime dependencies. `nostr-tools` is a peer dependency of NDK, so removing NDK
  does not remove `nostr-tools`.
- `nostr-tools` is very active (latest 2.25.1, published 2026-08-30; ~2.65M
  downloads/week) and is already the shared event layer (repo pins `^2.23.3`).
- `applesauce-signers` (the package name — `@applesauce/signers` does not exist) at
  6.2.2 (2026-07-01, hzrd149) covers every current login path 1:1:
  `NostrConnectSigner` (NIP-46; session strings via `getNbunksec()` /
  `createNbunksec()`), `ExtensionSigner` (NIP-07, `window.nostr` proxy),
  `PrivateKeySigner` (raw key), `PasswordSigner` (NIP-49, `fromNcryptsec` +
  `unlock`/`lock`), plus `AmberClipboardSigner`, `ReadOnlySigner`, and
  `SerialPortSigner`. An `AndroidNativeSigner` exists but is deliberately **not
  exported** and requires the optional `nostr-signer-capacitor-plugin`.
- Cashu libraries **cannot sign nostr events**: `@cashu/coco-core` 2.0.0 (which depends
  on `@cashu/cashu-ts` 5.0.0-rc.4) and current `@cashu/cashu-ts` (latest 4.10.0) have
  zero nostr event-signing capability. The NUT-27 hypothesis is disproven for the TS
  libraries. (These are ADR-0010 _target-stack_ versions; the repo currently pins
  `@cashu/cashu-ts ^2.1` and `coco-cashu-core rc11`.)

### Baseline disclosure: this ADR's baseline is `master`, not PR #1199

An earlier draft of this ADR described the current state from open PR #1199
(`fix/remote-signer-login`) and cited its three NDK-internal workarounds — the `_user`
cache poke, the rpc listener strip, and the `userPubkey` clear-restore — as motivation.
**None of those three hacks exist on `master`; they are #1199-only.** Per review, this
ADR takes current `master` as its only baseline: none of the features or functionality
in #1199 are used within this ADR, and Wave A3b supersedes #1199 outright (see
"Sequencing"). #1199 is treated only as a source of regression cases. It is expected
to be closed, not merged.

### Current-state facts (all verified on `master`)

- `src/lib/nostr/io-applesauce.ts` `sign()` deliberately throws — "not wired until Wave
  A3". The io seam's `sign()` port (`src/lib/nostr/io.ts`) is the intended wiring point.
- `src/lib/nostr/nip59.ts` depends on NDK's extended `NDKSigner` interface: the
  `WithSigner` code paths delegate nip44 encrypt/decrypt to the signer
  (`encryptionEnabled`/`encrypt`/`decrypt`).
- `src/components/auth/NostrConnectQR.tsx` creates a throwaway
  `NDKPrivateKeySigner.generate()` for the NIP-46 handshake, and builds
  `nostrconnect://` URIs with a **non-spec `token` query param** (`:119`, matched at
  `:252`) where NIP-46 specifies `secret`.
- The NIP-46 local session key is persisted **unencrypted**:
  `localStorage.setItem(NOSTR_LOCAL_SIGNER_KEY, …)` at `auth.ts:266` (read at `:62`),
  alongside `nostr_connect_url` (`auth.ts:12`). Open security issue #996 (finding H8)
  tracks this.
- NIP-46 remote login is broken on `master` for real bunker signers (open issue #807,
  "Primal remote login", open since 2026-04-14); the non-spec `token` URI above is a
  contributing cause. Master's QR flow has a 5-minute UI timeout and no
  handshake-budget/recovery logic.
- Coverage on `master`: **16 e2e specs** in `e2e/tests/auth.spec.ts` plus **1** mock
  unit test (`src/lib/__tests__/nip46-mock.test.ts`). There are **zero** unit tests of
  `authActions`. (`src/lib/__tests__/auth-nip46.test.ts` — the 11/19 NIP-46 unit tests —
  does not exist on `master`; it exists only on unmerged #1199.)
- The e2e NIP-46 mock uses a single keypair for remote-signer and user
  (`new Nip46Mock(devUser2.sk)`), so `master`'s green e2e cannot detect
  remote-signer/user identity collapse.
- `authStore` state is typed `user: NDKUser | null`; 18 files under `src/` import or
  reference `NDKUser`.
- Server-side `src/server/EventSigner.ts` is already NDK-free at runtime (pure
  `nostr-tools` `finalizeEvent`) and is unaffected by this ADR.

## Decision

Adopt `applesauce-signers` ≥ 6.2 as the app's signer package. The unified target stack
is `@cashu/coco-core` (Cashu) + `applesauce-signers` (nostr signing) + `nostr-tools`
(shared `nip19`/`nip44`/`finalizeEvent` layer). NDK drops entirely.

Unification is **not** via Cashu: since Cashu libraries cannot sign nostr events, the
signer seat belongs to `applesauce-signers` and the wallet seat to `coco-core`, with
`nostr-tools` shared underneath both.

### Locked decisions

- `applesauce-signers` ≥ 6.2 (6.2.2 audited). Prerequisite met: `applesauce-core`
  `^6.2.0` / `applesauce-relay` `^6.2.0` landed on `master` via PR #1253 (merged
  2026-09-01); `applesauce-signers` 6.2.2 itself depends on `applesauce-core ^6.2.0`.
- `nostr-tools` is retained as the shared event/nip19/nip44 layer. It is not replaced
  by this ADR; `applesauce-signers` interoperates with raw `nostr-tools` events.
- **Migration contract (per review):** validate the current `master` implementation
  as e2e tests first — guaranteeing a working current version and surfacing any flaws —
  then migrate keeping all the tests working. What is ported is the _invariants_, not
  PR #1199: characterize current behavior, establish protocol-faithful executable
  invariants, and preserve those invariants through Waves A3/A3b. None of #1199's
  features or functionality are used.
- No NDK-internal workaround is ported, of any kind. The three hacks cited in the
  earlier draft are #1199-only and die with #1199.
- The coverage baseline is `master`'s: 16 e2e specs + 1 mock unit test. Coverage must
  not regress below it, and the e2e NIP-46 mock is upgraded to distinct
  remote-signer/user keypairs so identity-collapse regressions are detectable.
- NIP-46 recovery semantics (reconnect, unreachable bunker, session resume) must be
  re-tested against `NostrConnectSigner`; NDK-era recovery behavior is not assumed to
  carry over. Neither library imposes default request timeouts — handshake/recovery
  budgets are app-level code and are rebuilt at A3b, not inherited.

### Signer seam: where `applesauce-signers` imports live

All `applesauce-signers` imports live behind a **signer registry inside
`src/lib/nostr/`**. `src/lib/stores/auth.ts` and UI components do not import
`applesauce-signers` directly.

The standing rule in `src/AGENTS.md` (no new `@nostr-dev-kit` or `applesauce-*` imports;
route all Nostr relay I/O through `src/lib/nostr/io.ts`) **holds unchanged** — same
interpretation as the relay seat: `applesauce-*` imports are permitted only inside
`src/lib/nostr/`. This ADR requires **no AGENTS.md relaxation**.

`NostrConnectSigner` requires app-injected `subscriptionMethod`/`publishMethod`
(transport). These route through the app's **io seam** — the `applesauce-relay` pool
behind `src/lib/nostr/io.ts` — not NDK's internal pool. This is the migration's largest
NDK-visible behavioral difference and is Wave A3b's core wiring task.

### Login path mapping

| Login path       | Current (NDK, `master`)                   | Target (applesauce-signers)                         |
| ---------------- | ----------------------------------------- | --------------------------------------------------- |
| NIP-46 bunker    | `NDKNip46Signer` (`auth.ts:250`)          | `NostrConnectSigner`                                |
| NIP-07 extension | `NDKNip07Signer` (`auth.ts:208`)          | `ExtensionSigner`                                   |
| nsec raw key     | `NDKPrivateKeySigner` (`auth.ts:158`)     | `PrivateKeySigner`                                  |
| NIP-49 ncryptsec | `nip49.decrypt` → raw key (`auth.ts:102`) | `PasswordSigner` (`fromNcryptsec`, `unlock`/`lock`) |

`NostrConnectQR.tsx`'s throwaway key moves from `NDKPrivateKeySigner.generate()` to
`PrivateKeySigner.generate()`.

`PasswordSigner` becomes the NIP-49 model: the ncryptsec stays encrypted at rest, the
signer holds the passphrase-derived key only between `unlock()` and `lock()`, and the
app never materializes a persistent raw key for NIP-49 users.

### Hidden surfaces the migration must enumerate

1. **`NDKUser` decoupling.** `authStore`'s state is typed `user: NDKUser | null` and 18
   files under `src/` import or reference `NDKUser`. Applesauce signers have no
   `user()` method — the identity model moves to raw pubkeys and the io seam's
   `NostrUser`. Wave A3 must plan for this surface rather than discover it.
2. **Persisted-session compatibility.** Existing users' `nostr_local_signer_key` +
   `nostr_connect_url` (session-resume path `auth.ts:66`) must auto-login losslessly
   via `fromBunkerURI` or an equivalent; a forced re-login must be an explicit,
   documented choice, not an accident of the migration.
3. **`nip59` `WithSigner` paths.** NIP-46 users still sign via the old lane during the
   A3→A3b window, so the migration defines a remote nip44 delegation interface
   preserving gift-wrap/seal paths for remote signers. "Move to `nostr-tools` nip44
   directly" is behavior-preserving only for local keys in that window.

### Session persistence and security

`NostrConnectSigner` persists NIP-46 sessions as nbunksec strings (`getNbunksec()`).
**nbunksec is an encoding, not encryption** — anyone with the stored string can resume
the session (the client private key is in the clear).

Wave A3b therefore **requires encryption at rest** for the NIP-46 client secret /
nbunksec, matching open issue #996 (finding H8), whose prescribed fix is encryption at
rest. Plaintext persistence is permissible only as a **named maintainer risk-acceptance
recorded against #996** — not as an open-ended option. Encrypted session keys are the
intended security improvement over the status quo (`auth.ts:266` stores the raw key
today). Note #996 H8 also covers NWC wallet secrets, which this ADR does not touch.

### Sequencing

- **Wave A3 — NIP-07 + nsec (mechanical).** Swap `NDKNip07Signer` → `ExtensionSigner`
  and `NDKPrivateKeySigner` → `PrivateKeySigner` via the signer registry, wire `sign()`
  in `io-applesauce.ts`, and move `src/lib/nostr/nip59.ts` off NDK's extended
  `NDKSigner` interface onto `nostr-tools` nip44 directly for local keys (with the
  remote-delegation interface for NIP-46 users still on the old lane). Low-risk,
  behavior-preserving.
- **Wave A3b — NIP-46.** Swap `NDKNip46Signer` → `NostrConnectSigner` (registry +
  io-seam transport), fix the nostrconnect URI to spec (`secret`, not `token`),
  implement encrypted session persistence, keep all e2e specs green, and re-test
  recovery semantics. Wave D (NDK singleton deletion) remains gated on A3b per
  ADR-0002.
- **PR #1199 is superseded by Wave A3b.** #1199 is expected to be closed, not merged;
  none of its machinery is a prerequisite here, and its fix for #807 rides A3b. #807
  (open since 2026-04-14) is why A3b must be _scheduled_, not left open-ended: with
  NIP-46 on `master` broken for real bunker signers, A3b is the wave that deletes and
  replaces the broken handshake path.
- **Implementation timing: P2, after auctions** (maintainer direction, 2026-09-01).
  This ADR is a text-only decision record and does not advance implementation.

### Security test plan for Wave A3b

The A3b implementation must name and test the surviving security surfaces:

1. **Connect-secret/ack hijack exposure.** The `ack`/connect-secret match is accepted
   from an unpinned pubkey in _both_ `master`'s QR flow and
   `NostrConnectSigner.handleEvent`. A3b must re-adjudicate this class — not inherit
   it silently.
2. **Remote-signer ≠ user-pubkey identity separation.** Unit + e2e regression tests
   with distinct keypairs (`remoteSignerSk ≠ userSk`), per maximotodev's #1199
   standard; the e2e mock upgrade above is the vehicle.
3. **Response-signature verification.** Assert every remote response event is
   signature-verified (applesauce verifies in-signer; NDK-side verification depends on
   subscription config).
4. **nostrconnect URI conformance.** `secret`, not `token` (NIP-46) — the #807/Primal
   compatibility fix.

### Bus factor

`hzrd149` is the sole maintainer of all applesauce packages. This is an accepted risk,
consistent with ADR-0002's implicit acceptance for relay I/O. Mitigations: the signer
surface is small and MIT-licensed, `nostr-tools` remains the shared event layer as an
escape hatch, and the package is in active use across the applesauce ecosystem.

## Consequences

Positive:

- All four login paths map 1:1 onto audited classes; no custom signer code.
- NDK drops entirely (Wave D unblocked), removing a stale dependency and its
  `shiki`/`sandpack-client` baggage.
- NIP-49 users gain a proper unlock/lock model instead of a decrypted raw key.
- Persisted NIP-46 session keys gain mandatory encryption at rest (#996 H8).
- The `token` → `secret` nostrconnect URI fix lands together with the #807 fix.
- The baseline is honest: `master`'s actual coverage (16 e2e specs + 1 mock test) is
  the contract, and the single-keypair mock blind spot is fixed.
- The e2e-first migration contract guarantees a working current version before any
  signer swap.

Negative / tradeoffs:

- Bus factor of one on the applesauce ecosystem (accepted, see above).
- The e2e-first characterization pass is real work before any signer swap.
- NIP-46 recovery semantics must be re-validated, not assumed (no library-level
  timeouts; app-level budgets are rebuilt at A3b).
- The session-key encryption mechanism is decided at Wave A3b; this ADR mandates the
  encryption requirement, not the mechanism.
- `NDKUser` decoupling touches the 18-file identity surface during Wave A3.
- #807 stays open until A3b lands (implementation is P2, after auctions).

## References

- ADR-0002: `ADR-0002-nostr-io-migration-ndk-to-applesauce.md`
- ADR-0010 (Proposed, PR #1255): `ADR-0010-cashu-wallet-deps-recovery-sync.md`
- `applesauce-signers` on npm (6.2.2, 2026-07-01, hzrd149; depends on
  `applesauce-core ^6.2.0`)
- PR #1253 (applesauce-core/relay 5.2 → 6.2, merged 2026-09-01)
- Issue #807 (NIP-46 Primal remote login), Issue #996 (finding H8: unencrypted NIP-46
  session key), PR #1199 (superseded by Wave A3b)
- Package and npm facts in this ADR were verified 2026-09-01 from published tarballs
  and the npm registry.
