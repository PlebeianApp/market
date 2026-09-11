# ADR-002: Strangler-Fig Pattern for Nostr I/O Migration (NDK → Applesauce)

## Status

Accepted

## Date

2026-07-03

## Related

- Migration wave roadmap: contained in this ADR
- Upstream epic: `PlebeianApp/market#1005`
- Supersedes no prior ADR

## Context

Runtime relay I/O coupling through @nostr-dev-kit (NDK) introduces behavioral
and privacy risks:

- NDK keeps background WebSocket connections alive, which can prevent Node.js
  from exiting cleanly in local and CI test runs.
- NDK's outbox model can discover and connect to additional public relays,
  leaking test or development traffic outside the intended relay set.
- The current runtime carries fetch-timeout workarounds for hanging fetch
  paths. Those workarounds mask timing bugs instead of removing the root
  cause.
- The e2e harness already avoids NDK in several helper paths. The remaining
  reliability risk is the application's runtime subscribe, fetch, publish,
  auth, and signer paths.

Applesauce uses raw `nostr-tools` events natively rather than an `NDKEvent`
wrapper class. That means the migration should not require a broad event-shape
rewrite. The main task is redirecting where relay I/O lands while keeping Nostr
event validation, authorship, signing, relay targeting, and payment/order
workflow boundaries explicit.

Replacing NDK wholesale carries unacceptable regression risk across marketplace,
payment, and order flows. We require incremental replacement with atomic
rollback capability and continuous test validation throughout the migration.

## Decision

Adopt Martin Fowler's strangler-fig pattern: plant applesauce-backed I/O
next to existing NDK, hide both behind a library-agnostic port, and migrate
callers module-by-module with automated gates.

### Locked decisions

- Scope is app-first. Server runtime migration is separate Wave E work.
- Unit tests and relevant e2e tests are the reliability gates. Root-cause waves
  must preserve test assertions while reducing NDK-backed runtime I/O.
- PRs are stacked by wave, reviewed and merged bottom-up.
- Non-overlapping modules migrate before known auctions conflict-zone files.
- NIP-07 and nsec auth migration is deferred to Wave A3.
- NIP-46 bunker inner rewrite is deferred to Wave A3b. Wave D is gated on A3b
  because deleting the NDK singleton before the signer path is ready would
  collapse auth and signer boundaries.

### Port contract

```
interface NostrIo {
  fetchEvents(filter, opts?): Promise<NostrEvent[]>
  subscribe(filter, onEvent, opts?): () => void
  publish(event, opts?): Promise<void>
  sign(template): Promise<NostrEvent>
  getUser(): Promise<NostrUser | null>
}
```

All events pass as raw `nostr-tools` objects. Adapters translate wrapper
classes internally so callers never depend on NDK or applesauce types
directly.

### Adapter stack

- `src/lib/nostr/io.ts` — the Port interface and pass-through exports.
  Active adapter is selected via `setNostrIo()` and defaults to the NDK
  bridge.
- `src/lib/nostr/io-ndk.ts` — temporary bridge over the existing NDK
  singleton. This is the default adapter during the migration and is
  deleted in Wave D.
- `src/lib/nostr/io-applesauce.ts` — destination adapter using
  `applesauce-relay`'s `RelayPool`.

### Two-step flip per module

1. **Route through the seam (zero behavior change).** A module stops
   calling `ndkActions` directly and calls `fetchEvents`, `subscribe`,
   `publish`, `sign`, or `getUser` from `io.ts` instead. The active adapter
   is still NDK. Tests stay green.
2. **Flip to applesauce.** Tests gate it. If something breaks, flip that
   one module back — one revert, no collateral.

### Wave strategy

Stacked PRs branching upward: `master ← wave0 ← waveA ← waveB ← waveC ←
waveD ← waveE`. Only the bottom of the stack is non-draft at a time. Merge
proceeds bottom-up with rebasing. CI is cumulative per PR.

Auth and signer paths are deferred: NIP-07 and nsec migrate in Wave A3;
the NIP-46 bunker inner rewrite is Wave A3b and gates Wave D.

#### Wave roadmap

**Wave 0: Foundation**

- Promote applesauce packages to direct dependencies for explicit runtime
  ownership.
- Add the `src/lib/nostr/io.ts` seam.
- Add `src/lib/nostr/io-ndk.ts` as the temporary NDK bridge and default
  adapter.
- Add `src/lib/nostr/io-applesauce.ts` as the destination adapter.
- Add the CI NDK-footprint guard and baseline.
- Add this ADR and matching AGENTS guidance so future relay I/O routes through
  the seam. NDK remains the default adapter.

**Wave A: Root-cause, no auctions overlap**

- A1: NIP-17/59 pilot for private order messaging. This excludes
  `src/publish/orders.tsx`.
- A2: Read paths for products, collections, shipping, profile, comments,
  reactions, value-for-value, blacklist, relay-list, orders, and wallet.
- A3: Auth for NIP-07 and nsec.
- A3b: NIP-46 bunker inner rewrite. This gates Wave D.
- A4: Non-conflicting publish modules, excluding the Wave C conflict-zone
  files.

**Wave B: Type-only cleanup**

- Replace type-only `NDKEvent` imports with raw `nostr-tools` event types.
- Keep this wave behavior-neutral; it is cleanup, not a reliability claim.

**Wave C: Conflict-zone files**

- `src/publish/orders.tsx`.
- `src/publish/featured.tsx`.
- `src/routes/_dashboard-layout/dashboard/index.tsx`.
- `src/lib/stores/nip60.ts` is handed to the auctions team instead of being
  migrated in this stack.

**Wave D: Capstone**

- After A3b lands, flip the remaining singleton path to applesauce.
- Delete the NDK singleton and `src/lib/nostr/io-ndk.ts`.
- Remove `@nostr-dev-kit/ndk` when unused.
- Ratchet the NDK-footprint baseline to zero or retire the guard once the
  footprint is actually gone.

**Wave E: Server runtime**

- Migrate `src/server/*` separately.
- Gate this work with integration tests. It is not expected to change
  marketplace e2e flakiness directly.

Root-cause flakiness work is concentrated in Wave A, Wave C publish files,
and Wave D. Wave 0, Wave B, the dashboard type-only work, and Wave E are
enablers or cleanup unless later code review shows otherwise.

#### Auctions coordination

The known overlap files between this migration and auctions work are:

- `src/lib/stores/nip60.ts`
- `src/publish/featured.tsx`
- `src/publish/orders.tsx`
- `src/routes/_dashboard-layout/dashboard/index.tsx`

`src/lib/stores/nip60.ts` belongs to the auctions team for migration planning.
Wave C stays at the top of the stack and merges later so auctions-related work
can land first without forcing broad rebases through the lower waves.

#### Stacking and merge mechanics

```
master ← wave0 ← waveA ← waveB ← waveC ← waveD ← waveE
```

- Each wave branch targets its predecessor.
- Only the bottom unmerged wave should be non-draft.
- Merge proceeds bottom-up.
- After a lower wave merges, rebase the higher waves onto the new base before
  promoting the next wave for review.
- CI is cumulative per PR because each higher wave includes the lower waves
  beneath it.

#### Verification gates

Every wave must pass:

- `bun run test:unit`
- `bun run format:check`
- NDK-footprint guard (`scripts/check-ndk-footprint.sh`)

Root-cause waves must also repeatedly run the relevant e2e spec locally and in
CI, with assertions unchanged. When a wave lowers the NDK footprint, lower
`scripts/ndk-baseline.txt` in the same PR so the guard ratchets downward.

### NDK footprint guard

A CI guard (`scripts/check-ndk-footprint.sh`, baseline
`scripts/ndk-baseline.txt`) fails if the number of source files importing
`@nostr-dev-kit` increases. When a wave reduces the footprint, the
baseline is lowered in the same PR so the guard ratchets downward.

## Consequences

Positive:

- Flaw isolation: a breaking change affects one wave or module while the
  rest of the app remains stable.
- Continuous CI gating detects regressions per wave.
- Nostr event types remain `nostr-tools` raw events throughout; no wrapper
  class migration is needed for event shapes.
- Final cleanup (Wave D) deletes the NDK singleton and drops
  `@nostr-dev-kit/ndk` from dependencies.

Negative / tradeoffs:

- The migration spans multiple PRs over an extended period. The NDK
  bridge and applesauce adapter coexist until Wave D.
- `io-applesauce.ts` mirrors relay configuration from the NDK store
  temporarily. This coupling goes away when the NDK singleton is deleted.
- `sign` on the applesauce adapter is intentionally not wired until Wave
  A3. Callers needing signing route through the NDK bridge until then.
- Publish modules still need per-module migration review even when the seam
  can carry relay-targeting options; Wave A4 and Wave C define the publish
  rollout boundaries.

## References

- Upstream epic: `PlebeianApp/market#1005`
- Martin Fowler, "StranglerFig":
  https://martinfowler.com/bliki/StranglerFigApplication.html

## Amendment (2026-09): Signer migration to applesauce-signers

Waves A3 (NIP-07 + nsec) and A3b (NIP-46) of this ADR — the deferred signer seat — are specified and implemented by this migration. The signer-migration draft was numbered `ADR-0022`, then renumbered `ADR-0008`, and was never merged as a standalone document: its decision is folded into this amendment, so neither number may be cited as an ADR (the index reserves 0008 for a different open conflict).

### Baseline: current `master` auth behavior

The migration contract is anchored to what `master` does today, characterized from source at `master` = `4cbe2b26` (2026-09-07) — not to the workarounds carried by PR #1199.

| Concern           | Current `master` behavior (source)                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login lanes       | `src/lib/stores/auth.ts`: nsec (`NDKPrivateKeySigner`), NIP-07 extension (`NDKNip07Signer`), NIP-46 bunker (`NDKNip46Signer(ndk, bunkerUrl, localSigner)`, the client key being an app-generated `NDKPrivateKeySigner`), and NIP-49 ncryptsec (`nostr-tools/nip49` `decrypt` → `NDKPrivateKeySigner`). |
| Boot / auto-login | `getAuthFromLocalStorageAndLogin` replays a stored NIP-46 session from **plaintext** `localStorage` (`nostr_local_signer_key` = client private key, `nostr_connect_key` = bunker URL); otherwise it prompts for the ncryptsec password, otherwise it attempts the extension.                           |
| NIP-46 connect    | The remote signer is pinned by the bunker URI; `blockUntilReady()` settles before the session is persisted, and the client key + bunker URL are written only after `signer.user()` resolves.                                                                                                           |
| Identity          | Resolved from the signer (`signer.user()`). The NIP-46 remote-signer pubkey and the authenticated user pubkey are separate values, and nothing asserts that a returned event was signed by the resolved user.                                                                                          |
| NIP-59 / NIP-44   | `src/lib/nostr/nip59.ts` checks `signer.encryptionEnabled('nip44')` before delegating, **and** has local-key helpers that encrypt/decrypt through `nip44.v2.utils.getConversationKey(<local private key>, …)` — today's module can therefore synthesise NIP-44 from a key the app holds.               |
| `nostrconnect://` | The client-initiated QR flow puts the generated secret on the non-standard `token` param and the QR peer channel accepts a connect reply whose `params.token` matches; the app-generated `bunker://` URI already uses `secret` (#807).                                                                 |

PR #1199 is **not an input dependency** of this migration: no implementation, test, or invariant here derives from its workarounds or from its test suite. It is retained only as a source of regression cases, and Wave A3b supersedes it.

### Executable invariants preserved through A3/A3b

Each invariant is protocol-faithful (NIP-46 / NIP-07 / NIP-59), derived from the characterized `master` behavior plus the protocol, and has an executable test at the **production seam** (not at a module-mocked seam). The migration may not regress them, and coverage must not fall below the characterized baseline.

- **I1 — The connect secret is validated before binding.** An unknown remote signer is never bound from a bare `ack`; the expected `secret` must validate first. (Implementation: `nostr-connect-signer.ts`. Tests: `nostr-connect-signer.test.ts` — "a bare \"ack\" never binds an unknown remote signer", "a wrong connect secret never binds the remote signer".)
- **I2 — Remote signer ≠ authenticated user.** The remote-signer pubkey stays separate from the authenticated user pubkey, which is learned only via `get_public_key` / `getPublicKey()`. (Tests: `nostr-connect-signer.test.ts` — "identity resolution is via getPublicKey() only — never clientPubkey"; `nip46-signer-capability.test.ts` — identity-collapse cases.)
- **I3 — Signed events are bound to the resolved user identity.** A returned signed event must be cryptographically valid **and** satisfy `event.pubkey === authenticatedUserPubkey`; a valid signature from a different key fails closed. (Tests: `nostr-connect-signer.test.ts` — "signEvent fails closed when the returned event pubkey differs from the authenticated user"; the `io-applesauce.ts` sign port.)
- **I4 — NIP-44 is capability-gated, never synthesised locally.** `SignerCapability.nip44` is optional: a NIP-07 extension without `window.nostr.nip44`, or a NIP-46 signer without the RPC, has no capability, and NIP-59 fails closed instead of falling back to local `nostr-tools` NIP-44 behind a user who never exposed a key. (Implementation: `signer-capability.ts`, `signer-registry.ts` `createExtensionSigner`, `nip59.ts` `signerSupportsNip44`. Tests: `extension-signer.test.ts` — "leaves nip04 and nip44 absent when the extension lacks them (fail closed)"; `nip59.test.ts`.) This is a deliberate behaviour change from `master`, whose NIP-59 module can encrypt with a locally held key.
- **I5 — Session secrets are never silently plaintext.** A persisted NIP-46 session is encrypted at rest in the vault; existing plaintext sessions are migrated to the vault or force an **intentional re-login**. Retaining plaintext bearer-capability storage is only ever a named maintainer risk-acceptance recorded against the open unencrypted-session-key finding (`#996` H8) — never a silent default. (Implementation: `session-vault.ts`, `stores/auth.ts`. Tests: `session-vault.test.ts`, `auth-session-vault-real-seam.test.ts`.)

### Decisions

- Adopt `applesauce-signers`, pinned exactly at `6.2.2` in `package.json`, for signing alongside the applesauce relay I/O already behind the io seam. `NostrConnectSigner` (NIP-46), `ExtensionSigner` (NIP-07), `PrivateKeySigner` (nsec), and `PasswordSigner` (NIP-49, ncryptsec encrypted at rest with `unlock`/`lock`) replace their NDK equivalents. Prerequisite met on `master`: `applesauce-core` / `applesauce-relay` 6.2.x landed via #1253 (2026-09-01). No NDK-internal workaround is ported; NDK still drops entirely and Wave D stays gated on A3b. `nostr-tools` remains the shared event/nip19/nip44 layer.
- All `applesauce-signers` imports live behind a signer registry inside `src/lib/nostr/`; stores and UI components never import it directly. The signer seat is a second, equally narrow exception to the `applesauce-*` import rule in `src/AGENTS.md` (relay I/O being the first), and that rule text is amended in this change rather than deferred.
- One app-owned signer capability seam (`getPublicKey`, `signEvent`, optional `nip44.encrypt`/`decrypt`) covers NIP-07, NIP-46, and local signers (I4). Local signers implement NIP-44 locally; NIP-07 and NIP-46 delegate it, so no path falls back to local NIP-44 behind a user who never exposed a key.
- The NIP-46 trust/identity chain is locked as invariants I1–I3, with negative coverage for the wrong secret, ack-only binding in the client-initiated flow, remote-signer/user separation, and a valid signature from the wrong user key.
- NIP-46 session persistence stores the **nbunksec**: the `Nbunksec` / `BunkerURI` session token (`createNbunksec` / `parseNbunksec`, consumed by `NostrConnectSigner.fromNbunksec`) that carries the client secret key and the bunker pointer. It is encrypted at rest (I5).
- Migration contract: characterize current `master` behavior as executable tests first, then swap per wave preserving those invariants; coverage must not regress below the baseline, and the e2e NIP-46 mock uses distinct remote-signer/user keypairs. Coverage is anchored to the production seam, not to module-mocked seams: a wave's restore/unlock path must be exercised non-mocked (e.g. the real `rehydrateNostrConnectSession` → `NostrConnectSigner` connect RPC), because a suite that mocks the seam cannot observe an unwired transport. The Authentication e2e family runs on every PR.

Related: unencrypted NIP-46 session key — open security finding `#996` H8.
