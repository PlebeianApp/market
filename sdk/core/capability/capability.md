---
module: capability
kind: module
schema: architecture
applies: core@0.1
inherits: []
implements:
  - '#32b372'
opt-out: []
test-support:
  - ts/*.test.ts
levels:
  objective: present
  technical-spec: present — the token, the runtime id, and the single binding point between them
  implementation: present — TypeScript in ts/, dependency-free
  tests: present — one file, run by `bun test`
contract:
  entry: ts/index.ts
  operations: [capabilityToken, capabilityId]
  exports: [capabilityToken, capabilityId]
  types: [CapabilityId, CapabilityToken]
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
    needs: []
access:
  group: m_capability
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - signer — mints its capability tokens through this binding rather than declaring its own
  - ui — consumes the same binding; it must not define a second one
source:
  note: |
    Moved here from the retrofit's `ui/ts/index.ts`, where the `ui` module owned it. The rule id
    (`#32b372`), the symbol names and the bodies are unchanged — this is a move, not a rewrite.

    It moved for two reasons. First, `ui/` exists in the target repository and belongs to another
    author, so the token had no reachable home there while `signer` needed it. Second, and the
    reason that matters: a capability token binds an **interface** to a **runtime id**, which is a
    contract concern rather than a rendering one — the module that owns it should be the layer every
    consumer can reach without reaching through a surface.
---

# capability — the one place an interface binds to a runtime id

**The problem this module removes.** A capability is asked for by id at run time, but its _interface_
only exists at compile time. If each call site performs its own cast, the binding between the two lives
at every call site and is wrong wherever a cast is careless. This module exists so the binding happens
**once**: a module declares a token beside the interface it names, and a consumer asks for the token and
receives `C` — never `unknown`, and never through a cast of its own.

## The declarations

- **`CapabilityId`** — a capability's stable runtime id. An **open** string: the contract states no rule
  about it, and the app must not learn a plugin's name, only the id a token was minted with.
- **`CapabilityToken<C>`** — the runtime id **and** the interface it satisfies. It carries a phantom
  marker in `C` that is never read at run time and never present in a value: it exists so that two tokens
  with the same id but a different interface are different _types_, which is what makes the token
  genuinely bind its interface rather than merely name it.
- **`capabilityToken<C>(id, name)`** — mint a token. This is the **single cast the model permits**, and
  the declaring module supplies the type parameter, so the binding holds by construction.
- **`capabilityId(token)`** — the runtime id of a token, for a manifest read or the wording of a refusal.

## What this module refuses

- **A second way to bind an interface to an id.** If a module needs a capability it does not own, it
  consumes the owner's token; it does not mint a token for an interface it does not own.
- **Reading the phantom marker.** It is a type-level marker; any code that touches it at run time is
  reading something the contract says is never present.
