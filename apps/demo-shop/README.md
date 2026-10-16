# `apps/demo-shop` — the demo instance

The app instance the checkout arc is being built in. It **boots**, **composes**
the SDK's commerce modules and `ui/`, **renders a product list from real commerce
data**, opens **one listing's page**, and lets a shopper **put that listing in the
cart** — with both of its edges injected.

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

## The addresses it serves

| Address | Surface |
| --- | --- |
| `/` | the product list |
| `/products/<coordinates>` | one listing's page, with its buy control |
| `/cart` | the cart, read from this browser |
| `/checkout` | the checkout entry — the handoff, not a payment |
| `/api/products` | the list as JSON |
| `/api/products/<coordinates>` | one listing as JSON, or `404` with its reason |
| `/api/config` | this instance's public config, no secrets |
| `/api/assumptions` | the assumption register the footer renders, as JSON |
| `/health` | liveness, with the edge it read and when |

`<coordinates>` is the listing's **own addressable identity** —
`30402:<seller pubkey>:<d tag>`, the string `getProductCoordinates` returns and the
SDK's head rule keys on — not a slug invented for the URL. `instance/routes.ts` is
the one place it is spelled, and `instance/routes.test.ts` holds the round trip
from the path a row emits to the coordinates a route parses.

A product address that resolves to nothing is answered **404 with a sentence**
(`product-missing`), and a listing the read model calls hidden is one of those: the
detail applies the same "not on sale is not a surface" rule the list applies when
it drops the row.

```sh
curl -sS http://127.0.0.1:3400/                                     # the list, server-rendered
curl -sS 'http://127.0.0.1:3400/products/30402:<pubkey>:wool-coat'  # the listing's page
curl -sS 'http://127.0.0.1:3400/api/products/30402:<pubkey>:wool-coat'
```

The pages are server-rendered (`react-dom/server`), so **the HTTP response itself**
carries the product titles and prices; the browser bundle then hydrates that same
markup from `window.__DEMO_SHOP__`, **including which route it is**, so the client
renders the tree the server rendered and no surface is painted by another route's
script. It is not a shell that only looks right once a browser has run.

## The cart is the browser's

There is no cart on the server and no session. `sdk/commerce/cart` ships the
persistence contract (`PersistedCartContent` — versioned `30402:<seller>:<d>` refs
with clamped integer quantities), the builder (`createCartIntent`), the parser
(`parseCartPersistenceContent`) and the mutation (`addCartProduct`), and
deliberately **no storage**: supplying it is the host's job (ADR-0021,
"Configuration ownership"), so `instance/cartState.ts` takes it as an injected
`CartStorage` port and `instance/useCart.ts` is the only place that reaches a
browser global.

That is also why the nav's count is a **skeleton** in the served bytes: the server
cannot know this browser's cart, so it shows the loading state and the browser fills
it after hydration. "This browser has no reachable cart storage" is its own named
state, never a `0` nobody measured.

### What the cart shows, and what it refuses to invent

`instance/cartTotals.ts` joins the cart's lines to the read **by their
coordinates** — the same string the cart's refs are made of — and hands the SDK's
`aggregateCartDisplayTotals` one input per line. Three things it will not do:

- **It does not add a shipping cost.** The read model hands a listing's
  `shipping_option` tags as `[ref, amount]` and declares no unit, so the cart passes
  the aggregation no shipping at all and says so in words rather than in a smaller
  number.
- **It does not drop or zero an unpriceable line.** A persisted ref the read cannot
  answer for is kept with `item: null` and named — a cart that forgives a delisted
  line silently under-reports what it owes.
- **It does not print a float.** A currency's subtotal is presented at the most
  precise tag its own lines carry, because `0.0001 + 0.0002` is
  `0.00030000000000000003` in binary floating point and that is not a price. The
  test names that string, so the rounding cannot be removed by accident.

The sats line borrows the SDK's only exported BTC→sats conversion
(`products/resolvePublishPrice`, an *authoring* function) and says on the page that
it does. A read-side converter belongs in the SDK; that is reported as a named need
rather than re-stating `× 100000000` here.

### The checkout entry: the handoff, and nothing else

`/checkout` is where the cart hands off, and `instance/checkoutView.ts` is what it
resolves — all of it through the SDK's own checkout rules:

- `createCartIntent` builds the **intent** the cart would submit, and the page shows
  its version, its line count and its refs.
- `resolveCheckoutDeliveryRequirements` answers whether the lines resolve to a
  delivery mode. They do not: the buy control does not ask for a shipping method, so
  every line reports the SDK's own `product:<id>:missing-shipping-method` sentinel
  and the page lists them. That is a report, not a placeholder — it is what tells the
  next increment what to build.
- `findNextActionableInvoiceIndex` is the checkout's progress rule, asked over an
  **empty** invoice list, and it answers `-1`, which the page renders as "no payment
  invoice is open".

**The payment is not built and the page says so in its own words.** Nothing on it
moves money, and no order id exists to print.

### The assumption register, on the page

Every assumption the running instance is operating under is rendered in the
footer, each entry naming **what would falsify it** — so the page states what it
is taking for granted rather than leaving it to a comment. It is part of the
component tree, so it is **in the served bytes**: `curl http://127.0.0.1:3400/`
shows it, and it is not applied after hydration.

`instance/assumptions.ts` composes it from three places and is the only place that
does:

- **the registers the SDK modules already export as values** —
  `CURRENCY_ASSUMPTIONS` (`sdk/commerce/currency/assumptions.ts`, 7 entries) and
  `SHIPPING_READ_ASSUMPTIONS` (`sdk/commerce/shipping/shippingRead.ts`, 5 entries).
  They are **imported, never copied**, so a module's own register and what the page
  says about it cannot drift apart. They are imported from their own files rather
  than their barrels on purpose: the currency barrel re-exports the ContextVM
  transport, and data *about* a dependency should not pull the dependency in.
- **the app's own six**, which the app is the one assuming: the edge these listings
  came from, the fact that no live relay read has ever been performed here, why the
  catalog is authored in `BTC`, that an unlabelled price is refused rather than
  defaulted to `SAT`, that the oracle-sourced rate is a dependency rather than a
  fact about the world, and that the cart's total excludes shipping because the read
  model carries no unit for it.

The figures in the entries are **derived, not typed**: the mispricing factor an
unlabelled price would incur comes from the precisions the money rule declares
(`sdk/commerce/cart/money.ts`: `BTC` 8, `SAT` 0), and the notation claim quotes the
SDK's own normaliser (`normalizeCurrency('') → "missing-currency"`) rather than
restating its behaviour. `instance/assumptions.test.ts` holds the register's
completeness (every entry whole, ids unique, the required entries present by id,
the SDK registers verbatim) and `instance/ssr.test.ts` holds that it reaches the
served bytes on every route — including the arm that a `relay` run never claims the
fixture edge.

`/api/assumptions` is the register's JSON twin, so a probe can read it without
parsing HTML.

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
| `instance/productDetailView.ts` | the instance | one listing by address, over **the same** read composition |
| `instance/routes.ts` | the instance | the app's addresses, spelled once and parsed once |
| `instance/cartState.ts` | the instance | the browser's cart, through `@sdk/commerce/cart`, over an injected storage port |
| `instance/useCart.ts` | the instance | the cart's three named page states, and the one write path |
| `instance/cartTotals.ts` | the instance | the cart's lines joined to the read, and the SDK's own aggregation over them |
| `instance/checkoutView.ts` | the instance | what the checkout entry resolves: the intent, the delivery requirements, the invoice progress |
| `instance/assumptions.ts` | the instance | the register: the two SDK registers plus the app's own six, composed as one value the footer renders |
| `instance/ProductList.tsx`, `ProductDetail.tsx`, `CartView.tsx`, `CheckoutEntry.tsx`, `App.tsx` | the instance | presentation, composing `ui/`'s `Badge`, `SelectableBadge`, `cn` |
| `instance/boot.ts` | the instance | config → edge → read → view |
| `server.tsx`, `client.tsx` | the instance | `Bun.serve` + per-route SSR, and the browser hydration entry |

Nobody in `sdk/` or `ui/` was edited to make this work.

## What this slice does **not** prove

- **No payment, and no order.** The cart, the checkout entry and its handoff are
  built; the payment is the next increment. The checkout entry raises no invoice,
  settles nothing, and prints no order id.
- **The cart never asks for a shipping method.** The listing's page shows the
  shipping options it published and the buy control does not offer them, so every
  checkout line reports an unresolved delivery requirement. That is deliberate for
  this increment and it is why the gap is in the page's own words rather than in a
  default.
- **The relay edge has never been run against a live relay.** It is composed and
  it is tested through an injected transport, which is a real test of the seam but
  is not a live read. The demo runs on the fixture edge.
- **The instance reads its edge once, at boot.** The list and a listing's page
  therefore resolve against one read — which is what makes them agree — but a
  listing published after boot is not in either of them.
- **The `.capture` PNG is regenerable, not checked in.** It is an acceptance
  artefact and is git-ignored.
- **There is no Playwright spec under `e2e/`.** AGENTS.md's Feature Quality Gate
  wants one, with video, in `e2e/`; the acceptance harness here
  (`scripts/capture-surface.mjs`) is not that.
- **The published images are shown as a URL, not fetched.** The demo catalog points
  at a non-resolving example host, and a page that fetched it would put a failed
  request in every visitor's console.

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
   `@sdk/commerce/{products,discovery,cart}` by name instead.
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
7. **The commerce read model exposes a listing's shipping *refs* and nothing else
   about shipping.** `getProductShippingOptions` returns the `shipping_option`
   tags — a `30406:<seller>:<d>` ref and an amount — while the service, the
   destination and the currency live in the kind-30406 shipping event, which no
   read model here reads. So a listing's page shows the amount **exactly as
   tagged, with no unit invented**, and anything that has to decide *what kind of
   delivery* an option is (the checkout's own
   `resolveCheckoutDeliveryRequirements`) will need that record. Named here
   because it is the surface the checkout entry is about to need.
8. **`addCartProduct` knows nothing about availability.** The SDK's cart folds any
   product in, so "this listing is out of stock" is a rule the *surface* has to
   state, and `ProductDetail.tsx` refuses by name rather than quietly adding. A
   cart that could be filled with unavailable listings is a cart whose checkout
   can only fail later.
9. **The SDK exposes no read-side BTC→sats conversion.** `sdk/commerce/products`
   exports exactly one, and it is `resolvePublishPrice` — an *authoring* function
   whose job is to turn a seller's draft price into a tag. The cart's sats line
   composes it (`instance/cartTotals.ts`, `satsValueOf`) rather than restating
   `× 100000000`, and says on the page that it does. A `priceToSats` beside the read
   model's accessors is the missing piece, and it should be the one place a
   currency's unit is converted.
10. **`aggregateCartDisplayTotals` sums currency amounts as binary floats.**
    Measured while writing the cart's own test: two lines tagged at `0.0001` and
    `0.0002` sum to `0.00030000000000000003`, which `formatProductPrice` prints
    verbatim. The app therefore rounds each currency subtotal back to the most
    precise tag its lines carry — a fix at the app's boundary, because the SDK's
    signature takes `number` and the imprecision is created by the sum, not by the
    formatting.