# Package prototype — decisions and evidence

> **Superseded in part, 2026-09-22.** This records decisions as they were taken while building the first
> prototype. The structure has since been restructured to the anatomy in `packages/CONTRACT.md` and
> `packages/MODULARIZATION.md`, and the decisions that are **specification** rather than rationale now live
> in the specs — D7 and D8 in particular belong in `browsing-explore-search.md` §2.3/§3.2 and are not there
> yet (drift D-1/D-9 in `packages/ALIGNMENT.md`). Where this document and a spec disagree, **the spec wins**;
> where this document records a decision the specs do not yet carry, that is a gap to close, not a source of
> truth.
>
> Package names in the text below are the names at `91e55a23`: `product-event` + `product-query` are now
> `@plebeian/product`; `browse-ui` + `browse-filter` are now `@plebeian/browse`; `nostr-access` is now
> `@plebeian/contract` (the interface) plus `@plebeian/web` and `@plebeian/napplet` (the implementations).

**2026-09-22 · branch `feat/browse-packages` · base `0a48b028` (`auctions`)**

This records every decision taken while building the first working prototype of the browsing packages,
plus the evidence behind the ones that were driven by data rather than judgement. It exists because the
brief was "take decisions on your own, but record them for later review" — so each entry says what was
decided, why, and what would reverse it.

Scope: the **NIP-99 / Gamma browsing feature**, realised as packages, components and three
projections. The application's own source (`src/`) is **not modified** — see D12.

---

## The headline finding

The existing `ProductListingSchema` — a dead export, defined and imported nowhere — was measured
against **68 live kind-30402 events** from three public relays:

- **old schema: 1/68 parsed (1.5%).**
- **new parser: 66/68 parsed (97%)**, 18 of them carrying tolerated, named problems.
- The only two rejections are listings with **no `title` tag** — a legitimate spec-required failure,
  since a card cannot be rendered without one.

It rejects real listings for three separable reasons, each now a decision below: a currency rule that
forbids `SATS` (D7), a missing `price` treated as fatal (D8), and a single `z.union` over all tag
shapes that makes **any unknown tag fatal** (D1/D2). Live listings carry `client`, `status`,
`published_at`, `expiration`, `imeta`, `obi`, `L`, `l`, `r`, `alt` — none of which the schema has a
clause for, and all of which are legal per NIP-99's _"Other tags may be added as necessary"_.

That is very likely **why it was never wired in**: had it been, it would have hidden the entire
marketplace. Stated as a hypothesis, not a fact — the commit history does not say so.

Reproduce: `bun run scripts/evidence-real-listings.ts` (needs public relay access).

---

## Decisions

### D1 — A component receives a validated value, never a raw event

`ProductCard` takes a `ProductListing`, not an `NostrEvent`. The parser is the only place that decides
validity, and it runs once at the boundary.
**Why:** a raw event lets a malformed listing render; it also forces every component to re-validate on
every render, and makes the component's contract depend on relay data rather than the spec.
**Reverses if:** never, as far as this architecture goes.

### D2 — `ok: true` may still carry `problems`

A malformed _optional_ tag is recorded and the field dropped; the listing stays valid and the surface
names what it could not read. A malformed _required_ tag is a rejection.
**Why:** the spec's failure vocabulary ("valid but unresolvable — the part is named") needs a middle
state, and refusing a whole listing over a bad `weight` tag would hide a usable item.
**Consequence:** the UI must render problems, or the tolerance becomes silence.

### D3 — A missing `d` or `title` rejects; the old fallback `'Untitled Product'` is gone

**Behaviour change.** The application renders an untitled product as "Untitled Product"
(`src/queries/products.tsx:511-512`); the package refuses it.
**Why:** Gamma requires `title`; a card whose title is a placeholder is a card with nothing to say.
**Reverses if:** live data shows untitled listings that are genuinely useful — the measurement says
otherwise (2 of 68, both otherwise incomplete).

### D4 — Image ordering is a total order

The original comparator (`products.tsx:561-567`) is not total: when either item lacks an order it
returns `0`, which makes the sort engine-dependent. Ours sorts ascending with unordered images last,
stably.
**Why:** the spec requires identical ordering across adapters, and a non-total comparator cannot
deliver that. Gamma: _"lowest to highest, independent of starting value."_

### D5 — `content-warning` reads a recognised value; anything else is recorded, not ignored

`nsfw` sets the flag; an unrecognised warning (`sensitive`, `spoiler`) is reported as a problem and
does **not** set it.
**Why:** the original compared `=== 'nsfw'` at runtime while its schema rejected every other value, so
an unrecognised warning was silently treated as safe.
**Open:** whether an unrecognised warning should be treated as sensitive (safer, hides more) is a
product call, not a parser call — see O2.

### D6 — Collection membership comes from `a` tags, not a `collection` tag

The application's `getProductCollection` looks for a `collection` tag
(`src/queries/products.tsx:672-676`), which Gamma does not define. Gamma's membership is
`a` → `30405:` (product→collection) and `a` → `30402:` (variation parent).

### D7 — The currency rule follows NIP-99's _wording_, not its example

`/^[A-Z]{3}$/` → `/^[A-Za-z]{3,4}$/`, case preserved.
**Evidence:** NIP-99 says _"3-character ISO 4217 format **or ISO 4217-like currency code** (e.g. `"btc"`,
`"eth"`)"_. The old rule rejects both of NIP-99's own examples and rejects `SATS` — measured as the
single largest cause of live failure (30 of ~60 listings in one run), on tags like
`["price","40000","SATS"]` and `["price","5","USDC"]`.
**Why it matters commercially:** `SATS` is the most natural code on a Bitcoin marketplace.
**Reverses if:** the marketplace decides to accept only strict ISO 4217 — but then it must reject most
of its own sellers.

### D8 — An absent `price` is tolerated and named; a malformed `price` is refused

The asymmetry is deliberate. Absent: NIP-99 says SHOULD, Gamma says required, and a missing price was
the second-largest cause of live failure (~17 of 40) — dropping a fifth of the market would be worse
than showing "no price stated". Malformed: the publisher _did_ assert a price and we cannot read it, so
silently showing none could mislead a buyer about a listing that claims one.
**Consequence:** `price` is optional in the view, and `PriceDisplay` must render the absence honestly
rather than as blank or as free.

### D9 — A read failure is a value, not an exception and not an empty list

`ReadResult` is `{ok:true, events, empty}` or `{ok:false, reason, detail}`, with `reason` one of
`timeout | transport | no-relays`.
**Why:** the application swallows relay failures and search timeouts into `[]`
(`src/queries/products.tsx:137-139`, `:1039-1049`), making an outage indistinguishable from "no
results" — a truthfulness defect, and the reason the spec's failure vocabulary exists.
**Proven:** the prototype's sandbox view deliberately fails, and renders _"the feed could not be
loaded — reason: timeout"_ rather than "no products".

### D10 — The prototype binds `nostr-tools` directly rather than wrapping the application's port

`@plebeian/nostr-access` implements the in-process adapter over `nostr-tools`' `SimplePool`, because a
package must not import from `src/` and the explorer has to prove it runs without the app.
**Consequence, recorded as work rather than hidden:** in production this binding should wrap
`src/lib/nostr/io.ts` so the ADR-0002 migration is preserved instead of forked. The interface is
deliberately shaped so that is a substitution, not a rewrite.
**Bug found here:** `querySync` takes one filter, not an array; passing the array produced a malformed
REQ that relays ignore — which surfaced as a truthful "no results" and hid the bug for a while.

### D11 — Components style themselves with scoped CSS, not Tailwind utilities

**Why:** a napplet frame has no host stylesheet and `style-src 'unsafe-inline'` permits only inline
styles, so a component depending on a global utility stylesheet does not render there. CSS custom
properties are the one thing that crosses a shadow boundary, so the theme is expressed as custom
properties with value fallbacks and everything else is local to the package.
**Reverses if:** the app's Tailwind v4 pipeline is extended to compile per-component scoped styles —
possible, but it would change the build for all three targets.

### D12 — The prototype is additive; `src/` is untouched

No application file is modified. The packages live in `packages/`, the consumer in `apps/explorer/`.
**Why:** it keeps the diff reviewable, avoids touching a suite of 274+ tests, and makes the explorer a
genuine independence test — if the packages secretly needed the app, it would not build.
**Consequence (work, not a gap):** the app still uses its own query layer. Migrating it is the next
PR, and the explorer is the evidence that the migration is possible.

### D13 — Packages resolve through `tsconfig` paths, not a `workspaces` field

`@plebeian/*` are aliased in the root `tsconfig.json` to `packages/*/src/index.ts`.
**Why:** adding a `workspaces` field changes install and lockfile behaviour for the whole repository.
For a prototype, aliases give real packages — own directory, own `package.json`, own `exports`, own
tests, zero imports from `src/` — without touching dependency resolution.
**Reverses if:** we publish. Publishing needs workspace wiring; recorded as pending, not solved.

---

## What the prototype demonstrates

| Projection              | How it is shown                                                     | Verified by                  |
| ----------------------- | ------------------------------------------------------------------- | ---------------------------- |
| Standard **JS package** | `packages/product-event` — pure, Zod only, no app imports           | 54 contract tests            |
| **Query description**   | `packages/product-query` — filters as data, never executed          | 14 tests                     |
| **Viewer filters**      | `packages/browse-filter` — pure, gating deliberately excluded       | 13 tests                     |
| **Environment seam**    | `packages/nostr-access` — one interface, three bindings             | 11 tests                     |
| **UI components**       | `packages/browse-ui` — validated value + environment in, markup out | rendered live                |
| **Live (in-process)**   | `apps/explorer` reading three public relays                         | 13–14 real listings rendered |
| **CMS composition**     | manifest-driven page rendering, no per-component code               | 5 tests                      |
| **Sandbox binding**     | the same components under a stub capability object                  | failure-vs-empty proven      |

**Cross-adapter invariant, tested:** the same fixtures through the static binding, the sandbox binding
and a direct parse produce **identical** validated listings — including a `SATS` price surviving the
live-data path (D7).

## Verification

```
bun test packages/ apps/            # 72 pass, 0 fail
bun test --isolate $(find src/lib/__tests__ src/queries/__tests__ -name '*.test.ts')
                                    # 274 pass, 0 fail — the application is unaffected
bun run scripts/evidence-real-listings.ts   # the 1/68 vs 66/68 measurement
bun run apps/explorer/serve.ts              # http://localhost:3333
```

## Open questions

- **O1 — `config` is synchronous in the interface and asynchronous in the sandbox.** A sandboxed
  surface cannot read the viewer's NSFW preference mid-render; it must resolve it once at boot and
  hold it. The stub returns `undefined` and a test pins that, rather than pretending it works. Either
  the interface becomes async or the host pre-resolves config before first render.
- **O2 — Should an unrecognised `content-warning` value count as sensitive?** Safer to hide, annoying
  to over-hide. Currently: recorded, not treated as NSFW (D5).
- **O3 — Gating is specified but not implemented here.** The prototype's gate is fail-closed by
  construction (nothing renders before `ready`), but the blacklist, test-label and deletion gates need
  the app's settings reads, which are `src/` concerns. That is the next slice.
- **O4 — When does the application adopt the packages?** The explorer proves independence; the app
  migration is a separate, larger PR.
- **O5 — `price` optional in a Gamma-required world.** D8 tolerates a missing price; if a downstream
  consumer assumes a price always exists, that assumption now needs checking at the call site.
