# ts — the signer module's first implementation (TypeScript)

This directory holds the **TypeScript implementation** of the module whose spec is `../signer.md`. A directory
is a spec and a spec has many implementations; this is the first one, and it is one host's realisation — the
Angular, Rust and Flutter implementations the maintainer named are the others, and none of them exists yet.

**It is not a spec.** `../signer.md` is the spec; this file is an inventory, so that a reader can see what the
directory contains and the check routine can account for the module directory that holds it. This file declares
no statements, carries no identity of its own, and must not grow one — a statement here would be a statement of
the `signer` module, which already has a document.

## Inventory

Every file at this level, and nothing else, is listed below. The list is mechanical: `evidence/run.sh` extracts
the first filename from each bullet and diffs it against `find signer/ts -maxdepth 1 -type f | sort`, so the two
must be equal for the evidence to be green.

- `index.ts` — the contract entry: `createSignerSession`, `createSignerFromKey`, the thirteen operations as the
  members of `SignerSession`, the guards, the typed refusals, the record constants and the spec's types.
- `types.ts` — the vocabulary: the protocol shapes (`EventTemplate`, `NostrEvent`, declared here rather than
  borrowed), the capability seam, the session states and snapshots, the ports (storage, transport, clock, crypto,
  extension), the settings and the start/restore inputs. One contract type names the implementation's observable
  library (`#07df21`'s named exception), and the port documentation states that a port's own error text is
  observed.
- `errors.ts` — the typed refusals. Every fail-closed path raises one of these, including a **port** that
  failed (`PortError`, the host's own message kept as its cause) and the persisted record's rules, which carry a
  `code` from `SessionVaultCode` naming which rule fired.
- `capability.ts` — the capability guards, the gate applied where a capability is **handed out** (`gateCapability`
  — the other half of the allow-list, without which `currentSigner()` bypasses I4) and the identity binding
  (`bindIdentity`), which is the module's single implementation of I3.
- `lanes.ts` — the four lane builders: the injected NIP-07 extension, the local key, the NIP-49 session with its
  locked guard, and the NIP-46 capability wrapper's helpers.
- `nip46.ts` — the NIP-46 lanes: the strict bind (I1), the deadline wrapper over the injected clock, the
  client-initiated and bunker entry points, and rehydration from a session token.
- `uri.ts` — the `nostrconnect://` seam: the `secret` param and the refusal of a legacy `token`-only URI.
- `vault.ts` — the encrypted record: the envelope, the iteration floor (I5), and the read-once plaintext
  migration.
- `session.ts` — the session: the thirteen operations over the state machine (`ALLOWED` is the table the spec
  and §7 are diffed against), the capability set, the attachment, the guarded port calls and the persisted
  record. A failed lane runs its own teardown, and an attempt still in flight cannot activate a session that
  was already ended.
- `harness.ts` — the **host** side of every port, for the tests: an in-memory store, a manual clock, a
  WebCrypto-backed crypto port, a relay transport and an in-process remote-signer emulator. Not exported by the
  contract; nothing in the implementation imports it.
- `session.test.ts` — the state machine, the reads and the refusals, through the contract.
- `invariants.test.ts` — I1–I5, one named case each where the module can prove one on its own.
- `vault.test.ts` — I5's unit cases: the envelope, the floor, the read-once migration.
- `nip46.test.ts` — the injected environment: transport and clock refusals, deadlines, the subscription
  lifecycle, the identity cache.
- `nostr-connect-uri.test.ts` — the `nostrconnect://` seam, harvested case for case.
- `package.json` — the module's own dependency store and its commands (`test`, `typecheck`, `evidence`).
- `tsconfig.json` — the module's own compiler configuration, so a type error is the module's own finding.
- `bun.lock` — the resolved dependency set, written by `bun install`; committed because a lockfile is a source
  artifact, not a build output.
- `ts.md` — this file.

## Running it

```
cd signer/ts
bun install                     # the module's own dependency store
bun test                        # the module's own suite
bun run typecheck               # tsc --noEmit, the module's own compiler configuration
bash ../evidence/run.sh         # regenerates ../evidence/01-build-and-tests.txt (and runs transitions.py in it)
python3 ../evidence/transitions.py   # the state machine's table: the spec, §7 and the code, diffed
python3 ../evidence/falsify.py  # regenerates ../evidence/02-invariant-falsification.txt
```

Nothing above needs the market, and nothing above writes to it.
