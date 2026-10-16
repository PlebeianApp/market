# ts — the nostr-io module's first implementation (TypeScript)

This directory holds the **TypeScript implementation** of the module whose spec is `../nostr-io.md`. A directory
is a spec and a spec has many implementations; this is the first one, and it is one host's realisation — the
same contract is satisfiable by nostrify's `NPool` and by a Go relay host, and neither exists yet.

**It is not a spec.** `../nostr-io.md` is the spec; this file is an inventory, so that a reader can see what the
directory contains and the check routine can account for the module directory that holds it. This file declares
no statements, carries no identity of its own, and must not grow one — a statement here would be a statement of
the `nostr-io` module, which already has a document.

**What this implementation is, and is not.** It is the **wire**: connect, query, subscribe, publish, count and
close, over `applesauce-relay` 6.2.1's pool, with the relay set **injected per call** and the wire's semantics —
EOSE, retries, reconnection, connection health — under the module's own **policy** while the **mechanism** is the
transport's (amended 2026-09-29: this file reads "owned here" for retries and reconnection; the retry counts and
backoffs are the vendor's defaults and are stated as such in `../nostr-io.md`'s amendment under `#e574c2`). It
keeps **no store and no cache**: the transport port's verbs are the wire's own, `publish` performs no local
write, and `query` reports the boundary it reached rather than inventing completeness. The ordering of an
answer, the merge, the write-back policy and `complete` are the composition's, and are not this module's rule.
It also declares its **own bounds**: `MAX_EVENTS_PER_READ` is the stated ceiling on one read, `deadlineMs` is a
wall-clock budget on the whole read, and every failure path reaches a caller as a value from the reason
vocabulary on whatever channel the operation has.

## Inventory

Every file at this level, and nothing else, is listed below. The list is mechanical: `../evidence/run.sh`
extracts the first backticked name from each bullet and diffs it against `find . -maxdepth 1 -type f`, so the
two must be equal for the evidence to be green. `bun.lock` is named here **iff it exists** — the install is this
module's own, and a lockfile is a source artifact rather than a build output.

- `index.ts` — the contract entry: the factory `createNostrIo`, the typed refusal `RelaySeamError`, the adopted
  shape's normaliser `toUpstreamPool`, the stated ceiling `MAX_EVENTS_PER_READ`, and the seam's types. Exactly
  the module MD's `contract.exports` and `contract.types`, and nothing else — the evidence diffs the three lists.
  Every failure path is mapped here: the policy is read inside its operation's guard, a relay refusal mid-read is
  carried as a value on the read's `failures`, the live channels are typed on every path, and the read is bounded
  by the stated ceiling and by the caller's wall-clock deadline.
- `types.ts` — the vocabulary: raw `nostr-tools` events as the event view, NIP-01 filters, plain relay URLs, the
  adopted `NostrRequest`/`UpstreamPool` shapes, the reason vocabulary, the ack and outcome types, the
  subscription handle, and the transport port (`PoolPort`) both backends implement — including what a pool may
  rely on from the seam: a unique target set and no bare `Error` at its boundary. `WireResult` carries the read's
  failure channel (`failures`) beside `events` and `eose`.
- `errors.ts` — the typed rejection: one class carrying the contract's `RelayReason`. Every refusal path raises
  it, and the module throws nothing else.
- `pool.ts` — the pool contract's shapes and the adapter boundary: `toUpstreamPool` normalises both arms of the
  adopted union into one request, `toFilterArray` is NIP-01's one-or-many, `mapClosedReason` is the one place a
  relay's own refusal text becomes the contract's reason, `uniqueRelays` is the unique target set, and
  `normalizeRelayUrl` is the **one** identity predicate the seam compares under (health, the publish ack match,
  and the read's boundary count) — never a second copy, and never applied to what the host spelled.
- `relay-adapter.ts` — the **first implementation**: `applesauce-relay` 6.2.1's `RelayPool` behind the transport
  port, driving the pool's raw `req` so no deduplicating store is bound, and mapping the vendor's own messages
  to the seam's nouns. It carries a relay's **own** refusal text through the one reason mapping (the vendor turns
  a NIP-01-prefixed `CLOSED` into a thrown error and then into an `ERROR` message, so that error's own reason is
  what it reads), and it reads a relay's health under the key the pool files the relay by rather than under the
  spelling the policy used. Its read's boundary gate counts the **normalised-unique** target set while the pool is
  still handed the host's array unchanged, and its `count` takes the **first** emission of the vendor's COUNT
  stream (`firstValueFrom`) because that stream — rooted in a `BehaviorSubject` — never completes.
- `harness.ts` — the **host side** of every port, for the tests: signed events (keys generated at run time), a
  fake pool that records every call and throws from every method, a recording-and-answering hand-written pool, a
  recording relay policy and one that cannot answer, the two conformance backends (each recording the relay sets
  it was handed), and bounded guards for a stream (`collect()`) and for a promise (`within()`). The vendor stub
  models every behaviour the real `applesauce-relay` performs before the adapter sees a message: a prefixed
  `CLOSED` becoming an `ERROR` message, a relay named twice answering twice, every frame and every publish
  response carrying the relay's **own normalised identity** rather than the host's spelling, and the group's
  request and COUNT streams **never completing** (so the adapter's `takeWhile` ends a read and `count` takes the
  first emission) — the four the repair's own code depends on. Not exported by the contract; nothing in the
  implementation imports it.
- `conformance.test.ts` — the per-path cases (`query`, `subscribe`, `publish`, `count`, `connect`) and the
  multi-backend case, run over the vendor adapter and over the hand-written pool — plus the cases the two repairs
  added: a refusal mid-read (both backends, the same outcome object), a relay's own NIP-01 refusal prefix on
  both paths, health read under the pool's own key with a bad URL refused, `closeOnEose` after the events that
  preceded it, a relay URL named twice, the stated ceiling, a dripping wire against the wall-clock deadline, a
  count that settles against a non-completing COUNT stream and sums the relays' own indices, an ack matched
  under the pool's own identity while the caller keeps the host's spelling, and a two-spelling target whose read
  settles with the host's set reaching the pool unrewritten.
- `invariants.test.ts` — the seam's own invariants, one named case each: the store-free proof, the reason
  vocabulary, the injected policy, and the absence of global state — plus the two the repair added: a pool whose
  own live channels error reaching the caller as a typed refusal, and a host policy that cannot answer refusing
  every operation without reaching the wire.
- `package.json` — the module's own dependency store and its three commands (`test`, `typecheck`, `evidence`).
  `applesauce-relay` is pinned exactly at 6.2.1, `nostr-tools` is the range that package itself declares, and
  `applesauce-core` appears in **neither** dependency list: the seam depends on the transport, not the store.
- `tsconfig.json` — the module's own compiler configuration, so a type error is the module's own finding. It is
  `event-store/ts/tsconfig.json` verbatim — strict, `noUnusedLocals`, `verbatimModuleSyntax`, `noEmit` — and it
  includes `**/*.ts`.
- `bun.lock` — the resolved dependency set, written by `bun install`; committed because a lockfile is a source
  artifact, not a build output.
- `ts.md` — this file.

## Running it

```
cd nostr-io/ts
bun install                      # the module's own dependency store
bun test                         # the module's own suite
bun run typecheck                # tsc --noEmit, the module's own compiler configuration
bash ../evidence/run.sh          > ../evidence/01-build-and-tests.txt
python3 ../evidence/falsify.py   > ../evidence/02-invariant-falsification.txt
```

**The red half, by hand.** `evidence/04-before-the-repair.txt` and `evidence/05-before-the-repair.txt` are
**one-off, serialized transcripts**, not script output: no script regenerates them, because
`core/checks/evidence.py` reports a hard finding for any evidence script that writes into the tree, and those
findings are a ratchet. The procedure is a copy/restore, run from `nostr-io/ts` with the tree otherwise quiet:
the current files are copied aside, the implementation files are restored from the frozen commit, the suite is
run and redirected into the transcript, and the copies are put back:

```
cd nostr-io/ts
mkdir -p /tmp/nostr-io-fixed && cp index.ts types.ts pool.ts relay-adapter.ts /tmp/nostr-io-fixed/
for f in index.ts types.ts pool.ts relay-adapter.ts; do git -C <assembly> show <frozen-sha>:nostr-io/ts/$f > $f; done
bun test > ../evidence/<the transcript>.txt 2>&1
cp /tmp/nostr-io-fixed/*.ts .
bun test && bun run typecheck      # the tree is as it was: the suite is green again
```

`04` is the red half of the red-team repair (`<frozen-sha>` = `69ad15c`, four implementation files, ten cases
failing); `05` is the red half of the D1/D12 repair (`<frozen-sha>` = `6727ead`, `relay-adapter.ts` and
`index.ts` only, six cases failing). Neither transcript is edited by hand and neither is regenerated by a
script; a third repair that needs one changes that decision before it writes a red-half script.

Nothing above needs the market, and nothing above writes to it. `bun` is not on this environment's `PATH`; from
elsewhere in the assembly, spell it `$HOME/.bun/bin/bun`. The two evidence commands **redirect** because the
scripts print: a script that writes its own capture cannot be run twice, and the second run would overwrite what
the first one proved. Run `falsify.py` on its own — for the length of each mutation the tree is deliberately
broken.
