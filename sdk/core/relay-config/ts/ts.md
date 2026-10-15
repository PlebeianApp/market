# ts — the relay-config module's first implementation (TypeScript)

This directory holds the **TypeScript implementation** of the module whose spec is `../relay-config.md`. A
directory is a spec and a spec has many implementations; this is the first one, and it is one host's
realisation — the same port is satisfiable by another host, which types its stream as its own equivalent and
adapts at its boundary.

**It is not a spec.** `../relay-config.md` is the spec; this file is an inventory, so that a reader can see
what the directory contains and the check routine can account for the module directory that holds it. This
file declares no statements and carries no identity of its own.

**What this implementation is, and is not.** It is the **answer to "which relays", by role**: `RelayConfigPort`
over `applesauce-core`'s `MailboxesModel` and `applesauce-common`'s relay-list models, validators and
`getRelaysFromList`, with the app's instance config injected as the default layer and the app's own rules
(`instance`, the two switches, the one configuration write, the per-role cap) kept ours. It keeps **no pool and
no socket**: every model it adapts is a store subscription, so the port cannot dial. The wire belongs to
`sdk/core/nostr-io` and the store to `sdk/core/event-store`; the store handle here is the **structural** shape
`{ modelStore(): IEventStore }`, so this module imports no sibling module.

**The vendor surface is one file.** `adapter.ts` is the only file that names `applesauce-common` (and the only
file in the whole SDK that does). Everything the port answers from the library is in it.

## Inventory

Every file at this level, and nothing else, is listed below. The list is mechanical: `../evidence/run.sh`
extracts the first backticked name from each bullet and diffs it against `find . -maxdepth 1 -type f`, so the
two must be equal for the evidence to be green. `bun.lock` is named here **iff it exists** — the install is this
module's own, and a lockfile is a source artifact rather than a build output.

- `index.ts` — the contract entry: `createRelayConfig`, the stated cap `MAX_READ_POOL`, the two kind constants
  the adapter re-exports, and the port's types. Exactly the module MD's `contract.exports` and `contract.types`,
  and nothing else — the evidence diffs the three lists. The factory wires the injected store handle and the
  injected default layer, holds **no** pool, keeps the one piece of mutable state (`setWriteRelay`'s write
  relay), and maps each library-derived member onto the adapter.
- `types.ts` — the vocabulary: `RelayConfigPort` (declared **once** here), the role unions (`RelayRole` for the
  library's roles, `InstanceRole` for ours), `DmFallback`, the structural `RelayStoreHandle`, and the injected
  `RelayDefaults`. Nothing here names a vendor symbol — not `MailboxesModel`, not `applesauce-common`.
- `adapter.ts` — the **vendor surface, one file**: `MailboxesModel` (`applesauce-core/models`),
  `FavoriteRelaysModel` / `SearchRelaysModel` / `BlockedRelaysModel` (`applesauce-common/models`),
  `isValidDirectMessageRelaysList` / `isValidLookupRelayList` (`applesauce-common/helpers/relay-list`) and
  `getRelaysFromList` (`applesauce-common/helpers/lists`). It carries the two kind constants
  (`DM_RELAYS_KIND` = 10050, `LOOKUP_RELAYS_KIND` = 10086) and the three readers the port subscribes.
- `harness.ts` — the **host side** of the port, for the tests: a real vendor `EventStore`, signed events to seed
  it, the store handle of the exact structural shape, the app's default layer as data, a one-value reader, and a
  **pool spy that throws from every method**. It is not part of the implementation's behaviour.
- `relay-config.test.ts` — the module's evidence, as 7 cases with their break cases stated. Four are the
  increment's named obligations; the rest cover the port's other contract members the same gate exercises.
- `package.json` — the module-local manifest: `applesauce-common` **6.2.0** and `applesauce-core` **6.2.0**,
  both pinned **exactly**, plus `rxjs` 7.8.2 and `nostr-tools` ~2.19. Nothing is added to the root manifest.
- `tsconfig.json` — the strict compiler configuration the siblings carry, `noEmit`.
- `bun.lock` — this module's own install lockfile.
- `ts.md` — this inventory.
