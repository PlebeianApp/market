# ADR-017: Product-listing conformance with the Gamma Markets spec — a six-state migration

## Status

Proposed

Lives on branch `docs/adr-016-product-orthogonal-dimensions` (PR #1215). Per `docs/adr/README.md`, this file and its registry row move to `Accepted` when the PR merges.

This revision **proposes a new decision** (the six-state migration); it does not clarify an already-accepted one. Nothing in it is Accepted until the PR merges. The ADR was previously numbered 0016 in the file — it collided with `ADR-016-zap-ndk-external-relay-isolation.md` on `master` — and is numbered **0017** here. The former README instruction to renumber it to 0009 is not usable: `ADR-0009-test-listing-labels-via-nip-32.md` already exists.

## Date

2026-08-04 (original orthogonal-dimensions analysis) · revised 2026-09-26 (six-state migration)

## Related

- PR #1215 — this ADR
- PR #1396 — State 1 of this plan (normalisation; fixes #1349)
- Issue #1349 — the live defect that forced the wider frame
- Issue #1374 — the read path casts tags instead of validating them (State 2)
- PR #1201 — the earlier digital-detection fix; rejected alternative (see below)
- PR #1215's predecessor analysis: `docs/adr/ADR-add-product-workflow-boundaries.md` (Accepted) — its invariant "create and edit never share mutable session state" is what State 1 implements
- Gamma Markets spec: <https://github.com/GammaMarkets/market-spec/blob/main/spec.md>
- NIP-99: <https://github.com/nostr-protocol/nips/blob/master/99.md>

## Context

PR #1201 ("FIX: Digital product detection inconsistency") attempts to fix a real problem: the app inferred whether a product was digital by inspecting the _shipping option's_ `service` tag (`getShippingService(shippingOption)?.[1] === 'digital'`), rather than reading the product's own `type` tag. The PR correctly moves detection to the product `type` tag — the Gamma Markets spec signal.

However, the PR introduces a new problem: it **couples digital format to the absence of stock tracking**. When `delivery === 'digital'`, the PR hides the quantity field, skips stock validation, shows "Digital products do not track stock," and skips stock decrement in order processing. This conflates two dimensions the Gamma Markets spec deliberately separates:

- **Product format** (`type[2]`: `digital` | `physical`) — what kind of thing is being sold
- **Stock tracking** (`stock` tag: optional integer) — whether availability is limited

Real-world use cases that break the PR's `digital = no stock` assumption: limited-edition digital downloads; NFT drops with fixed supply; digital licences with a seat cap; print-on-demand physical products; made-to-order physical goods.

The PR also contained concrete bugs identified in review (physical products misclassified as "unresolved" in checkout because the ternary only ever produced `'digital'` or `undefined`; digital products emitted `['stock', '']`, violating `ProductStockTagSchema`; `migration.tsx` not passing `deliveryType`; dropped seller-pubkey verification for legacy event-id refs).

### What forced the wider frame: #1349

Since that analysis, a second, live defect made the same point from the opposite direction. Plebeian was publishing `["type", "variable", "physical"]` for listings that have no variants at all, through three independent paths:

1. `loadProductForEdit` and `StockUpdateDialog` both mapped a **missing** `type` tag to `variable`, from the same duplicated expression — so a stock update after shipping silently republished a listing as `variable`.
2. An abandoned edit left `productType: 'variable'` in the form store; on "Add product" the store reset, but Radix's hidden native `<select>` fired `onValueChange("")`, and the publish path mapped anything that is not exactly `'single'` to `variable` — so a **brand-new** listing could be born broken.
3. `createProductEvent` hardcodes `type[2]` to `'physical'`, so every edit of a digital product republished it as physical.

The spec's rule is the opposite of what path 1 and 2 assumed: **a missing `type` tag means `simple`**, not `variable`. And `variable` means a parent product with `variation` children — a `variable` listing with no children is a broken state that spec-strict clients hide. That is exactly what happened: Conduit marked a merchant's entire catalogue as variations and stopped listing it. Measured on `wss://relay.plebeian.market` (2026-09-25): 30 live childless `variable` parents from 13 merchants, 317 listings from 72 merchants with no `type` tag at risk on their next edit, and the defect still reproducing on the day of the report.

The two defects are one architectural gap: **Plebeian has no written product spec, so the wire grammar lives implicitly in three places that disagree** — the schema (`src/lib/schemas/productListing.ts`, already almost fully conformant), the emitter (`src/publish/products.tsx`), and the form store (`src/lib/stores/product.ts`). There is no products counterpart to `AUCTIONS.md`.

## Decision

**Plebeian adopts the Gamma Markets product-listing spec as its target, and reaches it in six states. Each state is a complete vertical slice — spec text, write path, read path, UI, migration and tests move together — so no part of the codebase is ever reading or writing an older rule than another.**

The migration rule for data published before conformance:

1. **Read both shapes, write one.** Readers accept the legacy and spec shapes for as long as we have data. Writers emit only the spec shape. Applied per state, never globally.
2. **Lazy migration on touch.** Any edit or stock update re-emits the current spec shape.
3. **Explicit sweeps only for what lazy migration cannot reach** (listings nobody edits), run through the existing migration tool, and only after the emitter is correct.
4. **Never re-key `d`.** Orders, carts, receipts and collections reference listings by coordinate.
5. **Discovery stays whole.** Anything that would hide a legacy listing is a display decision, never a filter change.
6. **One state per PR, self-consistent.** If a state cannot be finished, it does not ship.
7. **Verification per state:** the read-path gate from State 2 is the mechanical proof; plus one targeted E2E on the touched family and a named measurement before/after.

### State 1 — Normalisation: every value we publish is true (PR #1396)

- **Spec:** a missing or unrecognised `type` tag resolves to `simple`; the listing's `format` is preserved on edit rather than re-stamped; an abandoned edit cannot leak into the next product.
- **Vertical set:** `publish/products.tsx`, `lib/stores/product.ts`, `components/orders/StockUpdateDialog.tsx`, `components/sheet-contents/products/NameTab.tsx`, `routes/.../products/$productId.tsx`, plus the new `lib/utils/productType.ts`.
- **Retro-compat:** a missing tag loads as `simple`; a genuine `variable` listing stays `variable`.
- **Child preservation (required, not optional).** Editing a listing whose `type[0]` is `variation` must **not** overwrite the parent relationship or the fact that it is a child. The form cannot model variations yet, so it must carry the loaded `type` tag and the parent `["a","30402:<pubkey>:<parent-d>"]` reference as opaque state and re-emit both **unchanged** on publish, while the merchant's other edits (title, price, stock, images, specs) apply normally. Mapping a `variation` child to `simple` and dropping the `a` tag silently detaches another client's child listing from its parent — a worse outcome than leaving the listing untouched. This closes the State 1 ↔ State 6 window by design instead of living with it.

### State 2 — The spec becomes a contract (issue #1374)

- **Spec:** unchanged on the wire. Every read of kind 30402/30405 is **parsed** against the schema instead of cast.
- **Why here:** it makes every later state mechanically checkable and prevents silent regression. Surface behaviour follows the existing house rule: discovery drops silently, a direct link resolves and names the failure, owner surfaces stay ungated.
- **Retro-compat:** no wire change. A legacy event the schema cannot describe currently renders as an empty card; after this state it says why.

### State 3 — The collection edge

- **Spec:** a product references its collection with `["a", "30405:<pubkey>:<d-tag>"]`. Our collection event is already conformant (`publish/collections.tsx` emits `d`, `title`, `summary`, `image`, product `a` references and `shipping_option` refs correctly); only the product→collection edge is missing, and today it is written as a private `["collection", …]` tag that no other client reads.
- **Vertical set:** `publish/products.tsx`, `queries/products.tsx`, the form's `selectedCollection` value, `lib/stores/product.ts`, `StockUpdateDialog`, `MigrationForm`, and the collection picker UI.
- **Retro-compat:** dual-read the legacy `collection` tag indefinitely; lazy re-emit on touch.
- **Why it is early:** the same failure class as State 1 — a private convention a strict client cannot read, so the entity disappears.

### State 4 — The orthogonality model

The original decision set of this ADR, unchanged. Format, stock and visibility are three independent dimensions:

- **Decision 1 — orthogonal dimensions.** Format (`type[2]`), stock tracking (`stock` present vs absent) and visibility (`visibility`) neither imply nor override each other.
- **Decision 2 — absent `stock` means unlimited.** When the tag is absent the product is always available; when present it is an integer and the product is in stock above zero. `isProductInStock()` (`src/queries/products.tsx`) must change from `if (!stockTag) return false` to returning `true`, then parsing the integer.
- **Decision 3 — digital products carry no `shipping_option`.** Digital delivery is implicit; the absence of shipping is the signal.
- **Decision 4 — physical products require at least one `shipping_option`** referencing a kind 30406 event.
- **Decision 5 — multi-format products use the variable/variation model**, each variation carrying its own `type[2]` and its own shipping requirements.
- **Decision 6 — the form's stock UI is decoupled from the delivery selector:** an availability choice ("limited" — quantity field, emit `stock`; "unlimited" — no quantity, omit `stock`), independent of format.
- **Decision 7 — do not add `"digital"` as a kind 30406 service type.** The spec's services are physical delivery methods; digital delivery is the absence of shipping.
- **Decision 8 — stock decrement skips products with no `stock` tag.**

**One open decision:** the format default. The spec says a missing format means `digital`; our form has always published `physical`. This has two faces — how we read a foreign listing with no format, and what a new product defaults to — and both must be decided explicitly here rather than inherited.

**Vertical set:** `publish/products.tsx`, the product form, the stock-update and order/stock-decrement paths, `lib/checkout/deliveryRequirements.ts`, the cart/checkout path, `publish/migration.tsx`, product display (`ProductCard`, product page).

**Retro-compat:** every listing published so far carries an explicit `stock`, and explicit means limited — unchanged. Only _absent_ stock changes meaning, and we never publish absent stock today, so no existing listing changes behaviour; the change becomes visible only when a merchant opts into unlimited.

> The previous revision of this ADR cited `src/lib/orders/orderStockHelpers.ts` for the decrement path. That file no longer exists on the base; the successor must be named at implementation time rather than carried forward.

### State 5 — Merchant preferences

- **Spec:** `["payment_preference", "<manual|ecash|lud16>"]` on merchant kind 0 (default `manual` when absent), plus the NIP-89 pair — kind 31989 for a merchant recommending an application, kind 31990 for an application publishing itself.
- **Today:** zero occurrences of either in the codebase.
- **Retro-compat:** purely additive; absent tag keeps today's interactive manual flow.
- **Why it matters:** it is the mechanism by which another Gamma client routes a buyer to Plebeian instead of showing "merchant uses another app".

### State 6 — Variations

- **Spec:** the parent uses `variable`; children use `variation` and MUST carry `["a", "30402:<pubkey>:<parent-d>"]`; nothing cascades — a child restates price, stock, format, images and specs.
- **Vertical set:** publish (parent + children), read (both kinds, children grouped under parents), the options/variants editor, **orders** (which child was bought; stock decrements against the child), and migration.
- **Migration, in this order:** the ~317 tagless listings drain by lazy migration through State 1's guard; the ~30 childless `variable` parents cannot and need one explicit sweep with the existing migration tool — which must run **after** State 4 is settled, or it republishes another wrong shape; and imported `variation` children must stop being detached before we create any ourselves, because a detaching rewrite is exactly what that defect produces.
- **Ordering constraint:** this is the only state that touches orders, and it should follow States 1–4.

### Final state — the products codex and full conformance

- Write the products spec document the repository is missing (the counterpart to `AUCTIONS.md`), stating the grammar, the defaults and the retro-compatibility rules above.
- Ensure the codebase matches it in both directions: what we emit, and what we accept.
- Confirm the conformance end to end on a real relay (before/after counts of non-conformant listings), not only in tests.
- File the spec clarifications below with the Gamma Markets working group, since Plebeian is a participant in it.

## All valid combinations

All five format × stock combinations are valid and must be supported.

1. **Digital, limited stock** — `["type","simple","digital"]` + `["stock","100"]`; no shipping options; quantity shown; stock decremented; checkout needs no address.
2. **Digital, unlimited** — `["type","simple","digital"]`, no `stock` tag; no shipping; no decrement; page shows "Available"/"Unlimited", never "Out of stock".
3. **Physical, limited stock** — `["type","simple","physical"]` + `["stock","5"]` + at least one `shipping_option`; decremented; address and method required.
4. **Physical, unlimited (made to order / print on demand)** — `["type","simple","physical"]`, no `stock` tag, shipping still required, no decrement.
5. **Variable product with mixed variations** — parent `["type","variable","physical"]`; each child `["type","variation", <its own format>]` with `["a","30402:<pubkey>:<parent-d>"]`; each child's shipping and stock evaluated independently.

```jsonc
// 1. digital, limited
{
	"kind": 30402,
	"tags": [
		["d", "limited-digital-art-pack"],
		["title", "Limited Digital Art Pack"],
		["price", "25", "USD"],
		["type", "simple", "digital"],
		["stock", "100"],
		["visibility", "on-sale"],
	],
}

// 2. digital, unlimited — the stock tag is absent, not "0" and not ""
{
	"kind": 30402,
	"tags": [
		["d", "ebook-unlimited"],
		["title", "The Bitcoin Handbook (eBook)"],
		["price", "10", "USD"],
		["type", "simple", "digital"],
		["visibility", "on-sale"],
	],
}

// 3. physical, limited
{
	"kind": 30402,
	"tags": [
		["d", "handmade-ceramic-bowl"],
		["title", "Handmade Ceramic Bowl"],
		["price", "45", "USD"],
		["type", "simple", "physical"],
		["stock", "5"],
		["visibility", "on-sale"],
		["shipping_option", "30406:<pubkey>:standard-shipping"],
	],
}

// 4. physical, unlimited
{
	"kind": 30402,
	"tags": [
		["d", "print-on-demand-tshirt"],
		["title", "Custom T-Shirt (Print on Demand)"],
		["price", "20", "USD"],
		["type", "simple", "physical"],
		["visibility", "on-sale"],
		["shipping_option", "30406:<pubkey>:standard-shipping"],
	],
}

// 5a. variable parent
{
	"kind": 30402,
	"tags": [
		["d", "photography-course"],
		["title", "Photography Course"],
		["price", "99", "USD"],
		["type", "variable", "physical"],
		["visibility", "on-sale"],
	],
}

// 5b. variation, digital — no shipping, no stock
{
	"kind": 30402,
	"tags": [
		["d", "photography-course-digital"],
		["title", "Photography Course — Digital Download"],
		["price", "99", "USD"],
		["type", "variation", "digital"],
		["visibility", "on-sale"],
		["a", "30402:<pubkey>:photography-course"],
	],
}

// 5c. variation, physical — its own stock and shipping
{
	"kind": 30402,
	"tags": [
		["d", "photography-course-physical"],
		["title", "Photography Course — Printed Workbook + DVD"],
		["price", "149", "USD"],
		["type", "variation", "physical"],
		["stock", "50"],
		["visibility", "on-sale"],
		["a", "30402:<pubkey>:photography-course"],
		["shipping_option", "30406:<pubkey>:standard-shipping"],
	],
}
```

## Mixed cart behaviour at checkout

- Digital, stock present: no address, no method, decremented on order.
- Digital, stock absent: no address, no method, not decremented.
- Physical, stock present: address and method required, decremented.
- Physical, stock absent: address and method required, not decremented.
- Address and method are driven by the presence of physical items only; digital items read "Digital delivery — no shipping required"; total shipping is the sum of physical items only; order detail shows tracking for physical and "Digital delivery" for digital.

## Gamma Markets spec proposals

The spec leaves three things undefined that we need defined for interoperability. Each is a clarification of an already-optional tag, not a structural change.

1. **Absent `stock` semantics.** "If the `stock` tag is absent, the product has unlimited availability and no quantity tracking is required; clients SHOULD treat such products as always in stock. The tag is present only when the merchant wants to track and display a limited quantity."
2. **Format is independent of stock.** "The `type` tag's format field controls delivery method requirements only. It does not control stock tracking; stock tracking is governed solely by the presence or absence of the `stock` tag."
3. **The collection edge.** "A product references a collection with `["a", "30405:<pubkey>:<d-tag>"]`; a private tag carrying a bare identifier is not interoperable."

## Implementation plan

One PR per state, in order, each complete on its own:

1. **State 1** — normalisation. PR #1396, in review.
2. **State 2** — the read-path gate (issue #1374).
3. **State 3** — the collection edge.
4. **State 4** — the orthogonality model, as the previous revision's five PRs (stock/unlimited model → decouple shipping from stock in publish and checkout → decrement and order flows → display → file the spec clarifications), now one state with sub-steps.
5. **State 5** — merchant preferences. Independent of the product model and may run in parallel.
6. **State 6** — variations, including the repair sweep and the child-reattachment fix.
7. **Final** — the products codex, end-to-end conformance, and the filed clarifications.

## Alternatives considered

1. **Merge PR #1201 as-is (digital = no stock).** Rejected: conflates format with stock tracking, cannot express limited digital or unlimited physical products, and contained bugs that broke physical checkout. Its correct half — detecting digital from the product's `type` tag rather than a shipping service — is retained.
2. **Add `"digital"` as a kind 30406 service type.** Rejected: recreates the confusion; clients would again inspect shipping options to decide if something is digital.
3. **A separate `stock_mode` tag (`limited` | `unlimited`).** Rejected: the presence or absence of `stock` already encodes this; a second tag duplicates semantics.
4. **`stock: "0"` means unlimited.** Rejected: zero is a meaningful quantity (out of stock), not a sentinel.
5. **`stock: "-1"` means unlimited.** Rejected: semantically nonsensical and needs special handling everywhere.
6. **Fix the `type` derivation without writing the spec down.** Rejected: that is precisely how #1349 happened — three implicit grammars drifting apart. Hence the codex in the final state.

## Consequences

### Positive

- Every real-world product type can be expressed: limited digital, unlimited digital, limited physical, unlimited physical, variable with mixed variations.
- The app aligns with the Gamma Markets spec's orthogonal design, and the failure mode that hid listings from strict clients is removed at its source.
- `isProductInStock()` stops hiding unlimited products.
- Stock decrement applies only where it makes sense.
- Mixed carts behave correctly.
- The repository gains the product spec document it never had, so the next divergence is a review finding rather than a merchant complaint.

### Negative / tradeoffs

- Existing products published without a `stock` tag (previously treated as out of stock and hidden) become visible. Correct, but it surfaces previously hidden products.
- The form gains an availability selector.
- `isProductInStock()` is a semantic shift requiring test and display updates.
- Orders referencing products with no `stock` tag change behaviour in the stock dialog (skipped instead of errored).
- State 1 normalises a `type` tag that another client wrote, on an unrelated edit by the merchant. The direction is right and the alternative is the defect, but it is a write to a foreign field and is recorded here as an accepted trade-off.
- `variation` children are **preserved but not modelled** until State 6: editing one keeps it attached to its parent and keeps its own `type`, but Plebeian still cannot create, validate or sell variations. State 1 is required to preserve them precisely so that the support State 6 adds lands on listings that were never damaged in the meantime.
- The ~30 childless `variable` parents are repaired by an explicit sweep that touches merchants' live listings.

## Open decisions

1. The format default (State 4): follow the spec's `digital` or keep our historical `physical`, for reading foreign listings and for the form's default.
2. Whether Plebeian normalises another client's `type` tag on an unrelated edit (State 1 sign-off). Note that the normalisation **excludes** `variation` children, which are preserved verbatim.
3. Whether the read-path contract (State 2) precedes the collection edge (State 3).
4. Whether this ADR becomes the governing document for the whole plan, and whether PR #1201 is closed in its favour.
5. Whether the products work lands on `master` or on the `auctions` integration line — State 6 touches orders, which the `auctions` line is also changing.
6. The policy for the repair sweep: may we rewrite listings that no merchant is currently editing?

## Reading note on external references

The Gamma Markets spec, NIP-99 and the external PRs cited above are used as **external compatibility context** — they describe what other clients and the wider network expect, not what this repository currently does. Every statement about Plebeian's own behaviour in this ADR is taken from the files listed at the end, and any claim that cannot be traced there is marked as an open decision instead.

## References

- NIP-99: <https://github.com/nostr-protocol/nips/blob/master/99.md>
- Gamma Markets spec: <https://github.com/GammaMarkets/market-spec/blob/main/spec.md>
- PR #1201, PR #1396, issue #1349, issue #1374
- `src/lib/schemas/productListing.ts`, `src/queries/products.tsx`, `src/publish/products.tsx`, `src/publish/collections.tsx`, `src/lib/stores/product.ts`, `src/lib/checkout/deliveryRequirements.ts`, `src/components/orders/StockUpdateDialog.tsx`, `src/components/migration/MigrationForm.tsx`
