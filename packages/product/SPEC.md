# `@plebeian/product` — package spec

**Package version `0.1.0` · implements `browsing-explore-search/0.5.0-draft` §2 (data representation) and §5 (publishing rules).**

The product module: what a NIP-99 listing is, and how to ask for one.

## 1. Two responsibilities, deliberately one package

| Source                                                                                   | Job                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/event.ts`, `src/parse.ts`, `src/tagSchemas.ts`, `src/primitives.ts`, `src/types.ts` | Decide whether an untrusted kind-30402 event is a usable listing, and turn it into a typed view. **The single judgement point.**                                                                                   |
| `src/queries.ts`                                                                         | Build filters **as data** — `feedFilter`, `listingByCoordinateFilter`, `listingSearchFilter`, `collectionsIndexFilter`, `detailFiltersForListing`… and stop. Never executes a query, never imports a relay client. |

They were two packages (`product-event`, `product-query`) and were merged: no consumer uses one without the
other, so the split was on a technical seam rather than a consumer boundary. The maintainer called it too
granular (2026-09-22); the alignment review records it as drift D-2.

## 2. The rule that shapes it

**A component receives a validated value, never a raw event.** `parseListing` returns
`{ ok: true, value, problems }` or `{ ok: false, problems }` with **codes**, not messages. The application
breaks this today: `ProductCard` takes `product: NDKEvent` (`src/components/ProductCard.tsx:28`) and the
getters cast (`src/queries/products.tsx:544`), so nothing between the relay and the DOM validates.

## 3. Spec conformance, honestly stated

Two behaviour decisions were taken during the prototype that **the feature spec does not yet record**.
Until they are written back, this package implements a revision of §2 that has not been published —
recorded as drift D-1/D-9 in `ALIGNMENT.md`.

- **D7 — the currency rule.** Widened from `^[A-Z]{3}$` to `^[A-Za-z]{3,4}$`. NIP-99 says ISO 4217 _or
  ISO 4217-like_; live listings carry `SATS` and `USDC`. Largest single cause of live parse failure.
- **D8 — an absent `price`.** NIP-99 says SHOULD, Gamma says required, ~17 of 40 live listings omit it. It
  is now tolerated and **named** as a problem; a _malformed_ price is still refused, because a stated price
  must never silently vanish.

Measured against 68 live kind-30402 events: the previous schema accepted **1**; this parser accepts **66**
(the two rejections have no `title`). Recorded as a hypothesis for why the old schema was never wired in —
the history does not say so.

## 4. What it must not contain

No UI, no framework, no network, no relay client, no store, no import from `src/`, and no import of an
implementation. `zod` and `@plebeian/contract` are its only dependencies.
