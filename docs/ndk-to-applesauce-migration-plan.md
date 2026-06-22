# NDK → Applesauce Migration Plan

> **Tracking:** Upstream epic lives under [`PlebeianApp/market#1005`](https://github.com/PlebeianApp/market/issues/1005).
> **Status:** Wave 0 (foundation) in progress. Worktree: `~/worktrees/ndk-to-applesauce` on branch `chore/applesauce-foundation`.

This document is the single source of truth for the migration. It captures every
decision, the architecture, the wave-by-wave roadmap, and a checklist for
tracking progress. It is mirrored into `AGENTS.md` (condensed) so the rules
persist across LLM sessions.

---

## 1. Why we're doing this

NDK is the root cause of our e2e test flakiness. Evidence:

- `e2e/ARCHITECTURE.md:1173` — NDK keeps WebSocket connections alive in the
  background, preventing Node.js from exiting (hung Playwright setup/seeding).
- `e2e/ARCHITECTURE.md:1239` — NDK's outbox model discovers and connects to
  extra relays, leaking test data to public relays.
- `src/lib/stores/ndk.ts:228` — `fetchEventsWithTimeout`, a race-timeout
  workaround that exists _because_ NDK fetches hang.

The e2e **harness** already fled NDK for `nostr-tools` (`e2e/scenarios`,
`e2e/utils/relay-query.ts`, etc.). The remaining flakiness is the **app's**
runtime NDK I/O (subscribe/fetch/publish races). Applesauce is already present
transitively (`applesauce-core@5.2.0`, `applesauce-relay@5.2.0` via
`@contextvm/sdk`) and — critically — uses **raw `nostr-tools` events natively**
(no `NDKEvent` wrapper class), so migrating is mostly about redirecting where
I/O calls land, not about changing event types.

Upstream issue [#1005](https://github.com/PlebeianApp/market/issues/1005)
(Franchovy) prescribes exactly the approach below: pilot applesauce on one flaky
section, verify e2e stabilizes without changing test assertions, then roll out.

---

## 2. How — the strangler-fig pattern

Named after the fig tree that grows _around_ a host tree and eventually replaces
it (Martin Fowler). We do **not** do a big-bang rewrite. We plant applesauce
_next to_ NDK, hide both behind a single small interface (the "seam"), and move
functionality from old → new one module at a time. When the last caller has
migrated, the old NDK tree is fully "strangled" and we delete it.

**The seam:** `src/lib/nostr/io.ts` defines a tiny _Port_ —

```ts
interface NostrIo {
	fetchEvents(filter, opts?): Promise<NostrEvent[]>
	subscribe(filter, onEvent, opts?): () => void // returns cleanup
	publish(event, opts?): Promise<void>
	sign(template): Promise<NostrEvent>
	getUser(): Promise<NostrUser | null>
}
```

Every event that flows through it is a raw `nostr-tools` event.

**Two adapters implement the Port:**

- `src/lib/nostr/io-ndk.ts` — a **temporary bridge** wrapping today's
  `ndkActions` singleton. This is the **default** adapter during the migration.
- `src/lib/nostr/io-applesauce.ts` — the **destination**, using
  `applesauce-relay`'s `RelayPool`.

**The two-step flip per module (this is the blast-radius containment):**

1. **Route through the seam (zero behavior change).** A module stops calling
   `ndkActions.fetchEvents(...)` and calls `fetchEvents(...)` from `io.ts`
   instead. The active adapter is still NDK. Tests stay green.
2. **Flip to applesauce.** Tests gate it. If something breaks, flip that one
   module back — one revert, no collateral.

Modules migrate independently; the auctions team keeps coding against `io.*` and
never notices what backs it.

---

## 3. Decisions (locked)

| Decision                | Choice                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**               | App-first; unit + e2e tests are the reliability gate                                                                                         |
| **Branching**           | One git worktree (`~/worktrees/ndk-to-applesauce`); one PR per wave                                                                          |
| **PR strategy**         | Stacked PRs against `PlebeianApp/market` `master`; only the bottom wave is non-draft at a time; merge bottom-up, rebase the stack            |
| **Merge target**        | `master` on `PlebeianApp/market` (push branch to fork `c03rad0r/market`, PR fork→upstream)                                                   |
| **Conflict-zone files** | Migrate non-overlapping modules first; isolate the 4 overlapping files into Wave C; `nip60.ts` handed to the auctions team                   |
| **Issue tracking**      | Single epic issue under #1005 with a checklist; per-wave issue created lazily when its PR goes ready-for-review                              |
| **Auth (NIP-46)**       | Defer NIP-46's inner rewrite to A3b; NIP-07/nsec migrate in A3. `io-applesauce.ts.sign` stays unwired until A3b. **Wave D is gated on A3b.** |

---

## 4. Wave roadmap

Legend: 🔥 = reduces test flakiness · ⚙️ = enabler (no direct flakiness win) ·
🧹 = type-only cleanup (no flakiness win) · ⚠️ = overlaps the auctions feature.

| Wave                         | Scope                                                                                                                                                                                                     | Flakiness  | Auctions            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------- |
| **0** Foundation             | promote applesauce deps; `io.ts` seam + `io-ndk`/`io-applesauce` adapters; CI NDK-footprint guard; this doc + AGENTS.md                                                                                   | ⚙️ enabler | none                |
| **A** Root-cause, no overlap | A1 NIP-17/59 pilot; A2 reads (products/collections/shipping/profile/comments/reactions/v4v/blacklist/relay-list/orders/wallet); A3 auth (NIP-07/nsec); **A3b** NIP-46; A4 non-conflicting publish modules | 🔥 yes     | none                |
| **B** Type-only cleanup      | the ~65 `import type { NDKEvent }` files → raw `Event`                                                                                                                                                    | 🧹 no      | none                |
| **C** Conflict zone          | C1 `publish/orders.tsx`; C2 `publish/featured.tsx`; C4 `dashboard/index.tsx`. **C3 `nip60.ts` → handed to auctions team**                                                                                 | 🔥 (C1/C2) | ⚠️ yes              |
| **D** Capstone               | flip `ndk.ts` to applesauce; delete NDK singleton + drop `@nostr-dev-kit/ndk`                                                                                                                             | 🔥 yes     | none (gated on A3b) |
| **E** Server runtime         | `src/server/*` — affects `test:integration` only, not e2e                                                                                                                                                 | 🧹 no      | none                |

**Root-cause accounting:** flakiness-reducing waves = **A, C1, C2, D**. Not
flakiness-related = **0, B, C4, E**.

---

## 5. Auctions coordination

Only **4 files** are on both the migration and the auctions feature roads:

- `src/lib/stores/nip60.ts` (NIP-60 cashu — heavy NDK) → **handed to auctions team**
- `src/publish/featured.tsx`
- `src/publish/orders.tsx`
- `src/routes/_dashboard-layout/dashboard/index.tsx` (type-only)

Verified (2026-06-22): none of the open auctions PRs (#1001, #1020, #1019)
currently touch these files, so there is **no active conflict** — coordination is
forward-looking. Wave C is at the top of the stack (drafts, merge last), so if
auctions lands first we simply rebase; small files, low conflict.

Coordination comments are posted on PRs **#1001** and **#1020** linking to the
epic.

---

## 6. Stacking & merge mechanics

```
master ← wave0 ← waveA ← waveB ← waveC ← waveD ← waveE
         (ready) (draft) (draft) (draft) (draft) (draft)
```

- Each branch's base is its **predecessor**; PR diffs are one wave only.
- Only the bottom of the stack is non-draft. When it merges, rebase the next
  onto `master` (collapses one level) and promote it to ready.
- Development never blocks: keep committing higher waves while lower ones review.
- CI is cumulative per PR (Wave B's CI runs with A+B applied).

Branch naming: `chore/applesauce-foundation` (Wave 0),
`feat/applesauce-wave-a`, etc.

---

## 7. Verification gates (per PR)

1. `bun run test:unit` green.
2. If root-cause: run the relevant `bun test:e2e -- <spec>` repeatedly (×5
   locally) + CI green on the fork PR; flakiness must drop, assertions unchanged.
3. `bun run format:check`.
4. NDK-footprint guard green (`scripts/check-ndk-footprint.sh`); lower the
   baseline in the same PR if footprint decreased.

---

## 8. Progress checklist

### Wave 0 — Foundation (⚙️)

- [x] Create worktree `~/worktrees/ndk-to-applesauce` on `chore/applesauce-foundation`
- [x] Promote `applesauce-core` / `applesauce-relay` to direct deps in `package.json`
- [x] Add seam: `src/lib/nostr/io.ts` + `io-ndk.ts` + `io-applesauce.ts`
- [x] Add unit test `src/lib/__tests__/io.test.ts` (5 tests, green)
- [x] Add CI guard `.github/workflows/ci-ndk-guard.yml` + `scripts/check-ndk-footprint.sh`
- [x] `test:unit` green (108 pass); new files typecheck clean
- [x] Write this plan doc
- [x] Append condensed ruleset to `AGENTS.md`
- [ ] File single epic upstream under #1005
- [ ] Post coordination comments on PRs #1001 + #1020
- [ ] Open Wave 0 PR (base: `PlebeianApp/market` master)
- [ ] Push Waves A–E as draft stack (opened lazily as each wave begins)

### Wave A — Root-cause, no auctions overlap (🔥)

- [ ] A1: NIP-17/NIP-59 private order messaging pilot (`lib/nostr/nip59.ts`, `lib/orders/privateOrderMessage.ts`, `components/orders/*`, `queries/__tests__/orders-private-details.test.ts`) — **excludes** `publish/orders.tsx`
- [ ] A2a: product reads (`queries/products.tsx`, `useStreamingProducts`, `useNotificationMonitor`)
- [ ] A2b: collections/shipping/profile/comments/reactions/v4v/blacklist/relay-list reads
- [ ] A2c: payment/zap reads + `queries/orders.tsx` / `queries/wallet.tsx`
- [ ] A3: auth — NIP-07 + nsec (`lib/stores/auth.ts`)
- [ ] A3b: NIP-46 bunker inner rewrite (**gates Wave D**)
- [ ] A4: publish modules not touched by auctions (`publish/{cart,collections,comments,migration,payment,products,profiles,reactions,relay-list,relay-preferences,shipping,wallet,app-settings,blacklist,nip89}.tsx`)

### Wave B — Type-only cleanup (🧹)

- [ ] B1–B3: ~65 `import type { NDKEvent }` files → raw nostr-tools `Event`

### Wave C — Conflict zone (⚠️, coordinate)

- [ ] C1: `publish/orders.tsx`
- [ ] C2: `publish/featured.tsx`
- [ ] C4: `dashboard/index.tsx` (type-only; bundle with C1 or C2)
- [ ] C3: `lib/stores/nip60.ts` — **handed to auctions team** (separate PR)

### Wave D — Capstone (🔥)

- [ ] Flip `lib/stores/ndk.ts` to applesauce; delete NDK singleton + `io-ndk.ts`
- [ ] Remove `@nostr-dev-kit/ndk` (and blossom/wallet/wot where unused) from `package.json`
- [ ] NDK-footprint guard: baseline → 0; retire the guard

### Wave E — Server runtime (🧹, integration tests only)

- [ ] E1: `src/server/*` (`NDKService.ts`, `EventHandler.ts`, `ZapPurchaseManager.ts`, managers)

---

## 9. Diagnosis & pilot retarget (2026-06-22)

A read-only diagnosis of where the e2e red actually lives **reframed the pilot**. Full
detail in [epic #1028 comment](https://github.com/PlebeianApp/market/issues/1028#issuecomment-4771481882).

**The e2e CI is deliberately gated (`e2e.yml`).**

- `e2e-pricing` (PR/push) runs **one** test (`--grep 'Product Page - View Only'`,
  line 108) → every PR "passes" e2e in ~2 min. PRs never run the failing specs.
- `e2e-full` (weekly cron + `workflow_dispatch` only, line 131) runs the rest — the
  34-min job that's currently **23 failed**. A separate "test-fix branch" owns it.

**The 4 failing specs, classified:**
| Spec | Root cause | NDK? |
|---|---|---|
| `cart` multi-merchant | product streaming (`waitForProducts`) | likely yes |
| `buyer-purchase` cart totals | product streaming ("load from relay") | likely yes |
| `auth` remove stored key | `browserContext.close` (Playwright infra) | **no** — test-infra |
| `app-settings` blacklist remove | publish mute list + re-read | maybe |

**Orders — the original A1 pilot target — is NOT in the failing list.** The shared
dependency of the two headline reds (cart + buyer-purchase) is the **product-streaming
read path** (`src/queries/products.tsx` / `useStreamingProducts`) = **A2a** territory.

**Pilot retarget (pending isolation run):**

- If isolated cart+buyer-purchase **PASS** → full-run state-leakage (not NDK) → red cron
  to the test-fix branch; migration stays structural.
- If isolated **FAIL on product-card visibility** → NDK product-streaming flakiness →
  **retarget the pilot to A2a** (product reads → seam → applesauce).
- If isolated **FAIL on totals/shipping assertion** → logic bug → debug separately.

**RESULT (2026-06-22 isolation run, fork [#27975662763](https://github.com/c03rad0r/market/actions/runs/27975662763)):**
cart (×3) + buyer-purchase **fail in isolation**, but the cause is **NOT NDK — it's
UI-selector drift**. Both fail identically at the shipping selector:
`buyer-purchase` → `getByText('Select shipping method')` not found (after products
loaded fine); `cart` → `shippingTriggers.toHaveCount(2)` got 0. The cart/shipping UI
was redesigned and these specs still look for the old "Select shipping method" text.
Owned by **fork PR #3 (`fix/shipping-selectors-cart-redesign`)**. `auth` is Playwright
infra (`browserContext.close`). **None of the headline reds are NDK.**

**Revised conclusion:** the red cron run goes to the test-fix workstream (PR #3 +
auth infra), **not** the applesauce migration. **The pilot does NOT retarget to A2a** —
there is no NDK flakiness in the observed reds to fix. The migration continues as
**structural modernization** (long-term reliability + DDD/leaky-abstraction cleanup per
upstream #629). Wave A1 (orders transport on the seam) stands as valid structural work.
(`app-settings` is the one unclassified spec; isolating it wouldn't change this.)

**Sequencing change:** A1 (orders) is structural prep
(it routes the orders transport through the seam; the applesauce flip waits). The
tiny `e2e.yml` grep-input PR (#1031, `ci/e2e-grep-input`) makes targeted diagnostics —
and future per-wave e2e validation — possible via `workflow_dispatch` on the fork.

`auth` `browserContext.close` → test-infra, routed to the test-fix branch regardless.
