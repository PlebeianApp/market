# Handover: NIP-46 remote signer identity separation (PR #1199)

## Summary

PR #1199 (`fix/remote-signer-login`) adds NIP-46 remote signer login support
(QR `nostrconnect://` and `bunker://` URL flows) while keeping the remote
signer endpoint pubkey distinct from the authenticated user pubkey.

## Key invariant

NIP-46 distinguishes two identities:

- **Remote signer pubkey** — the author of NIP-46 response events and the
  `bunker://` endpoint. This is a NIP-46 _communication_ endpoint only.
- **User pubkey** — the account identity resolved via the `get_public_key`
  RPC method. This is the identity that is persisted, installed in
  `authStore.user`, and used for user-scoped cart reconciliation.

The remote signer pubkey must **never** substitute for the unresolved user
identity. The timeout fallback in `completeNip46LoginHandshake` resolves the
actual user via `get_public_key` with a bounded, fail-closed recovery
(`recoverNip46UserPubkey`). A previously persisted user pubkey is accepted as
an expected-identity continuity check, but the bunker key is not a valid
candidate.

## Files

- `src/lib/stores/auth.ts` — handshake, recovery, persistence, logout.
- `src/lib/nostr/nip46.ts` — URL builders and the approved-signer response gate.
- `src/components/auth/NostrConnectQR.tsx` — QR handshake and signer approval.
- `e2e/utils/nip46-mock.ts` — remote signer mock (distinct signer/user keypairs).
- `e2e/tests/auth.spec.ts` — QR and bunker/timeout regression coverage.
- `src/lib/__tests__/auth-nip46.test.ts` — unit coverage for the handshake.

## Behavior notes

- `recoverNip46UserPubkey` clears `signer.userPubkey` before calling
  `get_public_key` so NDK does not short-circuit with the unverified bunker
  value, then restores it on failure.
- The QR flow only approves a signer after a `connect` request carrying the
  temp secret is observed (`approvedSignerPubkeys` gate in
  `isApprovedNostrConnectResponse`).
- `logout()` clears `NOSTR_USER_PUBKEY` along with the other auth keys.
- The `_user` private-field write on `NDKNip46Signer` is guarded by the NDK
  3.0.3 pin; see the comment in `cacheResolvedNip46User` before upgrading NDK.

## Verification

- `bun run test:unit` — 366 pass / 0 fail.
- `bun x tsc --noEmit` — 224 errors, equal to the `master` baseline.
- `bun run format:check` — clean.
- Focused `auth-nip46.test.ts` — 19 pass / 0 fail.
