# Engineering Analysis: The `io.ts` Doc-vs-Reality Gap

**Date:** 2026-07-13
**Scope:** Architecture decision support for the NDK-to-Applesauce migration seam
**Finding:** AGENTS.md line 74 instructs contributors to route new relay I/O through `src/lib/nostr/io.ts`, but that file **does not exist**. This document traces the history, maps the current NDK footprint, analyzes the surviving (partial) abstraction, and presents three options with trade-offs.

---

## 1. What Happened: A Forensic Summary

The `io.ts` seam was not a figment of documentation — it was a **fully implemented, well-architected strangler-fig port** that was created, iterated on across at least 8 commits, documented in a 236-line ADR-0002, and then **deleted in a single cleanup commit**.

### Timeline

| Commit | Date | Event |
|--------|------|-------|
| `271335b5` et al. | Early Jul 2026 | `io.ts`, `io-ndk.ts`, `io-applesauce.ts` created as a strangler-fig seam. ADR-0002 written. CI NDK-footprint guard added. |
| `febc015c` | Jul 6, 2026 | ADR-0002 consolidated; `io.ts` modified to a mature state (75 lines, full `NostrIo` interface). |
| `07e35d73` | Jul 12, 2026 | **Massive cleanup by c03rad0r.** Deleted `io.ts`, `io-ndk.ts`, `io-applesauce.ts`, ADR-0002, ADR-0013, ADR-0014, CI guard workflow, multiple subdirectory AGENTS.md files. Rewrote root AGENTS.md (132 lines changed). **But left the "New relay I/O should route through `src/lib/nostr/io.ts`" guidance in place.** |

The deleted `io.ts` was a clean port interface:

```typescript
// The DELETED io.ts — this is what AGENTS.md still references
export interface NostrIo {
  fetchEvents(filter: NostrFilter | NostrFilter[], opts?: FetchOptions): Promise<NostrEvent[]>
  subscribe(filter: NostrFilter | NostrFilter[], onEvent: (event: NostrEvent) => void, opts?: SubscribeOptions): () => void
  publish(event: NostrEvent, opts?: PublishOptions): Promise<void>
  sign(template: EventTemplate): Promise<NostrEvent>
  getUser(): Promise<NostrUser | null>
}

let active: NostrIo = ndkIo  // defaults to NDK bridge

export function getNostrIo(): NostrIo { return active }
export function setNostrIo(io: NostrIo): void { active = io }

// Pass-through exports for ergonomic imports
export const fetchEvents = (filter, opts) => active.fetchEvents(filter, opts)
export const subscribe = (filter, onEvent, opts) => active.subscribe(filter, onEvent, opts)
export const publish = (event, opts) => active.publish(event, opts)
export const sign = (template) => active.sign(template)
export const getUser = () => active.getUser()
```

It had companion files (`io-ndk.ts` for the NDK bridge, `io-applesauce.ts` for the destination), a `setNostrIo()` swap mechanism for per-module flipping, and raw `nostr-tools` event types throughout — exactly right for the migration since applesauce uses raw events natively.

The deleted ADR-0002 documented a six-wave migration plan (Wave 0 through Wave E) with stacked PRs, two-step flips per module (route-through-seam → flip-to-applesauce), explicit deferral of auth/signer paths to Wave A3/A3b, and Wave D gated on Wave A3b completion.

**Zero references to `io-ndk`, `io-applesauce`, `getNostrIo`, `setNostrIo`, or `NostrIo` survive in the current codebase.** The deletion was thorough — except for the AGENTS.md line that references the file path.

---

## 2. Current NDK Footprint: Full Map

### By Layer (production files only, excluding tests and backups)

| Layer | Files Importing `@nostr-dev-kit` | Primary Usage Pattern |
|-------|------:|----------------------|
| `src/lib/` | 36 | Type imports (`NDKEvent`, `NDKFilter`), store wiring, schema definitions, NIP-59 |
| `src/components/` | 34 | `NDKEvent` instantiation for publishing, `NDKUser`, `NDKZapper` |
| `src/queries/` | 25 | `NDKFilter` + `NDKEvent` for TanStack query functions |
| `src/publish/` | 20 | `NDKEvent` creation + `sign()` + `publish()`, `NDKRelaySet` targeting |
| `src/server/` | 14 | `NostrEvent` type, `NDKSubscription`, server-side NDK singleton |
| `src/routes/` | 13 | `NDKEvent` type imports for route components |
| `src/hooks/` | 3 | `NDKEvent`, `NDKFilter`, `NDKSubscription` for streaming hooks |
| **Total** | **145** | |

### By Usage Type

| NDK Export | Production Files Using | Migration Difficulty |
|------------|----------------------:|---------------------|
| `NDKEvent` (instantiation) | 57 | **Hard** — `new NDKEvent(ndk, ...)` is woven into publish flows with `.sign()`, `.publish()`, `.tagValue()`, `.rawEvent()` method chains |
| `NDKFilter` (type) | 23 | **Easy** — structurally identical to `nostr-tools` `Filter` |
| `NDKSigner` (type) | 18 | **Hard** — ties into NIP-07/NIP-46 signer abstraction |
| `NDKUser` | 13 | **Medium** — used for pubkey wrapping, encryption peers |
| `NDKKind` (enum) | 8 | **Easy** — plain numeric constants |
| `useNDK` (React hook) | 7 | **Hard** — provides NDK instance + signer via React context |
| `NDKRelaySet` | 7 | **Medium** — relay targeting for publish/fetch |
| `NDKSubscription` | 4 | **Medium** — subscription lifecycle management |
| `NDK` (default instance) | 5 | **Hard** — the singleton everything depends on |

### Ecosystem Package Lock-In

The NDK dependency extends well beyond the core `@nostr-dev-kit/ndk` package:

- **`@nostr-dev-kit/wallet`** (1.0.0): `NDKNWCWallet`, `NDKCashuWallet`, `NDKCashuDeposit`, `NDKWalletStatus`, `NDKWalletTransaction` — used in `stores/nip60.ts`, `stores/wallet.ts`, `publish/payment.tsx`, `lib/wallet/proofs.ts`. These have **no applesauce equivalent** and would require a replacement wallet abstraction.
- **`@nostr-dev-kit/wot`** (1.0.0): `NDKWoT` — used in `queries/profiles.tsx` for Web of Trust scoring.
- **`@nostr-dev-kit/blossom`** (8.0.0): `NDKBlossom` — used in `lib/blossom.ts` for media uploads.

These ecosystem packages multiply the migration cost significantly. A core I/O seam only covers fetch/subscribe/publish — wallet and blossom usage would need separate migration tracks.

### Signer Stack

`src/lib/stores/auth.ts` imports the full signer stack: `NDKNip07Signer`, `NDKNip46Signer`, `NDKPrivateKeySigner`. The deleted ADR-0002 explicitly deferred signer migration to Wave A3/A3b, recognizing this as the hardest part.

---

## 3. The Surviving Abstraction: `nostr-adapters.ts`

When `io.ts` was deleted, a separate, weaker abstraction survived. There are actually **two copies** of it, both less sophisticated than the deleted `io.ts`:

### 3a. `src/lib/nostr-adapters.ts` (204 lines) — THE LIVE ONE

This is the only adapter file imported by production code:

```
src/lib/stores/ndk.ts:11     → import { createNostrAdapter, ... } from '../nostr-adapters'
src/lib/__tests__/           → two test files import from it
```

**Interface:**
```typescript
export interface NostrAdapter {
  readonly backend: NostrBackend  // 'ndk' | 'applesauce'
  fetchEvents(filters: Filter | Filter[]): Promise<NostrEvent[]>
  subscribe(filters: Filter | Filter[], onEvent: (event: NostrEvent) => void, opts?: {
    closeOnEose?: boolean
  }): () => void
}
```

Compared to the deleted `io.ts`, this interface is missing: `publishEvent`, `sign`, `getUser`, `relayUrls` on options, `timeoutMs` on fetch, and the `setNostrIo()` swap mechanism.

**Wiring:** Only one function in the entire codebase actually routes through it — `fetchEventsWithTimeout` in `stores/ndk.ts` (line 362):

```typescript
const nostrAdapter = ndkStore.state.nostrAdapter
if (nostrAdapter && nostrAdapter.backend === 'applesauce') {
  // Use Applesauce adapter for fetching
  nostrAdapter.fetchEvents(filters as any)
    .then((rawEvents: any[]) => {
      // Convert raw NostrEvent objects BACK to NDKEvent objects
      const events = new Set<NDKEvent>()
      for (const rawEvent of rawEvents) {
        const ndkEvent = new NDKEvent(ndk, rawEvent)
        events.add(ndkEvent)
      }
      resolve(events)
    })
```

This is architecturally incoherent: it fetches raw events through applesauce, then **immediately wraps them back into `NDKEvent` objects** because the entire downstream codebase expects `NDKEvent`. It's an abstraction that adds overhead without reducing coupling.

**API Mismatches:** The `ApplesauceAdapter` class in this file calls `this.relayPool.group()` and `relayGroup.request()` / `relayGroup.subscription()` — these are speculative APIs that may not match the actual `applesauce-relay` package's `RelayPool` interface. The code uses `any` casts throughout, making compile-time verification impossible.

**Default Path:** `NOSTR_BACKEND` is unset in all environments, so `createNostrAdapter()` always returns `NDKAdapter` (passthrough). The applesauce path has never run in production.

### 3b. `src/lib/nostr-adapters/` (directory) — DEAD CODE

This directory contains `index.ts`, `applesauce-adapter.ts`, and `applesauce-adapter.backup.ts` (836 lines total). **It is not imported by any production code** — only by its own test files, which import from `'../nostr-adapters'` (the singular file, not the directory). It appears to be an earlier iteration that was superseded by the singular file and never cleaned up.

The directory version has a slightly richer interface (includes `publishEvent` and `subscribeWithCallback`) but uses an even more speculative applesauce API, including a `streamObservableEvents` method that contains a `.then(async function*())` chain — syntactically invalid TypeScript that would throw at runtime.

### 3c. Assessment

The surviving abstraction is a **false start**, not a working layer:

- It covers 2 of 5 I/O operations (fetch + subscribe; no publish, sign, or getUser).
- It's wired into exactly 1 of 145 NDK-using files.
- The applesauce implementation uses speculative APIs with `any` casts.
- It converts raw events back to NDKEvent immediately, negating the decoupling benefit.
- It has never been exercised in production (default backend is always NDK).
- There are two competing copies that confuse contributors.

---

## 4. What Exists in `src/lib/nostr/` Today

| File | Lines | Purpose | NDK Dependency |
|------|------:|---------|----------------|
| `naddr.ts` | 5 | `naddrEncode` wrapper around `nostr-tools` | None (uses `nostr-tools` directly) |
| `nip59.ts` | 406 | NIP-59 gift wrap create/unwrap with full validation | `NDKUser`, `NDKSigner` (for signer-based variants) |

`nip59.ts` is well-engineered — it has dual codepaths (raw private key + NDKSigner), thorough assertion functions, and proper error labeling. But it imports `NDKUser` and `NDKSigner` for the signer-based variants, meaning it's partially coupled to NDK even though the core crypto uses `nostr-tools` directly.

---

## 5. Options Analysis

### Option A: Restore `io.ts` from Git History

**What:** Retrieve the deleted `io.ts`, `io-ndk.ts`, and `io-applesauce.ts` from commit `febc015c` (their last good state), restore ADR-0002, and re-establish the strangler-fig seam. Delete the `nostr-adapters.ts` and `nostr-adapters/` false starts.

**Effort:** Medium (2-3 days)
- `git show febc015c:src/lib/nostr/io.ts` recovers the file verbatim.
- Companion files (`io-ndk.ts`, `io-applesauce.ts`) need to be recovered similarly.
- ADR-0002 can be restored from the same commit.
- The existing `nostr-adapters.ts` wiring in `stores/ndk.ts` (one function) needs to be migrated to use the restored `io.ts` interface.
- Delete `nostr-adapters.ts`, `nostr-adapters/` directory, and their test files.

**Risk Level:** Low-Medium
- The code was reviewed and merged previously (8 commits of iteration).
- The port interface is clean and well-typed.
- Risk is in the `io-applesauce.ts` adapter — it needs verification against the current `applesauce-relay` API (v4.0.0), which may have changed since the adapter was written.
- The NDK bridge (`io-ndk.ts`) is low-risk since it wraps the existing NDK singleton.

**What the PR looks like:**
```
docs/adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md  | 236 +++ (restored)
src/lib/nostr/io.ts                                         |  75 +++ (restored)
src/lib/nostr/io-ndk.ts                                     | ~80 +++ (restored)
src/lib/nostr/io-applesauce.ts                              | ~100 +++ (restored)
src/lib/nostr-adapters.ts                                   | 204 --- (deleted)
src/lib/nostr-adapters/index.ts                             | 147 --- (deleted)
src/lib/nostr-adapters/applesauce-adapter.ts                | 243 --- (deleted)
src/lib/nostr-adapters/applesauce-adapter.backup.ts         | 242 --- (deleted)
src/lib/stores/ndk.ts                                       | ~20 lines modified (rewire to io.ts)
src/lib/__tests__/applesauce-adapter.test.ts                | replaced with io.test.ts
src/lib/__tests__/test-applesauce-adapter.test.ts           | deleted
AGENTS.md                                                   | no change (now accurate)
```

**Testing needed:**
- Unit tests for `io.ts` port contract (mock both adapters, verify pass-through).
- Unit tests for `io-ndk.ts` bridge (verify it wraps existing NDK calls correctly).
- Integration test for `io-applesauce.ts` against live relays (the restored tests from ADR-0002 era).
- Verify `stores/ndk.ts` `fetchEventsWithTimeout` still works through the new seam.
- Run `bun run test:unit` and `bun run test:integration` to confirm no regressions.

**Trade-offs:**
- ✅ Recovers a well-designed, previously-reviewed architecture.
- ✅ Makes AGENTS.md accurate without changing the doc.
- ✅ Full interface (fetch, subscribe, publish, sign, getUser) — ready for actual migration.
- ✅ Per-module flip mechanism (`setNostrIo()`) enables incremental migration.
- ❌ Requires verifying applesauce API compatibility after ~10 days of potential drift.
- ❌ Restoring deleted files may confuse git archaeologists who expect forward-only history.

---

### Option B: Update AGENTS.md to Match Reality

**What:** Remove the `io.ts` reference from AGENTS.md. Either (a) remove the entire "NDK to Applesauce Wave 0" section, or (b) rewrite it to describe the `nostr-adapters.ts` abstraction that actually exists. Also clean up the dead `nostr-adapters/` directory.

**Effort:** Low (2-4 hours)
- Edit AGENTS.md lines 72-79.
- Delete `src/lib/nostr-adapters/` directory (dead code, not imported).
- Optionally: delete `nostr-adapters.ts` too, since it's barely wired in and adds confusion. Rewire `fetchEventsWithTimeout` in `stores/ndk.ts` to remove the adapter check (it always falls through to NDK anyway).

**Risk Level:** Very Low
- Docs-only change to AGENTS.md.
- Dead code removal for `nostr-adapters/` directory.
- The `nostr-adapters.ts` removal is slightly higher risk (requires touching `stores/ndk.ts`), so could be deferred.

**What the PR looks like:**
```
AGENTS.md                                          | ~8 lines modified
src/lib/nostr-adapters/index.ts                    | 147 --- (deleted)
src/lib/nostr-adapters/applesauce-adapter.ts       | 243 --- (deleted)
src/lib/nostr-adapters/applesauce-adapter.backup.ts| 242 --- (deleted)
```

Or, if also removing `nostr-adapters.ts`:
```
AGENTS.md                                          | ~8 lines modified
src/lib/nostr-adapters.ts                          | 204 --- (deleted)
src/lib/nostr-adapters/ (entire directory)         | 632 --- (deleted)
src/lib/stores/ndk.ts                             | ~15 lines modified (remove adapter wiring)
src/lib/__tests__/applesauce-adapter.test.ts       | deleted
src/lib/__tests__/test-applesauce-adapter.test.ts  | deleted
```

**Testing needed:**
- `git diff --check` and `bun run format:check` (docs-only safe checks per AGENTS.md).
- If `nostr-adapters.ts` is removed: `bun run test:unit` to verify `stores/ndk.ts` changes don't break.

**Trade-offs:**
- ✅ Fastest path to eliminating the doc-vs-reality gap.
- ✅ Removes dead code that confuses contributors.
- ✅ Honest about the current state — no abstraction layer exists.
- ❌ Kills the migration strategy without replacement. If the team later wants to migrate, they start from scratch.
- ❌ Loses the ADR-0002 wave plan, which was well-researched.
- ❌ AGENTS.md's "NDK footprint guard" mention becomes orphaned (the guard workflow was also deleted).

---

### Option C: Build a New Abstraction Layer from Scratch

**What:** Design a new I/O seam informed by the deleted `io.ts` design but built for the current codebase reality. Start with the `nostr-adapters.ts` interface, extend it to cover all five operations, and systematically route high-value modules through it.

**Effort:** High (1-2 weeks for a credible first wave)
- Design phase: Define the `NostrIo` interface, decide on event type strategy (raw `nostr-tools` events vs. a local wrapper), figure out signer abstraction.
- Implementation: Build the NDK bridge adapter (covers all 5 operations).
- Wire-in: Route 5-10 query modules through the seam (the `queries/` layer is the best starting point — they mostly use `NDKFilter` + `NDKEvent` type imports, which are the easiest to migrate).
- Do NOT build the applesauce adapter yet — that comes when the seam is proven.

**Risk Level:** Medium-High
- Designing a new abstraction from scratch risks repeating the same mistakes that led to the `nostr-adapters.ts` false start.
- The signer abstraction is the hardest part — getting it wrong early creates tech debt.
- 145 files need to eventually migrate; a bad seam design compounds cost.

**What the PR looks like:**
```
docs/adr/ADR-XXXX-nostr-io-seam.md                | ~150 +++ (new ADR)
src/lib/nostr/io.ts                               | ~100 +++ (new port interface)
src/lib/nostr/io-ndk.ts                           | ~120 +++ (new NDK bridge)
src/lib/nostr/nostr-adapters.ts                   | deleted (superseded)
src/lib/nostr-adapters/                           | deleted (superseded)
src/queries/products.tsx                          | ~10 lines modified (route through io.ts)
src/queries/orders.tsx                            | ~10 lines modified
src/queries/auctions.tsx                          | ~10 lines modified
... (5-10 query files)
AGENTS.md                                         | updated to reference new ADR
```

**Testing needed:**
- Full unit test suite for the port contract.
- Integration tests for the NDK bridge (verify identical behavior to direct NDK calls).
- Per-module migration tests (each query module that routes through the seam must produce identical results).
- `bun run test:unit` and `bun run test:integration` after each module migration.

**Trade-offs:**
- ✅ Clean slate — no baggage from the false starts.
- ✅ Can incorporate lessons learned (e.g., the raw-event-to-NDKEvent round-trip anti-pattern).
- ✅ Can design for the ecosystem packages (wallet, blossom, WoT) from the start.
- ❌ Highest effort and risk.
- ❌ Delays the actual NDK-to-Applesauce migration by weeks.
- ❌ May reproduce the same design that was already deleted — the deleted `io.ts` was quite good.

---

## 6. Recommendation

**Option A (Restore) is the strongest choice**, for three reasons:

1. **The deleted code was good.** The `io.ts` port interface is clean, the ADR-0002 wave plan is thorough, and the design decisions (raw events, per-module flip, deferred signer migration) are sound. Restoring it recovers ~2 weeks of design work.

2. **The false starts prove the design is needed.** The fact that two separate, cruder adapter implementations spontaneously appeared (`nostr-adapters.ts` and `nostr-adapters/`) shows that contributors feel the need for an I/O seam — but without the proper port interface, they built broken versions. Restoring `io.ts` gives them the right thing to use.

3. **It makes AGENTS.md true without weakening it.** Option B achieves honesty by lowering the bar. Option A achieves honesty by raising the code to meet the doc.

**If Option A is chosen, the immediate follow-up work is:**
- Verify `io-applesauce.ts` against `applesauce-relay@4.0.0` API (the highest-risk item).
- Delete `nostr-adapters.ts` and `nostr-adapters/` to eliminate confusion.
- Migrate `stores/ndk.ts` `fetchEventsWithTimeout` to use `io.ts` instead of the old adapter.
- Add a CI check that prevents new `@nostr-dev-kit` imports in `src/queries/` (the first migration target), establishing the footprint guard that was also deleted.

**If the team is not ready to commit to the migration**, Option B is the pragmatic fallback — but it should explicitly state in AGENTS.md that the migration is deferred and the Wave 0 guidance is withdrawn, rather than silently removing it.

---

## 7. Appendix: File Inventory

### Files to Delete (Dead Code)
- `src/lib/nostr-adapters.ts` (204 lines) — superseded false start, barely wired
- `src/lib/nostr-adapters/index.ts` (147 lines) — dead, not imported
- `src/lib/nostr-adapters/applesauce-adapter.ts` (243 lines) — dead, not imported
- `src/lib/nostr-adapters/applesauce-adapter.backup.ts` (242 lines) — dead backup
- `src/lib/stores/ndk.ts.backup` (35KB) — stale backup of ndk store
- `src/lib/__tests__/applesauce-adapter.test.ts` — tests for dead code
- `src/lib/__tests__/test-applesauce-adapter.test.ts` — duplicate tests for dead code

### Files to Restore (from commit `febc015c`)
- `src/lib/nostr/io.ts`
- `src/lib/nostr/io-ndk.ts`
- `src/lib/nostr/io-applesauce.ts`
- `docs/adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md`

### Files That Already Exist and Are Correct
- `src/lib/nostr/naddr.ts` — clean, no NDK dependency
- `src/lib/nostr/nip59.ts` — well-engineered, partial NDK dependency (signer variants)
