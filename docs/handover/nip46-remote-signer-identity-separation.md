# Handover: NIP-46 remote signer identity separation

Introduced by PR #1290 (supersedes #1199).

## Summary

NIP-46 remote signer login supports two entry points (QR `nostrconnect://` and
`bunker://` URL paste) and a timeout-fallback recovery path. The critical
invariant enforced by the fix is that the **remote-signer pubkey** (the author
of NIP-46 response events and the `bunker://` endpoint) must never substitute
for the **user pubkey** (the account identity resolved via the `get_public_key`
RPC method).

PR #1199 introduced the NIP-46 remote signer infrastructure but had a blocking
vulnerability (maximotodev, BLOCK #1): the timeout fallback in
`completeNip46LoginHandshake` included `signer.userPubkey` (the remote signer
endpoint) in the set of expected user pubkeys. On a fresh login with no
persisted identity, `get_public_key` returns the real user key — which differs
from the bunker key — and the mismatch check incorrectly rejected the login,
while an attacker controlling the remote signer endpoint could return a forged
user key and have it accepted as matching the bunker key.

PR #1290 fixes this by removing the bunker pubkey from the expected-identity
set entirely: only the explicitly-provided `expectedUserPubkey` (persisted
from a prior login) is a valid identity expectation.

## Key invariant

The remote-signer pubkey is a NIP-46 **communication endpoint** only. The
user pubkey is the account identity resolved via `get_public_key`. These two
values are never the same value in any authoritative decision path.

Concretely, in the timeout-fallback recovery (`recoverNip46UserPubkey`):

1. `signer.userPubkey` (the bunker endpoint's key) is cleared before calling
   `get_public_key` so NDK does not short-circuit with the unverified value.
2. The `expectedPubkeys` set contains **only** the explicit
   `expectedUserPubkey` param — never `signer.userPubkey`.
3. On failure, `signer.userPubkey` is restored so the signer remains in the
   state recovery found it.

## Code patterns (auth.ts, final state at PR #1290 head 272839a4)

### Pattern A: recoverNip46UserPubkey

```
signer: NDKNip46Signer,
expectedUserPubkey: string | undefined
```

- Line 119: `configuredUserPubkey = signer.userPubkey` — read but **not** added to expected set.
- Line 120: `expectedPubkeys = new Set([expectedUserPubkey].filter(Boolean))` — only the explicit param.
- Line 129: `signer.userPubkey = undefined` — prevent NDK short-circuit.
- Line 132: `Promise.race([signer.getPublicKey(), timeoutPromise])` — bounded RPC call.
- Line 139: hex validation, mismatch check against `expectedPubkeys` only.
- Lines 150–153: restore `signer.userPubkey` on failure.

### Pattern B: cacheResolvedNip46User (NDK 3.0.3 workaround)

NDKNip46Signer exposes no public setter for the user it caches during
`blockUntilReady()`. The workaround casts `_user` directly:

```
;(signer as unknown as { _user?: NDKUser })._user = user
```

This is safe because the value was verified by `get_public_key`, but it pins
NDK to 3.0.3. Documented tech debt.

### Pattern C: Listener cleanup on all paths

`cancelNip46HandshakeListeners` runs in a `finally` block (success, timeout,
error, mismatch). Late-resolving listeners from `blockUntilReady` are guarded
by `if (recoveryInProgress) return` to avoid removing in-flight recovery
listeners.

### Pattern D: isAuthenticated after signer setup

`await ndkActions.setSigner(authenticatedSigner)` resolves **before**
`authStore.setState({ isAuthenticated: true })`.

### Pattern E: Logout clears all identity

Five localStorage keys cleared, including `NOSTR_USER_PUBKEY`:
`nostr_local_signer_key`, `nostr_connect_url`,
`nostr_local_encrypted_signer_key`, `nostr_auto_login`, `nostr_user_pubkey`.

### Pattern F: Storage consistency

All auth storage access routes through a single `getAuthStorage()` function
(try/catch for privacy-restricted contexts). `logout`, `bootstrap`,
`persistAuthenticatedLoginState`, `decryptAndLogin`, `loginWithPrivateKey`,
`loginWithExtension`, `loginWithNip46`, and `getNeedsMigration` all use it.

## Migration pattern for PR #1252 (Signer migration to applesauce-signers)

PR #1252 replaces NDK signers (`NDKNip46Signer`, `NDKPrivateKeySigner`,
`NDKNip07Signer`) with applesauce-signers (`NostrConnectSigner`,
`PrivateKeySigner`, `ExtensionSigner`, `PasswordSigner`). The ADR-0002
amendment already specifies Invariant I2 ("Remote signer ≠ authenticated
user"), but PR #1290 is the first implementation that makes this invariant
actually hold in code against the timeout-fallback path. When #1252 rewrites
the signer layer, the following patterns must be preserved or reimplemented
against the applesauce signer API:

### Must preserve

| # | Pattern from #1290 | Applesauce equivalent / guidance |
|---|-------------------|----------------------------------|
| 1 | **Identity separation (Pattern A):** `recoverNip46UserPubkey` only accepts explicitly-provided `expectedUserPubkey`. The remote signer's own pubkey is never a user-identity candidate. | `NostrConnectSigner` resolves user via `connect` RPC. The `get_public_key` call must be the **sole** source of user identity. The `clientPubkey` (bunker endpoint) must never pass a user-identity validation gate. Regression: the mock with distinct signer/user keypairs must succeed on the timeout path. |
| 2 | **Fail-closed timeout (Pattern A):** `get_public_key` timeout or mismatch returns `null` — login fails closed. The signer state is restored. | `NostrConnectSigner.connect` must have a bounded timeout equivalent. If `get_public_key` (or applesauce's user-resolution mechanism) fails, hangs, or returns a pubkey not matching `expectedUserPubkey`, the login must fail closed without persisting any session state. |
| 3 | **`_user` cache replacement (Pattern B):** The NDK `_user` cast is a tech debt workaround. #1252 must provide a proper public cache/setter so the resolved user (from `get_public_key`) is available without re-connecting. | `NostrConnectSigner` or a wrapper must cache the resolved user identity and expose it via a stable public API. No private-field casts. |
| 4 | **All-paths listener cleanup (Pattern C):** `cancelNip46HandshakeListeners` runs in `finally` on success, timeout, error, and mismatch. Late resolution is guarded. | The applesauce signer's subscription or event listener infrastructure must have equivalent cleanup on every exit path. Test that no listeners leak after incomplete handshakes. |
| 5 | **isAuthenticated ordering (Pattern D):** `await setSigner` before the auth flag. | After `NostrConnectSigner.connect` resolves and the signer is installed, set the auth flag. Never set `isAuthenticated: true` before the signer is fully wired. |
| 6 | **Logout completeness (Pattern E):** All five auth keys cleared, including `NOSTR_USER_PUBKEY`. | #1252's vault+legacy key cleanup must include the same scope. The `nostr_user_pubkey` key must be removed on logout. |
| 7 | **Storage consistency (Pattern F):** Single `getAuthStorage()` for all auth I/O. | #1252's session vault replaces direct localStorage access. Ensure a single seam for all auth storage operations, with the same try/catch guard. |
| 8 | **Regression coverage:** The `Nip46Mock` with distinct `remoteSignerSk`/`userSk` keypairs must exercise the timeout-fallback path. | #1252 must preserve the e2e tests that assert `nostr_user_pubkey === mock.userPk` and `mock.pk !== mock.userPk` on the timeout-recovery path (auth.spec.ts L453, L522). The mock's `get_public_key` handler must continue returning `this.userPk`, not `this.pk`. |

### ADR-0002 amendment cross-reference

ADR-0002's Amendment (2026-09) lists I2 as an executable invariant. That
invariant was **first verified in code** by PR #1290. The assertion of I2
("PR #1199 is not an input dependency") should be read with the update:
PR #1290 supplies the regression tests and the fail-closed recovery
implementation that validates I2 against the timeout-fallback path. #1252
must carry forward that same regression scope.

## Files

- `src/lib/stores/auth.ts` — handshake, recovery, persistence, logout.
- `src/lib/nostr/nip46.ts` — URL builders and the approved-signer response gate.
- `src/components/auth/NostrConnectQR.tsx` — QR handshake and signer approval.
- `e2e/utils/nip46-mock.ts` — remote signer mock (distinct signer/user keypairs).
- `e2e/tests/auth.spec.ts` — QR and bunker/timeout regression coverage.
- `src/lib/__tests__/auth-nip46.test.ts` — unit coverage for the handshake.

## Verification

- `bun run test:unit` — 366 pass / 0 fail.
- `bun run format:check` — clean.
- E2E: QR login with distinct keys, QR timeout with distinct keys, bunker
  connect, bunker timeout with distinct keys, secretless + auth challenge,
  javascript: rejection.