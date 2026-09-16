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

- `src/server/ogMeta.ts` (Open Graph product previews) performs server-runtime
  relay I/O via raw `nostr-tools` and is the documented Wave-E seam exception
  (see its header comment). It bounds aggregate work with a process-wide
  concurrency cap (`OG_MAX_CONCURRENT_LOOKUPS`) and coalesces concurrent
  lookups for the same product id onto a single in-flight relay query, so
  rotating random ids cannot drive unbounded concurrent server-side work.

- The OG product route is availability-preserving by contract: the shell is
  fetched from a server-controlled origin (`APP_SHELL_ORIGIN` / fixed
  loopback — never the request `Host`), and every failure mode — shell
  acquisition, relay lookup miss, rejected lookup, or a render error —
  degrades to the plain module shell with HTTP 200. The SEO-only path must
  never 5xx the product page.

- The OG Meta Tags e2e family runs in the per-PR `e2e-grep` gate
  (`.github/workflows/e2e.yml`). `e2e/playwright.config.ts` sets no
  `outputDir`, so Playwright's default output dir resolves to the repo-root
  `test-results/` (nearest `package.json` walking up from the config dir).
  Both the `e2e-grep` and `e2e-full` jobs must upload `test-results/` — never
  `e2e/test-results/`, which never exists and silently captures no failure
  artifacts. A unit guard
  (`src/lib/__tests__/e2e-workflow-artifact-path.test.ts`) enforces this. A
  second guard (`src/lib/__tests__/e2e-workflow-gate-membership.test.ts`)
  asserts every `OG Meta Tags` describe title matches the gate pattern, so the
  family cannot silently drop out of the per-PR gate when it is renamed.

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

## Wave 1 addendum — behaviour `master` already has

**Status of this section.** Descriptive only. It records the seam behaviour that
wave 1 depends on and that `master` already implements: the signature check on
rehydration (F4), the main-relay pinning discipline and its effect-dependency
invariant (F5), and the latest-wins ordering rule for replaceable events. It
records **no new decision** and leaves the `## Status` field of this ADR at
`Accepted`.

The read-reach question for author-scoped reads (F3) is **not** recorded here.
It is a proposed decision, separated into its own PR, and the F3 subsection
below carries only the verified premise so the question is legible without the
decision being smuggled in with the description.

### F4 — invalid-signature events are dropped on rehydration

`rehydrateVerifiedNdkEvent` runs `verifyEvent` on every raw event and discards
those failing. NDK's default subscription path did not verify signatures by
default, so bad-signature events that previously flowed into query data are
now filtered. This matches AGENTS.md ("Treat relay data as untrusted until
validated"). The failure is silent (a relay serving malformed data now reads
as absence). A debug-level drop counter does not exist today; it is a separate
follow-up, not a behavior this addendum asserts.

**Scope of this behavior.** It applies where events are rehydrated through
`rehydrateVerifiedNdkEvent` — the seam fetch path (`src/lib/nostr/ndk-events.ts:55`)
and `src/queries/orders.tsx:1001`. Reads that call NDK directly without
rehydration are not covered by it.

### F5 — live-subscribe stays pinned to the main relay once it is known

`useAdminSettings` / `useEditorSettings` / `useBlacklistSettings` subscribe only
when `getMainRelay()` is defined, and pin that subscription to the main relay.
This preserves the pinning discipline `master` already has; the
`getAppRelaySet()` pool-wide fallback it replaces belongs to the `auctions` line
that wave 1 is migrating.

The invariant this wave must keep: **the main-relay value is an effect dependency
of the subscription.** A hook that mounts before config resolves must subscribe as
soon as the relay becomes known; dropping the value from the dependency array
leaves the subscription silently absent for the rest of the session. Fetch parity
is unchanged — both the old and the new fetch paths return null while the relay is
unknown.

### Deterministic latest-wins for replaceable event reads

Conflicting `created_at` versions of the same deduplication-key event resolve to
the highest `created_at`, independent of relay-arrival order; on an equal
timestamp the lexicographically lower event id wins (NIP-01's tie-break). On
`master` this is `isNewerEvent` (`src/lib/nostr/ndk-events.ts:29-40`), applied by
`fetchNdkEventSet` (`:42-62`), which dedupes on the NDK coordinate key
(`kind:pubkey`, or `kind:pubkey:d` for parameterized kinds) and keeps the newest
copy. The single-event helper used for app-owned replaceable events is
`fetchLatestAppEvent` (`src/lib/stores/ndk.ts:283-291`), which selects by
`created_at`.

### F3 — the read-reach question (premise only)

Production NDK is constructed with `enableOutboxModel: true`
(`src/lib/stores/ndk.ts:421`, `:437`); outbox discovery is gated off for
`staging`, `development` and `LOCAL_RELAY_ONLY`. On `master` the author-scoped
reads this wave touches still call NDK directly — `ndk.fetchEvents` at
`src/queries/authors.tsx:37`, `src/hooks/useNotificationMonitor.ts:59/74/95`, and
`ndk.fetchEvent` at `src/lib/stores/nip60.ts:198`, with live subscriptions at
`src/hooks/useNotificationMonitor.ts:135/161/185`. In production those reads are
therefore outbox-routed today; no pinning is described here because none ships on
`master`.

`src/lib/appSettings.ts:107` is **not** a client read: `fetchAppSettings`
(`:42`) is imported only by the server entry (`src/index.tsx:7`, called at boot
`:143` and refreshed at `:409`), and the browser consumes the parsed result from
`/api/config` (`appSettings`, `appPublicKey`, `needsSetup`, `src/index.tsx:279-290`).

**No decision is recorded.** Whether production keeps that reach for
author-scoped reads, or gains a bounded author-relay path, is proposed in a
separate PR and deliberately not decided in this one.

### Out of scope

- Publish-path relay selection (`writeRelayUrls`) lands with Wave A4 / Wave C.
  This section covers reads only.

## Wave 1 read topology — PROPOSED (not accepted)

**Status of this section.** A **proposal for maintainer discussion**, not a
recorded decision. Nothing here is accepted and no implementation may rely on it.
It is separated from the descriptive addendum above so that what `master`
already does can be recorded on its own, and this can be argued on its merits.

### Proposal 1 — a bounded author-relay path for author-scoped reads

Production NDK is constructed with `enableOutboxModel: true`
(`src/lib/stores/ndk.ts:301`, `:317`), so legacy `ndk.fetchEvents` calls on
author-scoped filters could route to an author's NIP-65 write relays discovered
via the outbox model. Every wave-1 read pins to the configured relay set
(`ndkStore.state.explicitRelayUrls`, with zap reads pinning to `ZAP_RELAYS` union
`explicitRelayUrls`). Outbox discovery is therefore NOT applied to migrated
reads.

**The motive is tool-shape plus disclosure control, not leak-avoidance.** The
outbox-disclosure gating ADR-0002's Context names is already implemented for
`staging`, `development`, and `LOCAL_RELAY_ONLY` (`ndk.ts:301`), so production is
the only stage where the outbox model is active — and the only stage this wave
changes. The applesauce relay pool requires an explicit relay list, and an
explicit list is also the posture we can state plainly: the client reaches the
relays the operator named, plus author relays only through the bounded path
below.

This is a real read-topology change, and the affected reads are user-visible:

- `src/queries/authors.tsx:37` — kind-0 profiles; an author publishing only to
  their own relays surfaces a false "Author not found".
- `src/hooks/useNotificationMonitor.ts:59`, `:74`, `:95` — order and `#p` reads.
  These are _inbox_ reads (`#p: <reader>`), so the relays that can recover them
  are the **reader's own** declared read relays: a reader whose kind-10002
  declares relays outside the configured set otherwise sees missed order and
  payment-status notifications. The authoring counterparty's relay set is not
  knowable before the read (the filter names no author), so this read cannot
  reach a counterparty that publishes _only_ to its own relays — the residual gap
  is recorded in the F3 decision below.
- `src/lib/stores/nip60.ts:159` — kind 17375 wallet bootstrap; a wallet event
  living only on the user's own relays initializes fresh instead of restoring.
- `src/lib/appSettings.ts:107` — app settings read as absent.

**Proposed decision.** Pinned reads
are canonical, and the blocked-reach cases above are served by an **explicit,
bounded, per-purpose author-relay path** rather than by the outbox model:

- a single server-computed boolean in `/api/config` enables the path (ON in
  production; OFF in staging, development, and CI), following the shape ADR-016
  already uses for external zap-receipt relays;
- bounded per read — a small fixed cap of author relays (3), a per-relay timeout,
  and serial execution — so one read cannot fan out to an unbounded relay count;
- bounded per session — the set of distinct author relays resolved in a session is
  capped with a TTL and eviction, so N distinct authors cannot accumulate an
  unbounded relay pool;
- a cache hit serves the cached result and does not fire an author-relay fetch;
  the fetch runs only on a miss, and its result enters the same query cache as the
  pinned result;
- the list it consults is the author's kind-10002 relay list, read through the
  existing declaration reader (`fetchUserRelayListWithPreferences` /
  `useUserRelayList`, `src/queries/relay-list.tsx`). NIP-65 lists are untrusted
  input: deduplicated, scheme-filtered, and capped before any connection opens;
- scope — display-only author-scoped third-party reads (kind-0 profiles), plus
  reads scoped to the reader: the `#p` notification reads above (inbox reads of the
  reader's own declared relays) and the reader's **own** events. The kind-17375
  wallet bootstrap at `src/lib/stores/nip60.ts:159` is therefore in scope: the
  relays consulted are the reader's own declared relays, not a third party's.
  No counterparty relay set is ever resolved for a read whose filter names no
  author, so the notification reads recover the reader's declared relays, not an
  off-pinned-set counterparty. It does NOT apply to authority reads — app config,
  admin/editor/blacklist, and settlement stay pinned to the configured relay set
  (verified from code by the cross-family reviewer of PR #1330: no path from those
  modules reaches the bounded resolver);
- results merge through the same latest-wins / coordinate-dedup rule as the
  pinned path, so ordering semantics do not fork per relay class.

**Disclosure consequence, stated plainly.** Pinned reads disclose the reader's
interest only to the relays the operator named. The bounded path deliberately
discloses more, inside the bound: to an author's declared relays, the reader's IP
and a filter naming that author become visible — information the author's relay can
correlate. The path exists because the alternative costs the operator a false
"Author not found" and missed order notifications; the per-read cap, the session
cap, the cache-hit rule, and the display-only scope exist to keep that disclosure
finite and legible. This is a recorded tradeoff, not an implicit one.

**Implementation status.** A draft implementation exists as PR #1330
(branch `pr/bounded-author-relay-reads`, head `416a1349`): 32/32 unit tests green
at that head, and a cold cross-family review verified all eight declared bounds
present at file:line. It is **not merged** — it is held until this proposal is
ruled on — and the copy of this ADR section it currently carries is dropped so
that this text is the single source.

This wording also replaces the earlier claim that terminating outbox routing is
justified by leak-avoidance in production, which is not where that gating applies.

### Proposal 2 — availability of the app-config canonical read

`getAppRelaySet()` returns a relay set of exactly one relay (the main relay) so
that stale copies held by third-party relays cannot race the canonical answer, and
`fetchLatestAppEvent` reads through it. The question is whether that stays, or
gains a bounded fallback.

Two facts narrow it. Every authority read already pins the publisher — admin
(`kinds: [30000]`, `#d: ['admins']`), editor (`kinds: [30000]`,
`#d: ['editors']`) and blacklist (`kinds: [10000]`) all pass `authors:
[appPubkey]`, and `selectAuthoritativeAppSettingsEvent` additionally checks kind
and `d` for the app-settings event — so a relay cannot forge these; it can only
serve an **older** copy. And `fetchLatestAppEvent` already sorts by `created_at`
descending and takes the newest. The safety of these reads therefore comes from
the author pin plus latest-wins, both already in the code, not from using a single
relay. What remains is narrower: two of **our own** relays disagreeing, or a newer
list signed with a smaller `created_at`.

- **(a)** keep one relay, and record single-relay availability as an accepted
  tradeoff for app-owned config;
- **(b)** read the operator relay set (two or more operator-controlled relays)
  with the existing author pin and latest-wins, and add a monotonic `version` tag
  to app-owned list events so ordering does not depend on clock accuracy.

**(b) is proposed.** It gives redundancy without introducing third-party relays,
and the `version` tag removes the last ordering ambiguity, so single-relay
dependency stops being an unrecorded side effect of pinning.

### Proposal 3 — data classification (which facts live where)

Three different kinds of data are being argued about as one. They should be
decided separately:

1. **Client configuration** — `appRelay`, `stage`, `nip46Relay`, `appPublicKey`,
   `cvmServerPubkey`, `externalZapRelaysEnabled`, `externalAuthorReadsEnabled`.
   Served by the app server through `/api/config`; never resolved through relay
   reads. No staleness question applies.
2. **App-signed policy lists** — admin, editor, blacklist, and the app-settings
   event (kind 31990). Relay-borne, because they must be updatable without a
   deploy and are verifiable by the app key, but single-writer: author-pinned,
   latest-wins, versioned, read from operator relays.
3. **User data** — profiles, wallet backups, relay lists, user settings. Read
   from the author's own declared relays (NIP-65) plus ours, bounded as in
   Proposal 1. Recovering data that exists only off our relay is a **discovery**
   problem, not a freshness one.

**Authority for all three is the signing key — not a relay, and not a service.**
NIP-01 already gives replaceable and addressable events a total order
(`created_at`, then the lower event id); what no coordinator can supply is *set
completeness* — knowing that no newer copy exists anywhere. A CVM-held "latest
event id" index is therefore only ever usable as an **optional index over signed,
versioned events**: a data source, never the arbiter of what is latest. As a
required pre-trust check it would add a service dependency and an RTT in front of
every read, and it can withhold a newer version while answering with an older one
that is still perfectly valid — the one defence it would replace is the
cross-relay comparison itself.

**On negentropy:** `relay.plebeian.market` advertises NIP-11 `supported_nips [1,
9, 11, 40, 42, 45, 70, 86]` — no NIP-77 — so relay-side negentropy
reconciliation is not available on our own relay today. It stays a future option,
not a design element.

### Residual gaps recorded for the discussion

- The drafted bounded path covers the **cold initial reads**. The live
  subscriptions at `src/hooks/useNotificationMonitor.ts:135/161/185` remain
  pinned-only and are not migrated by it.
- The author-relay e2e spec is not part of the per-PR e2e alternation
  (`.github/workflows/e2e.yml:139`), so its mocked-relay coverage does not run in
  the normal PR gate.
- The earlier draft's claim that NIP-17 DM discovery (kind 10050) is an
  "already deployed external-reach path" is **unverified** and has been dropped
  from the descriptive PR pending verification.

### Proposal 4 — scope of this addendum

- Publish-path relay selection (`writeRelayUrls`) lands with Wave A4 / Wave C.
  This proposal covers reads only. NIP-17 DM relay discovery (kind 10050) is a
  separate path and is not governed by it.
- Until every read path migrates, the app runs a mixed topology — migrated reads
  pinned, un-migrated reads still outbox-routed. The proposals describe an end
  state, not the current one.

## References

- Upstream epic: `PlebeianApp/market#1005`
- Martin Fowler, "StranglerFig":
  https://martinfowler.com/bliki/StranglerFigApplication.html

## Amendment (2026-09): Signer migration to applesauce-signers

Waves A3 (NIP-07 + nsec) and A3b (NIP-46) of this ADR — the deferred signer seat — are specified by this amendment and implemented by the signer migration. The signer-migration draft was numbered `ADR-0022`, then renumbered `ADR-0008`, and was never merged as a standalone document: its decision is folded into this amendment, so neither number may be cited as an ADR (the index reserves 0008 for a different open conflict).

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

PR #1199 is **not an input dependency** of the signer migration: no implementation, test, or invariant here derives from its workarounds or from its test suite. It is retained only as a source of regression cases, and Wave A3b supersedes it.

### Executable invariants preserved through A3/A3b

Each invariant is protocol-faithful (NIP-46 / NIP-07 / NIP-59), derived from the characterized `master` behavior plus the protocol, and has an executable test at the **production seam** (not at a module-mocked seam). The signer migration may not regress them, and coverage must not fall below the characterized baseline.

- **I1 — The connect secret is validated before binding.** An unknown remote signer is never bound from a bare `ack`; the expected `secret` must validate first. (Implementation: `nostr-connect-signer.ts`. Tests: `nostr-connect-signer.test.ts` — "a bare \"ack\" never binds an unknown remote signer", "a wrong connect secret never binds the remote signer".)
- **I2 — Remote signer ≠ authenticated user.** The remote-signer pubkey stays separate from the authenticated user pubkey, which is learned only via `get_public_key` / `getPublicKey()`. (Tests: `nostr-connect-signer.test.ts` — "identity resolution is via getPublicKey() only — never clientPubkey"; `nip46-signer-capability.test.ts` — identity-collapse cases.)
- **I3 — Signed events are bound to the resolved user identity.** A returned signed event must be cryptographically valid **and** satisfy `event.pubkey === authenticatedUserPubkey`; a valid signature from a different key fails closed. (Tests: `nostr-connect-signer.test.ts` — "signEvent fails closed when the returned event pubkey differs from the authenticated user"; the `io-applesauce.ts` sign port.)
- **I4 — NIP-44 is capability-gated, never synthesised locally.** `SignerCapability.nip44` is optional: a NIP-07 extension without `window.nostr.nip44`, or a NIP-46 signer without the RPC, has no capability, and NIP-59 fails closed instead of falling back to local `nostr-tools` NIP-44 behind a user who never exposed a key. (Implementation: `signer-capability.ts`, `signer-registry.ts` `createExtensionSigner`, `nip59.ts` `signerSupportsNip44`. Tests: `extension-signer.test.ts` — "leaves nip04 and nip44 absent when the extension lacks them (fail closed)"; `nip59.test.ts`.) This is a deliberate behaviour change from `master`, whose NIP-59 module can encrypt with a locally held key.
- **I5 — Session secrets are never silently plaintext.** A persisted NIP-46 session is encrypted at rest in the vault; existing plaintext sessions are migrated to the vault or force an **intentional re-login**. Retaining plaintext bearer-capability storage is only ever a named maintainer risk-acceptance recorded against the open unencrypted-session-key finding (`#996` H8) — never a silent default. (Implementation: `session-vault.ts`, `stores/auth.ts`. Tests: `session-vault.test.ts`, `auth-session-vault-real-seam.test.ts`.)

### Decisions

- Adopt `applesauce-signers`, pinned exactly at `6.2.2` in `package.json`, for signing alongside the applesauce relay I/O already behind the io seam. `NostrConnectSigner` (NIP-46), `ExtensionSigner` (NIP-07), `PrivateKeySigner` (nsec), and `PasswordSigner` (NIP-49, ncryptsec encrypted at rest with `unlock`/`lock`) replace their NDK equivalents. Prerequisite met on `master`: `applesauce-core` / `applesauce-relay` 6.2.x landed via #1253 (2026-09-01). No NDK-internal workaround is ported; NDK still drops entirely and Wave D stays gated on A3b. `nostr-tools` remains the shared event/nip19/nip44 layer.
- All `applesauce-signers` imports live behind a signer registry inside `src/lib/nostr/`; stores and UI components never import it directly. The signer seat is a second, equally narrow exception to the `applesauce-*` import rule in `src/AGENTS.md` (relay I/O being the first), and that rule text is amended by the signer migration rather than deferred.
- One app-owned signer capability seam (`getPublicKey`, `signEvent`, optional `nip44.encrypt`/`decrypt`) covers NIP-07, NIP-46, and local signers (I4). Local signers implement NIP-44 locally; NIP-07 and NIP-46 delegate it, so no path falls back to local NIP-44 behind a user who never exposed a key.
- The NIP-46 trust/identity chain is locked as invariants I1–I3, with negative coverage for the wrong secret, ack-only binding in the client-initiated flow, remote-signer/user separation, and a valid signature from the wrong user key.
- NIP-46 session persistence stores the **nbunksec**: the `Nbunksec` / `BunkerURI` session token (`createNbunksec` / `parseNbunksec`, consumed by `NostrConnectSigner.fromNbunksec`) that carries the client secret key and the bunker pointer. It is encrypted at rest (I5).
- Migration contract: characterize current `master` behavior as executable tests first, then swap per wave preserving those invariants; coverage must not regress below the baseline, and the e2e NIP-46 mock uses distinct remote-signer/user keypairs. Coverage is anchored to the production seam, not to module-mocked seams: a wave's restore/unlock path must be exercised non-mocked (e.g. the real `rehydrateNostrConnectSession` → `NostrConnectSigner` connect RPC), because a suite that mocks the seam cannot observe an unwired transport. The Authentication e2e family runs on every PR.

Related: unencrypted NIP-46 session key — open security finding `#996` H8.

### Build-level patch: `rxjs` index re-exports under `bun dev`

The Authentication e2e family is the first browser code path that reaches `applesauce-relay`'s `RelayPool` (the NIP-46 lane's transport), and it surfaced a bundler-level defect rather than a signer bug:

- `bun`'s dev-server bundler (the server every local run and the `e2e-grep`/`e2e-full` jobs start) registers only the **first** named re-export per source path when it builds a module's export map.
- `rxjs@7.8.2`'s `index.js` re-exports two names from each of three module paths: `TimeoutError` + `timeout` (`./internal/operators/timeout`), `empty` + `EMPTY` (`./internal/observable/empty`), and `never` + `NEVER` (`./internal/observable/never`).
- The second name of each pair is therefore missing from the browser bundle's `rxjs` namespace, and `Relay.publish()` / `Relay.request()` build a `timeout(...)` operator synchronously — so every publish/request through the applesauce pool throws `import_rxjsN.timeout is not a function`. That broke the NIP-46 bunker connect path (Authentication) **and** the orders read path (`applesauceIo.fetchEvents` in `src/queries/orders.tsx` → Order Details), which is why both gated families were red before this patch. Bun's own runtime resolution is unaffected because it uses rxjs's CJS entry.

The fix is a semantics-preserving patch of rxjs's two ESM index files, applied through bun's first-class `patchedDependencies` mechanism (`patches/rxjs@7.8.2.patch`): the duplicate-path statements are merged into one statement per path (`export { TimeoutError, timeout } from './internal/operators/timeout'`), which exports exactly the same names and restores all three. `bun install --frozen-lockfile` applies the patch, so CI gets the same bundle the local runs do. Remove the patch once the bundler registers every named re-export or rxjs ships merged statements; drift is loud, not silent, because a patch that no longer applies fails `bun install`.

### NIP-46 QR lane: bounded connect for the listener

The nostrconnect (`QR code`) lane kept its own NDK instance for the scan subscription and awaited `ndk.connect()` with no bound. NDK only settles that promise once **every** relay in the instance's pool reaches `CONNECTED`, so a single slow or unreachable relay — the default `wss://relay.plebeian.market` pick, or a user-typed relay — left the kind-24133 subscription unstarted and the signer's `connect` request unanswered (the relay answered the signer with `mute: no one was listening for this`, which is what the e2e QR spec saw). `NostrConnectQR` bounds the connect at 3s: the socket keeps connecting in the background and the listener starts, so a slow relay degrades to a retry instead of a dead scan.
