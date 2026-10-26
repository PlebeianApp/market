---
module: relay-config
kind: module
schema: architecture
applies: core@0.1
inherits: [platform-core]
implements: []
opt-out: []
test-support: ['ts/harness.ts', 'ts/*.test.ts']
levels:
  objective: present
  technical-spec: present — the one port, the role split, the injected default layer, the two switches and the per-role cap
  implementation: present — TypeScript in ts/ (the first implementation, over `applesauce-common` 6.2.0 and `applesauce-core` 6.2.0; the spec was written first)
  tests: present — 7 cases in 1 file, run by `bun test`, with the increment's evidence obligations stated here as criteria
contract:
  entry: ts/index.ts
  operations: [userRead, userWrite, dmRelays, role, instance, outboxEnabled, dmFallback, setWriteRelay]
  exports: [createRelayConfig, MAX_READ_POOL, DM_RELAYS_KIND, LOOKUP_RELAYS_KIND]
  types: [RelayConfigPort, RelayRole, InstanceRole, DmFallback, RelayDefaults, RelayStoreHandle, Mailboxes]
implementations:
  - id: ts # the selector a composition names
    lang: typescript
    dir: ts # relative to the module directory
    entry: ts/index.ts
    package: null # consumed as a directory, not shipped as a package
    install: [bun, install] # every action is a token array, never a shell string
    build: []
    test: [bun, test]
    typecheck: [bun, run, typecheck]
    needs: [] # CODE dependencies (module names), not `inherits`
access:
  group: m_relay-config
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - the DM path (the next increment) — `sdk/commerce/messaging/**` reads `dmRelays`; it is the only consumer and it arrives later
  - any SDK node that asks "which relays", answered by role
source:
  adr: null
  replaced: the app's `RelayConfigPort` re-cut (`market-app/ts/relays.ts:34,37-42` @ `7ad658d4`) and the relay-policy derivation it stands on. The app files are NOT edited in this scope; the app's migration is deferred.
  direction: runs/2026-10-14-relay-configurations/order-increments-sdk.md section "Increment 2"; architecture-applesauce.md section 4.1
webui:
  - id: webui
    title: The relay configuration port, in plain language
    entry: visuals/webui/index.html
    skill: visuals/webui/SKILL.md
---

# relay-config — the one relay configuration port, answered by role

**The job, in one sentence** — own the answer to _"which relays"_: one port, its members split three ways
(the library's, ours, and the injected default layer), reading the library's relay-list **events** through the
store and holding **no pool and no socket**.

This document is the **spec**. `ts/` holds the first implementation — TypeScript, over `applesauce-common`
6.2.0 and `applesauce-core` 6.2.0, which are implementations of the library's models and not this contract —
and `evidence/` holds the commands that regenerate what this document claims.

**A note on statement identities, stated rather than faked.** Every sibling module's statements carry an
assigned `#hash` identity (`python3 core/checks/check.py --assign`). That assignment tool is not part of this
increment's scope, and the layout this run works in has no `core/checks/check.py`; **no identity is invented
here**. The statements below are therefore un-addressed prose, and the criteria the gate actually measures are
named in _Evidence_ and _Acceptance_.

## The statements

- **relay-config owns the answer to "which relays", by role, and nothing else.** It does not connect, does
  not query, does not publish and keeps no store of its own; `sdk/core/nostr-io` owns the wire and
  `sdk/core/event-store` owns the store.
- **The port is `RelayConfigPort`, declared once** in `ts/types.ts` and imported everywhere else. It is never
  re-minted.
- **Its members split three ways, and saying which is which IS the port.**
  - **Library-derivable** — `userRead`, `userWrite`, `dmRelays`, `role(...)`. Each is a thin adapter: a
    subscription on the injected store piped through the library's own model, validator or parser.
  - **Ours** — `instance(app|bug|cvm|zap)`, `outboxEnabled()`, `dmFallback()`, `setWriteRelay(url)`. The
    library models **another party's** relay lists and has no vocabulary for _this app's_ relays or for the
    NDK-outbox switch.
  - **The default layer** — `RelayDefaults`, the app's instance configuration carried across the SDK boundary
    **as data** (the boundary forbids importing `src/`).
- **Exactly one SDK module names `applesauce-common`** — this one, and only in `ts/adapter.ts`. The
  greppable check is total: `git grep -ln "applesauce-common" HEAD -- 'sdk/**' ':!*node_modules*'` names
  `sdk/core/relay-config` and nothing else.
- **`inboxes` is `read`; `outboxes` is `write`; `10050` keeps the word `dm`.** The rename happens **once**, at
  the model boundary, and `adapter.ts` is where the vendor's own words appear.
- **`dmRelays` returns `undefined` when no `10050` exists.** That is the library's own answer (its cast's
  `directMessageRelays$` offers no fallback), and it agrees with NIP-17's MUST: the DM target is the
  recipient's `10050` **or nothing**. **No `10002` is ever substituted** for a missing `10050`.
- **The parse is the library's.** `getRelaysFromList` reads the `relay` tags and
  `isValidDirectMessageRelaysList` / `isValidLookupRelayList` validate the list. The hand-rolled
  `parseNip17DmRelays` / `resolveNip17DmRelayListFromEvents` this architecture exists to delete are **not
  written** in this module.
- **`userRead` / `userWrite` are the library's `10002` mailboxes** (`MailboxesModel`), renamed. They answer
  an empty set when there is no `10002` — never a throw and never an invented relay.
- **`role(...)` carries a PER-ROLE cap, `MAX_READ_POOL = 12`**, the app's own token
  (`market-app/ts/relays.ts:44` @ `7ad658d4`), carried as our rule.
- **`instance('zap')` is additive, never a replacement.** It is the union of the injected dedicated zap
  relays, any instance-configured zap relays, and the app's read set —
  `resolveZapRelays` (`src/lib/relay-policy.ts:131-147` @ `7ad658d4`) reproduced as the SDK rule. _"ZAP_RELAYS
  is never dropped"_ is the rule, and an instance set treated as a replacement is the bug it closes.
- **`setWriteRelay(url)` is a configuration write, not a directed call.** It records the one relay this app
  writes to and dials nothing; a subsequent `instance('app')` leads with it (the app's own rule), otherwise
  the injected instance slots answer unchanged.
- **The port cannot dial.** Every vendor model it adapts is a **store subscription**
  (`applesauce-common`'s `models/relay-lists.js:11` — `events.replaceable(...)`). There is no pool, no relay
  handle and no wire verb anywhere in `ts/`; test 4 proves it with a pool spy that throws.
- **The store handle is structural** — `RelayStoreHandle = { modelStore(): IEventStore }`, the shape
  `sdk/core/event-store` (the previous increment) hands out. This module imports **no** sibling module, so it
  lands and rebases independently, and its consumer arrives later.
- **It is a spec with many implementations.** The TypeScript one in `ts/` is the first; the same port is
  satisfiable by another host, which declares its own stream type and adapts at its boundary.
- **Its import allow-list is stated so a reviewer can falsify it:** `./<module file>`,
  `applesauce-core[/…]`, `applesauce-common[/…]`, `nostr-tools[/…]`, `rxjs`, and `bun:test` (tests only).
  `evidence/run.sh` diffs it.
- **The stop conditions are stated:** a sentence in this spec that needs a pool, a socket, a second relay-list
  parser, or a `src/` import is an **architecture contradiction**.

## Evidence

`cd sdk/core/relay-config/ts && bun test` — the Tests column above is the obligation:

1. `dmRelays` answers from a seeded `10050`, and is `undefined` when absent.
2. `role('search')` answers from a seeded `10007` through `SearchRelaysModel` (and the other modelled roles
   through theirs).
3. `instance('zap')` returns the injected zap defaults, additively.
4. The port never dials: a pool spy that throws is untouched while a model is read.
5. `userRead`/`userWrite` are the `10002` mailboxes, renamed.
6. `role(...)` is capped per role at `MAX_READ_POOL`.
7. `setWriteRelay` is a configuration write, and the two switches answer the injected data.

**Break cases that turn them red**, one per case: (1) substitute the recipient's `10002` for a missing `10050`
→ the `undefined` case fails and NIP-17's MUST is violated; hand-roll the parse → the greppable-duplication
check fails; (2) wire the wrong model, or return `undefined` unconditionally → the seeded search relays are not
returned; (3) treat an instance zap set as a replacement → the injected `ZAP_RELAYS` floor disappears; (4) give
the port a pool, or have it dial to fill a role → the spy throws and `calls` is no longer zero; (5) parse the
`10002` with `getRelaysFromList` (the `relay`-tag parser) instead of `MailboxesModel` → the `r`-tagged
mailboxes are missed; (6) drop the cap → the 20-relay case answers 20; (7) make `setWriteRelay` a no-op → the
write relay does not lead `instance('app')`.

## Acceptance

- `grep -E '"applesauce-common": "6\.2\.0"' sdk/core/relay-config/ts/package.json` → **1 exact match** (the pin
  is exact, not a range).
- `git grep -ln "applesauce-common" HEAD -- 'sdk/**' ':!*node_modules*'` → **`sdk/core/relay-config` only**.
- `grep -n "applesauce" sdk/core/nostr-io/ts/types.ts` → **0** (unchanged).
- tests 1–7 pass.
- `git diff --stat 7ad658d4..HEAD` → **`sdk/core/relay-config/**` and nothing else\*\*.

**One measured caveat, named rather than smoothed over.** `bun test sdk/boundary.test.ts` (the SDK wall)
walks **every** `.ts` file under `sdk/` and does not exclude `node_modules`, so it flags
`node_modules/bun-types/*.d.ts` — whose _doc comments_ contain `import … from "react-dom/server"` — for **any**
module with an installed dependency store. Measured three ways on this increment: with
`sdk/core/relay-config/ts/node_modules` present it reports the four `bun-types` lines for this module; with a
**sibling's** store alone (`sdk/core/nostr-io/ts/node_modules`) it reports the same four lines for `nostr-io`;
with no install under `sdk/` it passes (`1 pass, 0 fail`). This increment's own sources contribute **no**
violation (the import allow-list is diffed in `evidence/01-build-and-tests.txt`, section 4). The fix is a
`node_modules` exclusion in `sdk/boundary.test.ts:15-26` — a file outside this increment's touch points, so it
is reported, not edited.

## Where the design documents and this spec differ

The packet's Contract is the binding version and it wins where the two disagree. Two places, named rather than
smoothed over:

- **`setWriteRelay(url)` returns `void` here**, where `architecture-applesauce.md:210` writes
  `setWriteRelay(url): RelayRoles`. The packet (`order-increments-sdk.md:184`) drops the return type; this
  module follows the packet and gives the call its observable effect through `instance('app')`.
- **`role('lookup')` needs the library's `isValidLookupRelayList`**, which the packet's one-line vendor-surface
  list does not name but its own Contract requires (`'favorite' | 'lookup'`): 6.2.0 ships a `10012`, `10007`
  and `10006` model but **no** `10086` model, so the lookup list is a `replaceable(10086, pubkey)`
  subscription validated by the library's own validator. No parse is hand-written for it.

## Not delivered

- **No consumer.** The DM path that reads `dmRelays` arrives in the next increment; this one lands
  self-contained.
- **No app migration.** `src/lib/relay-policy.ts` and `src/lib/nostr/io-applesauce.ts` are untouched — the
  app's own pool and stage-aware policy live on until the app migrates. The SDK's `relay-config` is the
  _SDK's_ answer; the two implementations coexist, and that cost is named in `apply-to-pr1412-sdk.md` §5.
- **No gift-wrap.** `applesauce-common`'s wrap primitives (`operations/gift-wrap.js` — `wrapSeal`) are for the
  DM path, not for this port; nothing here wraps anything.
