---
module: dm
kind: module
schema: architecture
applies: core@0.1
inherits: [platform-core]
implements: []
opt-out: []
test-support: ['ts/harness.ts', 'ts/*.test.ts']
levels:
  objective: present
  technical-spec: present — the two paths (write, read) over the library's gift-wrap primitives, and the relay targets read from the relay-config port
  implementation: present — TypeScript in ts/ (the first implementation, over `applesauce-common` 6.2.0 and `applesauce-core` 6.2.0; the spec was written first)
  tests: present — 4 cases in 1 file, run by `bun test`, with this document's evidence obligations stated as criteria
contract:
  entry: ts/index.ts
  operations: [wrapDm, unwrapDm, dmRelaySourceFromEvents, resolveDmRelayTargets, giftWrapSeal]
  exports: [DM_GIFT_WRAP_KIND, DM_RELAYS_KIND, DM_SEAL_KIND, dmRelaySourceFromEvents, giftWrapSeal, resolveDmRelayTargets, unwrapDm, wrapDm]
  types: [DmPublishPort, DmReadResult, DmRelayListEvent, DmRelaySource, DmRelayTargets, DmRumor, DmSignableEvent, DmSigner, DmWriteResult]
implementations:
  - id: ts
    lang: typescript
    dir: ts
    entry: ts/index.ts
    package: null
    install: [bun, install]
    build: []
    test: [bun, test]
    typecheck: [bun, run, typecheck]
    needs: [relay-config]
access:
  group: m_dm
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - sdk/commerce/messaging/** — the NIP-17 order path (publish, read, transport, private order message); it declares its dependencies structurally and calls this component instead of touching the library or a relay list itself
source:
  adr: null
  replaced: the hand-rolled NIP-17/NIP-59 logic our modules carried (`sdk/core/nostr/nip17.ts`, `nip59.ts`, `nip17Relays.ts`). Those files are NOT deleted in this scope; this component is the replacement the commerce path re-points onto, and the deletion is a later pass that depends on the measured consumer count.
  direction: the maintainer's correction — the DM behaviour is "an additional small set of logic inside of our setup that is specifically set to handle DM writes and DM reads, according to the user's DM read relays (and fetches the other's write relays before publishing)". A component of ours, over `applesauce-common`'s primitives, with the targets answered by `sdk/core/relay-config`.
webui: []
---

# dm — the small DM component: NIP-17 writes and reads over the library, targets from relay-config

**The job, in one sentence** — own the DM behaviour: turn a rumor into the two NIP-59 gift wraps NIP-17 requires
(write), turn a gift wrap back into its rumor (read), and resolve the DM relay targets from the relay-config
port — re-writing none of what the library already does.

This document is the **spec**. `ts/` holds the first implementation — TypeScript, over `applesauce-common` 6.2.0
and `applesauce-core` 6.2.0, which supply the seal, the wrap and the unwrap — and `evidence/` holds the commands
that regenerate what this document claims.

## The statements

- **dm owns the DM behaviour and nothing else.** It holds no pool, no socket, no relay handle, no NIP-44
  implementation, no `relay`-tag parser and no private key. It composes the library's primitives and reads the
  relay-config port.
- **The write path is the library's.** `sealRumor(pubkey, signer)` encrypts the rumor (NIP-44) and signs the
  kind-13 seal; `wrapSeal(pubkey, opts)` mints its **own ephemeral key** and signs the kind-1059 gift wrap. The
  two operations are composed by `eventPipe`/`pipe` (`applesauce-core/helpers/pipeline`). We write neither the
  seal nor the wrap nor the NIP-44 call.
- **One send produces two wraps, one per direction.** The recipient-facing wrap is sealed and wrapped to the
  recipient's pubkey; the self-wrap is sealed and wrapped to the **sender's own** pubkey, so the sender can read
  back what they sent. Each wrap mints a fresh ephemeral author inside the library — the ephemeral-author
  requirement is satisfied by the primitive, per wrap, not by us.
- **Both wraps carry the same rumor.** The rumor's canonical `id` is computed once (by the caller's rumor
  builder) and is identical across the two wraps; the component never re-builds it per direction.
- **The read path is the library's.** `unlockGiftWrap(gift, signer)` decrypts the gift wrap through its seal
  down to the unsigned rumor, verifying the seal's signature and that the seal author matches the rumor author;
  `getGiftWrapSeal(gift)` hands the seal back. We write no unwrap.
- **The relay targets come from the relay-config port, by kind `10050`.** The component reads `dmRelays(pubkey)`
  and no other member. It does not parse the `relay` tags and does not select the newest list event: relay-config
  answers over the library's `replaceable(10050, pubkey)`, its validator and its parser.
- **`undefined` is the answer when there is no `10050`, and no `10002` is ever substituted.** This is the
  library's own answer and NIP-17's MUST; the target is **not ready** then, and the caller must not publish.
- **`ready` requires BOTH sides.** The recipient wrap needs the **recipient's** `10050` (where the recipient
  reads) and the self-wrap needs the **sender's** own `10050`. An empty list on either side is not ready.
- **Relay assumption, stated because AGENTS.md requires it (no new relay assumption without code, tests and
  documentation).** The only relay behaviour this component introduces is: _a DM targets kind `10050` and nothing
  else, and `10002` is never a fallback for it_. It is implemented in `relay-source.ts` (a `dmRelays` read) and
  proven by test 4 (a recipient with a `10002` and no `10050` answers `undefined` and is not ready).
- **Pooling assumption, stated likewise.** The component opens **no pool and no socket**. It seeds the events it
  was handed into a plain `applesauce-core` `EventStore` and lets relay-config read that store; the store is a
  subscription target, never a wire. `relay-source.ts` names no `WebSocket`, `fetch`, or URL constructor.
- **The signer is injected, never a key.** The component takes a `DmSigner` (our host port's shape: `getPublicKey`,
  a bare-signature `signEvent`, and NIP-44 `encrypt`/`decrypt`). `adapter.ts` is the **one** seam that assembles
  the library's full signed-event shape around that bare signature; it is a port adapter, not NIP-59 logic.
- **The publish target is injected, and it is explicit.** `DmPublishPort` (declared here) is the shape the caller
  hands the wraps to; it carries the resolved relay set as an argument, so a DM write can never silently widen
  egress. The kinds `1059`, `13` and `10050` are exported as `DM_GIFT_WRAP_KIND` / `DM_SEAL_KIND` / `DM_RELAYS_KIND`
  so a consumer names them from here instead of a retired core file.
- **The dependencies are declared structurally where they can be.** `DmSigner` and `DmRelaySource` are declared in
  `ts/types.ts`; the component imports **no sibling module's types**. It imports relay-config's factory
  (`createRelayConfig`) — a value, the documented consumer edge — and nothing else from a sibling.
- **Its import allow-list is stated so a reviewer can falsify it:** `./<module file>`, `../../relay-config/ts/index.ts`,
  `applesauce-core[/…]`, `applesauce-common[/…]`, `nostr-tools[/…]`, `rxjs`, and `bun:test` (tests only).
- **The stop conditions are stated:** a sentence in this spec that needs a pool, a socket, a second `10050`
  parser, a NIP-44 call of ours, or a private key in a signature is an **architecture contradiction**.

## Capability gaps, named rather than smoothed over

- **The relay-target report is narrower than the old `Nip17RelayTargetsResult`.** relay-config answers relay URLs
  (`string[] | undefined`) and no more: it does not expose a per-side `status` enum (`ready`/`missing`/`empty`),
  the source `10050` **event**, or the pubkey it resolved for. The old hand-rolled resolver carried all of those.
  This component answers only `ready: boolean` plus the two relay sets. A consumer that needs the source event or
  the status classification must be re-pointed or must keep its own report; **re-deriving them here would be the
  `10050` resolution this component exists to delete**, so it is reported, not hand-rolled.
- **The library randomises the seal and gift-wrap `created_at`.** `sealRumor`/`wrapSeal` stamp `unixNow() - rand(1h)`;
  neither primitive accepts an injected timestamp. The old code let a caller pin `createdAt`. A caller that
  relied on a deterministic wrap timestamp loses that here; the **rumor's** `created_at` is still the caller's,
  which is what ordered reads sort on.

## Evidence

`cd sdk/core/dm/ts && bun test` — the Tests column above is the obligation:

1. `wrapDm` produces two kind-1059 wraps with **distinct ephemeral authors**, neither equal to the real signer key.
2. Both wraps carry the **same rumor id**, and `unwrapDm` round-trips the rumor on both sides.
3. `resolveDmRelayTargets` reads `dmRelays` for both sides from a seeded `10050`, and `ready` is true.
4. A recipient with a `10002` and **no `10050`** answers `undefined` and is **not ready** — no `10002` fallback.

**Break cases that turn them red**, one per case: (1) reuse one wrap for both directions, or sign with the real
key → the pubkeys stop being distinct / stop differing from the signer; (2) re-build the rumor per direction →
the ids diverge; (3) read a role other than `dmRelays`, or treat one missing side as ready → the targets fail;
(4) substitute the recipient's `10002` read set for a missing `10050` → `undefined` becomes a relay list and
NIP-17's MUST is violated.

## Acceptance

- `grep -E '"applesauce-common": "6\.2\.0"' sdk/core/dm/ts/package.json` → **1 exact match** (the pin is exact).
- `grep -E '"applesauce-core": "6\.2\.0"' sdk/core/dm/ts/package.json` → **1 exact match**.
- `cd sdk/core/dm/ts && bun test` → **4 pass, 0 fail**; `bun run typecheck` → exit 0.
- tests 1–4 pass.
- `git diff --stat 6208861b..HEAD` names `sdk/core/dm/**` for this step and nothing else.

## Not delivered

- **No deletion of `sdk/core/nostr/**`.** `nip17.ts`, `nip59.ts`and`nip17Relays.ts` survive; their remaining
  consumers are measured in the repoint step and decide whether they can be deleted.
- **No relay-config change.** The port is read, never edited.
