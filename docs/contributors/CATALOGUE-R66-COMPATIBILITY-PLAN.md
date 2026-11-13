# Catalogue candidate compatibility with deployed R66

This is a local preparation record. It does not authorize deployment, service
restart, payment mutation, policy activation, or changes to live browser state.

## Exact inputs

The R66 and readiness pins below were verified read-only in a separate clean
recovery worktree, represented here as `<R66-recovery-worktree>`.
They are external provenance inputs and are not objects in this candidate
repository. Reproduce their subjects and diffs with
`git -C <recovery-worktree> show <commit>` before any later reconciliation.

- Deployed release source pin: `7d773d6c697a3807b0b1162bd775a6e3a191202b`
  (`deploy(auctions): pin R66 immediate identity UI`).
- R66 identity serialization: `edb226fe35264888e39c7c09c51b1b0ce417d67e`
  plus immediate busy-state update `8e51a98d4f46b6ea42cfe3dbadb0d1069e6506fa`.
- Recovery-track readiness regression: `d19ec6e6c6a07fdc51c474a14025dd057adcba59`.
- R66 guard pins `plebeian-auctions-mvp` to 46,637,416 bytes and SHA-256
  `ca7c71ce73aff5c227aeaad1ab36c153b180923a4d06f8b22a8625f18c688b87`.
- Catalogue compatibility work starts from candidate
  `f391b077c07baf7c4ab5d7f2465fd3f6f502e2d6`; it must receive a new release
  identity and must not reuse or overwrite the R66 site artifact or guard.

## Preserved behavior

1. A temporary `/api/config` or release-pin transport failure disables every
   new operation but preserves the current actor, signer, controller, and
   generation for exact recovery.
2. The scheduled four-second refresh restores controls only after readiness
   and a fresh committed public-state read both succeed.
3. Recovery does not invoke NIP-07 again, create another controller, or replace
   the identity.
4. Repeated or mixed identity clicks share one in-flight installation. Both
   identity buttons show the busy state immediately and recover after failure.
5. Release-pin or deployment-identity drift still invalidates the controller;
   transport recovery must never weaken that fail-closed boundary.

## Local gates

Run against the final candidate commit and exact embedded assets:

1. `node internal/poc/hlt_readiness_ui.test.js`.
2. Every `internal/poc/*test.js` UI suite, including stable-pointer,
   queued-bid, exact-return, payout-status, and public-state failure coverage.
3. Offline `go test ./...` with Go 1.23.1.
4. Two `go build -trimpath -buildvcs=false` builds; require byte identity and
   update the inactive candidate manifest with the exact site and `app.js`
   hashes.
5. Re-run the real-browser held-pointer test and add an isolated real-browser
   double-click/mixed-identity test against the exact final hash.
6. Before joint fake-sats acceptance, compare read-only R66 responses for
   `/api/config`, `/api/browser-release-pins`, `/api/state`, and
   `/api/validators` with the candidate's strict parsers. Do not mutate live
   state during this comparison.

## Inactive release and rollback boundary

- Stage only in a new inactive release directory with a new exact guard.
- Preserve the current R66 environment and one-hour auction policy. The
  separately prepared seven-day policy remains inactive and requires its own
  approved deployment identity and coordinated payment-deadline rollout.
- Run fresh fake-sats acceptance for connect, bid, outbid return, deterministic
  close, winner declaration, and seller payout before any activation.
- Rollback means restoring the exact R66 service unit and the guarded
  `ca7c71ce...8b87` site binary; no browser/payment state may be cleared merely
  to make rollback appear successful.

## Remaining live evidence

The local regressions prove client behavior under deterministic stubs. They do
not prove current R66 endpoint bytes, a live service transition, or end-to-end
winner/settlement behavior. Those remain explicit acceptance gates.
