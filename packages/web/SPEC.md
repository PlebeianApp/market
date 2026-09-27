# `@plebeian/web` — implementation spec

**Package version `0.1.0` · satisfies `contract/0.1.0-draft` · trust boundary `in-process`.**

The regular-web implementation of the contract, over `nostr-tools`. This is the **higher-trust boundary**
(`CONTRACT.md` §4): it runs in-process with the platform's own capabilities, which is what the web app and
the CMS both need. It advertises that fact through its descriptor rather than leaving a reader to infer it.

## 1. Mapping

| Contract       | Here                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| `nostr.read`   | `SimplePool.querySync`, **one filter per request**, results merged and deduped by id |
| `nostr.stream` | `SimplePool.subscribeMany`                                                           |
| `resource`     | the host's `resolveResource`, or the URL unchanged outside a browser                 |
| `theme`        | the host's tokens, or the contract's `TOKEN_FLOOR`                                   |
| `config`       | the host's record; `onChanged` supported                                             |
| `link.open`    | `window.open(…, 'noopener,noreferrer')`                                              |
| relay choice   | `options.relays`; search relays from `options.searchRelays ?? DEFAULT_SEARCH_RELAYS` |

## 2. Two things worth knowing

**`querySync` takes one filter, not an array.** The contract's `read` takes a list that is OR-ed, so each
filter is queried separately. Passing the array straight through produces a malformed REQ that relays
ignore — which surfaces as a _truthful_ "no results" and hides the bug entirely. Found the hard way while
building the explorer.

**Failure mapping is the interesting part.** A timeout, a transport error and "no relays configured" are
three different codes, and none of them is an empty list. The application currently collapses relay
failures into `[]` with a `console.warn` (`src/queries/products.tsx:137-139`), making an outage
indistinguishable from "nothing found".

## 3. Known limitation

It talks to `nostr-tools` directly rather than wrapping the application's own port (`src/lib/nostr/io.ts`),
because a package must not import from `src/` and the explorer has to prove it can run without the app. In
production this implementation would wrap the port, so the ADR-0002 migration is preserved rather than
forked. Recorded as decision D10.

## 4. What it must not contain

No module logic, no UI, and no policy values — relay sets and tokens are inputs or contract defaults, never
literals. It imports `@plebeian/contract` and nothing else shared: implementations do not share code with
each other, only the contract.
