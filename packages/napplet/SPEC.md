# `@plebeian/napplet` — implementation spec

**Package version `0.1.0` · satisfies `contract/0.1.0-draft` · trust boundary `napplet`.**

The sandboxed implementation of the contract, over the capability object a NIP-5D host injects
(`window.napplet`). The **lower-trust boundary**: no keys, no network, no durable storage (`CONTRACT.md`
§4). Identity is `(dTag, aggregateHash)`, computed by the runtime, and the grant is kind-scoped.

This is the package that proves the architecture's central claim: the components do not know which
implementation they are running under. It maps onto `ModuleEnvironment` and nothing above it changes.

## 1. Mapping, and why each one exists

| Contract       | Here                              | Why                                                                                                                             |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `nostr.read`   | `outbox.query`                    | The **shell** chooses relays; the napplet has no network (`connect-src 'none'`), so relay choice is not expressible here at all |
| `nostr.stream` | `outbox.subscribe`                | Absent subscription degrades to a no-op rather than throwing                                                                    |
| `resource`     | `resource.bytes` → object URL     | `img-src data: blob:` blocks direct `https:` images, so this is **the only channel** an image can reach the frame               |
| `theme`        | `theme.get` / `theme.changed`     | The host's token set; the contract's floor is only a last resort                                                                |
| `config`       | `config.get` / `config.subscribe` | The shell's own preferences store                                                                                               |
| `link.open`    | `link.open`                       | A sandboxed frame must not navigate itself                                                                                      |

The runtime is typed **structurally**, never imported: this package must not depend on one shell's SDK.

## 2. Known gap — O1, recorded rather than hidden

`config.get` is **synchronous** in the contract and **asynchronous** in a sandbox (it is a message
round-trip). This implementation therefore returns `undefined`, which means a sandboxed surface cannot read
the viewer's NSFW preference mid-render and must resolve it once at boot and hold it.

That is a real interface gap, not a mapping detail, and it has a test that pins the current behaviour so
the gap cannot quietly change shape. `NAPPLET_CONFIG_IS_ASYNC` exists to make it greppable.

## 3. What it must not contain

No module logic, no UI, no relay URLs, no token literals, no import of another implementation. It depends on
`@plebeian/contract` and nothing else shared.

## 4. Not yet true

This is a **binding**, not an enforced sandbox. The explorer's "sandbox" projection is a stub that models the
capability object; the properties above (no keys, no network, no durable storage) are modelled, not enforced
by a browser. What enforces them in production is the CSP and the shell, not this file — see
`ALIGNMENT.md` §D-6.
