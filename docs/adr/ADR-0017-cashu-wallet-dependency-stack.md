# ADR-017: Cashu Wallet Dependency Stack — Migration to the @cashu/coco-core 2.0 Family

## Status

Proposed

Pending team call (wallet rebuild vs applesauce migration ordering) and
Amperstrand confirmation of coco 2.0 production readiness.

## Date

2026-08-27

## Related

- Wallet rebuild research handover (2026-08-27), decision D2; kanban `t_5b37e6d3`
- ADR-0002 — `@nostr-dev-kit/wallet` is NDK-coupled and conflicts with the
  applesauce migration direction
- ADR-0005 — mints are external services and must be mocked in tests
- Incident context: 2026-08-21 demo wallet audit (decision D1)

## Context

The bundled Cashu wallet (audited at `c827ad48` after the 2026-08-21 demo
incident) is built on an outdated dependency set:

- `coco-cashu-core` / `coco-cashu-indexeddb` pinned at `1.0.0-rc11` under the
  unscoped — now deprecated — package name.
- `@cashu/cashu-ts` pinned at `^2.1`, three majors behind upstream.
- `@nostr-dev-kit/wallet` at `1.0.0`, current but NDK-coupled, which
  conflicts with the ADR-0002 strangler-fig direction of removing NDK from
  runtime I/O.

Evidence from the npm registry, verified live on 2026-08-27 (registry
checks, not documentation claims):

| Package                          | Market pin              | Upstream state (verified 2026-08-27)                                                                                                                           |
| -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coco-cashu-core` / `-indexeddb` | `1.0.0-rc11` (unscoped) | `@cashu/coco-core` / `-indexeddb` / `-react` / `-sqlite` `2.0.0`, published 2026-08-17 under the `cashubtc` scope by callebtc, gandlaf21, robwoodgate, egge21m |
| `@cashu/cashu-ts`                | `^2.1`                  | latest stable dist-tag `4.9.0` (2026-08-16); `@cashu/coco-core@2.0.0` depends on `cashu-ts@5.0.0-rc.4`                                                         |
| `@nostr-dev-kit/wallet`          | `1.0.0`                 | current but NDK-coupled; to be replaced                                                                                                                        |

The coco project has graduated: the same codebase moved under the official
`@cashu/` scope with the full cashubtc maintainer team, and our pin is the
deprecated unscoped name.

Architecture of the target stack, verified from the published `package.json`
dependency chains:

```
App (web / phone)
  └── @cashu/coco-core      — state, storage adapters, lifecycle, event bus
        └── @cashu/cashu-ts — blind signatures, mint HTTP, NUT specs
              └── @noble/*, @scure/bip32
```

`cashu-ts` is the stateless protocol engine (crypto, mint HTTP calls, NUT
specs). coco is the stateful wallet framework on top of it. Platform storage
is provided by `@cashu/coco-indexeddb` (web) and `@cashu/coco-sqlite`
(phone).

## Decision

Adopt decision D2 from the wallet research handover:

- Build the wallet on `@cashu/coco-core@2.0.0` with `@cashu/coco-indexeddb`
  for the web app and `@cashu/coco-sqlite` for the phone app.
- Accept `cashu-ts` transitively (at `5.0.0-rc.4`); do not add a direct pin.
- Drop `@nostr-dev-kit/wallet`. Wallet code must not introduce new NDK
  coupling (ADR-0002 direction; the NDK footprint guard stays authoritative).
- Treat the migration as a rename from the unscoped `rc11` packages plus a
  breaking-change map covering the `rc11 → 2.0.0` coco jump and the
  transitive `cashu-ts 2.x → 5.0.0-rc` major jump. Tracked as kanban
  `t_5b37e6d3`.

### Adoption gates

This ADR is Proposed. Adoption is gated on:

- Amperstrand's confirmation that coco 2.0 is production-ready and that
  riding a cashu-ts v5 release candidate is safe to follow.
- A team call deciding ordering between the wallet rebuild epic and the
  applesauce migration waves.

Until those land, no dependency changes are made under this ADR.

### Test constraints

- Tests must not call live mints (ADR-0005). Restore and mint HTTP paths are
  mocked or intercepted in unit and e2e runs.
- Importing `@cashu/cashu-ts` for pure functions with no network calls
  remains allowed under ADR-0005's established patterns.

## Consequences

Positive:

- The wallet rides the officially maintained `@cashu/` scope, published by
  the full cashubtc team (callebtc, gandlaf21, robwoodgate, egge21m;
  releases 2026-08-16/17), instead of a deprecated unscoped rc.
- One stateful wallet framework with platform-appropriate storage adapters
  (IndexedDB on web, SQLite on phone) replaces bespoke persistence.
- Removing `@nostr-dev-kit/wallet` eliminates an NDK coupling the
  ADR-0002 footprint guard would otherwise have to carry or carve around.
- cashu-ts v4+ ships restore built-in (`BatchRestoreConfig` /
  `RestoreAllConfig`), which ADR-018's recovery path depends on; the
  current `^2.1` pin cannot provide it.

Negative / tradeoffs:

- Transitively adopting `cashu-ts@5.0.0-rc.4` puts a release candidate in
  production paths until v5 finalizes.
- The rename migration touches every coco import, and the transitive major
  jump adds breaking-change surface; scope is tracked separately
  (`t_5b37e6d3`).
- Until Amperstrand replies and the team call happens, the stack choice
  remains provisional.

## References

- npm packages (verified live 2026-08-27): `@cashu/coco-core`,
  `@cashu/coco-indexeddb`, `@cashu/coco-sqlite`, `@cashu/cashu-ts`
- coco repository: https://github.com/cashubtc/coco
- cashu-ts repository: https://github.com/cashubtc/cashu-ts
- Wallet rebuild research handover, 2026-08-27 (decision D2)
