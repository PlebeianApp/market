# `apps/demo-shop` — the demo instance

The first slice of the app instance the checkout arc is being built in. It
**boots**, **composes** the SDK's commerce modules and `ui/`, and **renders a
product list from real commerce data**, with both of its edges injected.

This directory is the third part of ADR-0021 (`apps/`), not the SDK and not the
UI. It may import `sdk/` and `ui/`; neither may import it — `sdk/boundary.test.ts`
forbids `@apps/` in a production SDK module, and `instance/appBoundary.test.ts`
holds the other direction (the app reaches its siblings through the aliases).

## Run it

```sh
TMPDIR=/home/admin_maxime/work/.tmp bun run apps/demo-shop/server.tsx
# demo-shop: Demo Shop listening on http://127.0.0.1:3400/
# demo-shop: edge = fixture · 5 listings · 1 not on sale
```

Then:

```sh
curl -sS http://127.0.0.1:3400/            # the page, server-rendered
curl -sS http://127.0.0.1:3400/api/products # the same data as JSON
curl -sS http://127.0.0.1:3400/api/config   # this instance's public config, no secrets
```

The page is server-rendered (`react-dom/server`), so **the HTTP response itself**
carries the product titles and prices; the browser bundle then hydrates that same
markup from `window.__DEMO_SHOP__`. It is not a shell that only looks right once
a browser has run.

## House style

The app's tokens and its two layout conventions come from the house style of the
old market app (`market-app/visuals/webui/design.ts`) — **values and conventions
only**; no markup, component or code was taken from there, and nothing under
`sdk/` or `ui/` was edited to bring them in. The sheet stays the app's own
(`apps/demo-shop/styles.css`), which is what ADR-0021 asks for: a theming change,
not an import of another module's stylesheet.

What that style is, as applied here:

- a **warm paper** ground (`#fbf8f5`), never cold white;
- a **monochrome primary** — `--ds-accent` is near-black `#141414`, so the
  leading control is ink on paper — and exactly **one vivid colour**
  (`#ff4fa3`) for emphasis;
- **square corners**: `--ds-r: 0px`, and every `border-radius` in the sheet is
  that one token;
- a **single spacing unit** `--ds-u: 1.31rem` that every margin, padding and gap
  is a whole multiple of;
- status as **soft tinted pairs** (success / warn / danger), never a raw
  saturated colour;
- **named regions** — `region-nav`, `region-instance`, `region-products`, … each
  carrying an `aria-label` — and a **skeleton** state (`data-skeleton="1"` with
  `.sk` blocks).

`instance/theme.test.ts` holds those as source facts, so a later edit cannot
quietly reintroduce the old dark palette or round a corner. The browser pass is
what proves the sheet *applies*: `scripts/capture-surface.mjs` reads the computed
style off the live page as well as photographing it, because a grep of the served
HTML says "the sheet is there" over a page that renders unstyled.

The skeleton is used exactly where it is honest. Every other region on the page is
server-rendered from data the server holds; the cart is the **browser's**, so the
served bytes carry the skeleton where the count goes and the browser fills it
after hydration. Nothing guesses at the number, and "this browser has no reachable
storage" is its own named state rather than a `0`.

## Capture it

```sh
TMPDIR=/home/admin_maxime/work/.tmp bun run apps/demo-shop/scripts/capture-product-list.mjs \
  http://127.0.0.1:3400/ apps/demo-shop/.capture
```

A real browser loads the page, the harness waits for the rendered rows, reads the
page's own visible text back out of the DOM and writes `product-list.png`. The
text is read as well as photographed so that *exists but is empty* cannot pass.

`scripts/capture-surface.mjs` is the same harness generalised to any surface: it
takes a URL, an output name, a wait selector and an optional click-then-navigate
pair (which is how a flow that starts on one page and ends on another is
captured), and it reports the page's text per named element, the named regions it
rendered, the computed styles a styling change has to move, and any console
error.

```sh
TMPDIR=/home/admin_maxime/work/.tmp bun run apps/demo-shop/scripts/capture-surface.mjs \
  http://127.0.0.1:3400/ apps/demo-shop/.capture product-list.png
```

## Test it

```sh
TMPDIR=/home/admin_maxime/work/.tmp bun test apps/demo-shop/instance
```

`bun test apps/demo-shop/instance` in a clean checkout has no network of its own:
the relay cases compose the real `sdk/core/nostr-io` seam over a hand-written
pool, and a `fetch` spy that throws is installed for the duration (ADR-0005).

## What is wired

| Path | Belongs to | Responsibility |
| --- | --- | --- |
| `instance/config.ts` | the instance | its own public values; no secrets |
| `instance/catalog.ts` | the instance | listing inputs, turned into real events **by the SDK** |
| `instance/productAdmission.ts` | the instance | the admission edge: untrusted event in, item or nothing out |
| `instance/productSource.ts` | the instance | the `ProductSource` port, plus the fixture and relay adapters |
| `instance/productListView.ts` | the instance | the read composition; every product rule comes from the SDK |
| `instance/ProductList.tsx`, `App.tsx` | the instance | presentation, composing `ui/`'s `Badge`, `SelectableBadge`, `cn` |
| `instance/boot.ts` | the instance | config → edge → read → view |
| `server.tsx`, `client.tsx` | the instance | `Bun.serve` + SSR, and the browser hydration entry |

Nobody in `sdk/` or `ui/` was edited to make this work.

## What this slice does **not** prove

- **No cart, no checkout, no payment.** Steps 2–5 of the arc are not here. The
  page is a product list and nothing on it is interactive.
- **The relay edge has never been run against a live relay.** It is composed and
  it is tested through an injected transport, which is a real test of the seam but
  is not a live read. The demo runs on the fixture edge.
- **The `.capture` PNG is regenerable, not checked in.** It is an acceptance
  artefact and is git-ignored.
- **There is no Playwright spec under `e2e/`.** AGENTS.md's Feature Quality Gate
  wants one, with video, in `e2e/`; the acceptance harness here
  (`scripts/capture-product-list.mjs`) is not that.

## Known gaps this slice surfaced

1. **The SDK emits a price currency the repository's own kind-30402 parser
   rejects.** `products/productPriceResolution.ts` resolves a sats price to
   `currency: 'SATS'`; `productListingWorkflow.ts` writes it into
   `['price', amount, currency]`; `src/lib/schemas/productListing.ts` requires the
   third element to match `iso4217Currency` = `/^[A-Z]{3}$/`. Four letters cannot
   match, so a `SATS`-denominated listing fails the parser its own
   `validationDeclaration` names as the kind's single definition of valid.
   Pinned, with its locus, by `instance/parserAgreement.test.ts`. **This catalog
   is denominated in `BTC` for that reason**, not by preference. Any relay-backed
   product list over real sats listings is empty until the two definitions agree.
2. **`@sdk/commerce`'s barrel cannot be imported.** `commerce/index.ts` re-exports
   `./messaging`, whose `nip17Order*` modules import `sdk/core/dm/ts/index.ts`,
   whose `adapter.ts` imports `applesauce-common/helpers/gift-wrap`. That package
   is in neither the root `package.json` nor `bun.lock`, so the barrel throws
   `Cannot find module` on import. This instance composes
   `@sdk/commerce/products` and `@sdk/commerce/discovery` by name instead.
3. **The SDK exposes no importable kind-30402 parser.** Admission
   (`instance/productAdmission.ts`) therefore depends on
   `src/lib/schemas/productListing.ts` — the transitional `src/` dependency that
   `apps/web/boot.ts` already documents for itself. `instance/appBoundary.test.ts`
   pins that surface to exactly that one import.
4. **`sdk/core/event-store`'s head rule takes full `Event`s**, while the discovery
   read model hands back a `ProductReadEvent` projection with no `id` and no
   `kind`. The app therefore re-states "one head per addressable address" over the
   admitted projection instead of importing the SDK's rule. A duplicated head rule
   is exactly what `event-store/ts/heads.ts` exists to prevent.
5. **`ProductReadEvent.content` is optional; `ProductSearchEvent.content` is
   required.** Two read-model types in one module disagree about one field, so
   `productListView.ts` supplies a default at its own boundary rather than editing
   either SDK type.
6. **`npm run test:unit` does not include `apps/`.** The root script is
   `find contextvm src sdk …`; nothing under `apps/` is run by it. The instance's
   tests must be invoked by path (or `apps` added to that script — a root
   `package.json` change this slice is not permitted to make).