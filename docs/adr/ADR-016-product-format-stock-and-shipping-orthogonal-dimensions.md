# ADR-016: Product format, stock, and shipping are orthogonal dimensions

## Status

Proposed

## Date

2026-08-04

## Related

- PR: #1201 (Digital product detection inconsistency)
- Gamma Markets spec: https://github.com/GammaMarkets/market-spec/blob/main/spec.md
- NIP-99: https://github.com/nostr-protocol/nips/blob/master/99.md

## Context

PR #1201 ("FIX: Digital product detection inconsistency") attempts to fix a real problem: the app previously inferred whether a product was digital by inspecting the *shipping option's* `service` tag (`getShippingService(shippingOption)?.[1] === 'digital'`), rather than reading the product's own `type` tag. The PR correctly moves detection to the product `type` tag — the Gamma Markets spec signal.

However, the PR introduces a new problem: it **couples digital format to the absence of stock tracking**. When `delivery === 'digital'`, the PR hides the quantity field, skips stock validation, shows "Digital products do not track stock," and skips stock decrement in order processing. This conflates two dimensions that the Gamma Markets spec deliberately separates:

- **Product format** (`type[2]`: `digital` | `physical`) — what kind of thing is being sold
- **Stock tracking** (`stock` tag: optional integer) — whether availability is limited

Real-world use cases that break the PR's `digital = no stock` assumption:

- Limited-edition digital downloads (100 copies of a digital art pack)
- NFT drops with a fixed supply
- Digital licenses with a cap on seats
- Print-on-demand physical products (unlimited availability, no stock tracking needed)
- Made-to-order physical goods (no fixed inventory count)

The PR also contains critical bugs identified in review:
- Physical products are misclassified as "unresolved" in checkout because the `productType` ternary only ever produces `'digital'` or `undefined`, never `'physical'`
- Digital products get `['stock', '']` (empty string) — schema-invalid, violates `ProductStockTagSchema` (`/^\d+$/`)
- `migration.tsx` doesn't pass `deliveryType`, so migrated digital products get `['type', …, 'physical']`
- Seller-pubkey verification for legacy event-id refs was dropped in `orderStockHelpers`

These bugs are symptoms of the underlying architectural issue: the app lacks a coherent model for how product format, stock, and shipping relate to each other and to the Gamma Markets spec.

## Divergence from the Gamma Markets spec

The Gamma Markets spec has already thought through these dimensions and models them as independent:

### What the spec defines

| Tag | Spec location | Values | Required? | Controls |
|-----|---------------|--------|-----------|----------|
| `type` | Product listing (kind 30402), optional | `["type", "<simple\|variable\|variation>", "<digital\|physical>"]` | Optional (defaults: `simple`, `digital`) | Product format / delivery mechanism |
| `stock` | Product listing (kind 30402), optional | `["stock", "<integer>"]` | Optional | Available quantity |
| `visibility` | Product listing (kind 30402), optional | `["visibility", "<hidden\|on-sale\|pre-order>"]` | Optional (default: `on-sale`) | Display / availability status |
| `shipping_option` | Product listing (kind 30402), optional | `["shipping_option", "30406:<pubkey>:<d-tag>"]` | Optional | Physical delivery method |
| `service` | Shipping option (kind 30406), required | `"standard" \| "express" \| "overnight" \| "pickup"` | Required | Shipping service type |

### What the spec says about digital products

The spec notes state: *"Digital products skip shipping requirements."* Not "digital products use a digital shipping method" — they skip shipping entirely. The four defined `service` types in kind 30406 are all physical delivery methods. There is no `"digital"` service type in the spec.

### Where Plebeian Market diverges

1. **Stock is always required.** The app's `publishProduct`, `updateProduct`, `migration.tsx`, and `ProductFormContent` all require a valid quantity. The spec lists `stock` as optional.

2. **Absent stock = out of stock.** `isProductInStock()` returns `false` when no `stock` tag is present (unless `visibility === 'pre-order'`). The spec doesn't define this behavior. Absent stock should mean "unlimited / not tracked," not "out of stock."

3. **`type[2]` is hardcoded to `'physical'`.** `createProductEvent` always writes `['type', …, 'physical']`. The spec defaults to `'digital'` when absent. The app overrides this to `'physical'` unconditionally, making it impossible to express digital products through the form (prior to PR #1201).

4. **Digital detection via shipping service.** The pre-PR code inferred "digital" from a shipping option's `service` tag being `'digital'` — a value that doesn't exist in the spec. This was a non-spec-compliant hack that PR #1201 correctly moves away from, but the replacement couples digital format to stock absence.

5. **No "unlimited" availability concept.** The app has no way to express a product with unlimited availability. Every product must have a stock count. Physical on-demand products and unlimited digital products cannot be represented.

## Decision

### Decision 1: Treat product format, stock tracking, and shipping as orthogonal dimensions

The app will model three independent dimensions, matching the Gamma Markets spec:

1. **Product format** (`type[2]`: `digital` | `physical`) — controls whether shipping is needed
2. **Stock tracking** (`stock` tag present vs absent) — controls whether quantity is limited
3. **Visibility** (`visibility`: `hidden` | `on-sale` | `pre-order`) — controls display status

No dimension implies another. A digital product can have limited stock. A physical product can have unlimited stock. These are independent choices the merchant makes.

### Decision 2: Absent `stock` tag means unlimited availability

When the `stock` tag is absent from a product event, the product has unlimited availability. It is always "in stock." This applies to both digital and physical products.

When the `stock` tag is present, it contains an integer representing the available quantity. The product is "in stock" when that integer is greater than zero.

`isProductInStock()` must change:

```ts
// Current: no stock tag → out of stock
if (!stockTag) return false

// New: no stock tag → unlimited (in stock)
if (!stockTag) return true
const stockValue = parseInt(stockTag[1], 10)
return !isNaN(stockValue) && stockValue > 0
```

### Decision 3: Digital products do not carry shipping options

Digital products (`type[2] === 'digital'`) do not need and should not carry `shipping_option` tags. Digital delivery is implicit — the absence of shipping is the signal.

The app will enforce this at the form/validation level: when `delivery === 'digital'`, the shipping options UI is hidden, and `createProductEvent` will not emit `shipping_option` tags.

If a merchant wants to offer both digital and physical delivery for the same product, they should use the variable/variation model (see Decision 5).

### Decision 4: Physical products require at least one shipping option

Physical products (`type[2] === 'physical'`) must have at least one `shipping_option` tag referencing a kind 30406 event. The merchant selects which shipping methods (standard, express, overnight, pickup) apply.

The app will enforce this at the validation level: when `delivery === 'physical'`, at least one shipping option is required to publish.

### Decision 5: Use variable/variation for multi-format products

Products that need both digital and physical delivery should use the spec's variable/variation model rather than attaching shipping options to a digital product:

```
Parent (variable):
  ["type", "variable", "physical"]

Variation 1 (digital):
  ["type", "variation", "digital"]
  ["a", "30402:<pubkey>:parent-d"]

Variation 2 (physical):
  ["type", "variation", "physical"]
  ["a", "30402:<pubkey>:parent-d"]
  ["shipping_option", "30406:<pubkey>:standard-shipping"]
```

Each variation carries its own `type[2]` and its own shipping requirements.

### Decision 6: Decouple the product form's stock UI from the delivery selector

The product form will expose stock tracking as an independent choice:

- An **availability** selector: "Limited stock" (show quantity field, emit `stock` tag) vs "Unlimited" (hide quantity field, omit `stock` tag)
- The **delivery** selector (physical/digital) controls shipping options, not stock
- Both selectors are available regardless of format — a digital product can be limited, a physical product can be unlimited

`createProductEvent` will only emit `['stock', quantity]` when quantity tracking is enabled. For unlimited products, the `stock` tag is omitted entirely.

### Decision 7: Do not add "digital" as a shipping service type

The spec's kind 30406 `service` values are `"standard"`, `"express"`, `"overnight"`, and `"pickup"` — all physical delivery methods. Adding `"digital"` as a service type would recreate the exact confusion this ADR resolves: clients would again inspect shipping options to determine if something is digital. Digital delivery is the absence of shipping, not a shipping method.

### Decision 8: Stock decrement skips products with no stock tag

The `StockUpdateDialog` and `orderStockHelpers` will skip any product that has no `stock` tag, regardless of whether it is digital or physical. Stock decrement only applies to products with explicit limited quantity.

## All valid combinations

All five combinations of format × stock are valid and must be supported by the app:

### 1. Digital, limited stock

A digital product with a fixed number of available copies.

```jsonc
{
  "kind": 30402,
  "tags": [
    ["d", "limited-digital-art-pack"],
    ["title", "Limited Digital Art Pack"],
    ["price", "25", "USD"],
    ["type", "simple", "digital"],
    ["stock", "100"],
    ["visibility", "on-sale"]
  ]
}
```

- No shipping options
- Quantity field shown in form
- Stock decremented on order
- Product page shows "100 in stock"
- Checkout: no shipping address needed

### 2. Digital, unlimited

A digital product with no quantity limit.

```jsonc
{
  "kind": 30402,
  "tags": [
    ["d", "ebook-unlimited"],
    ["title", "The Bitcoin Handbook (eBook)"],
    ["price", "10", "USD"],
    ["type", "simple", "digital"],
    ["visibility", "on-sale"]
  ]
}
```

- No `stock` tag
- No shipping options
- Quantity field hidden in form (or "unlimited" selected)
- No stock decrement on order
- Product page shows "Available" or "Unlimited" (not "Out of stock")
- Checkout: no shipping address needed

### 3. Physical, limited stock

A physical product with a fixed inventory count.

```jsonc
{
  "kind": 30402,
  "tags": [
    ["d", "handmade-ceramic-bowl"],
    ["title", "Handmade Ceramic Bowl"],
    ["price", "45", "USD"],
    ["type", "simple", "physical"],
    ["stock", "5"],
    ["visibility", "on-sale"],
    ["shipping_option", "30406:<pubkey>:standard-shipping"]
  ]
}
```

- Shipping options required
- Quantity field shown in form
- Stock decremented on order
- Product page shows "5 in stock"
- Checkout: shipping address and method required

### 4. Physical, unlimited (on-demand)

A physical product with no fixed inventory — made to order or print on demand.

```jsonc
{
  "kind": 30402,
  "tags": [
    ["d", "print-on-demand-tshirt"],
    ["title", "Custom T-Shirt (Print on Demand)"],
    ["price", "20", "USD"],
    ["type", "simple", "physical"],
    ["visibility", "on-sale"],
    ["shipping_option", "30406:<pubkey>:standard-shipping"]
  ]
}
```

- No `stock` tag
- Shipping options still required (it's a physical product that needs to be shipped)
- No stock decrement on order
- Product page shows "Available" or "Made to order" (not "Out of stock")
- Checkout: shipping address and method required

### 5. Variable product with digital and physical variations

A product offered in both digital and physical form.

```jsonc
// Parent (variable)
{
  "kind": 30402,
  "tags": [
    ["d", "photography-course"],
    ["title", "Photography Course"],
    ["price", "99", "USD"],
    ["type", "variable", "physical"],
    ["visibility", "on-sale"]
  ]
}

// Variation 1 (digital)
{
  "kind": 30402,
  "tags": [
    ["d", "photography-course-digital"],
    ["title", "Photography Course — Digital Download"],
    ["price", "99", "USD"],
    ["type", "variation", "digital"],
    ["visibility", "on-sale"],
    ["a", "30402:<pubkey>:photography-course"]
  ]
}

// Variation 2 (physical)
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
    ["shipping_option", "30406:<pubkey>:standard-shipping"]
  ]
}
```

- Each variation is evaluated independently at checkout
- The digital variation needs no shipping; the physical variation does
- Stock tracking applies per-variation

## Mixed cart behavior at checkout

When a cart contains both digital and physical items:

| Item format | Stock tag | Shipping address | Shipping method | Stock decrement |
|-------------|-----------|------------------|-----------------|----------------|
| Digital | present | Not required | Not required | Yes |
| Digital | absent | Not required | Not required | No |
| Physical | present | Required | Required | Yes |
| Physical | absent | Required | Required | No |

- Shipping address and method selection are driven by the presence of physical items only
- Digital items show "Digital delivery — no shipping required"
- Total shipping cost = sum of physical item shipping costs only
- Order detail shows shipping/tracking for physical items, "Digital delivery" for digital items

## Gamma Markets spec proposal

While this ADR defines app-level behavior within the current spec, one ambiguity should be clarified at the spec level:

**Proposal: Clarify absent `stock` tag semantics.**

The spec lists `stock` as optional but does not define what its absence means. This ADR interprets absent `stock` as "unlimited availability." A spec clarification would make this explicit and prevent interoperability issues:

> If the `stock` tag is absent, the product has unlimited availability and no quantity tracking is required. Clients SHOULD treat such products as always in stock. The `stock` tag is only present when the merchant wants to track and display a limited quantity.

This is a clarification, not a structural change to the spec. It documents the intended semantics of an already-optional tag.

A secondary clarification worth proposing:

> The `type` tag's format field (`digital` / `physical`) controls delivery method requirements (shipping vs. electronic delivery). It does not control stock tracking. Stock tracking is governed solely by the presence or absence of the `stock` tag.

## Alternatives considered

### Alternative 1: Merge PR #1201 as-is (digital = no stock)

Rejected. This conflates product format with stock tracking, cannot express limited digital products or unlimited physical products, and contains critical bugs that break physical checkout.

### Alternative 2: Add "digital" as a shipping service type in kind 30406

Rejected. This recreates the confusion the PR is trying to fix. Digital delivery is the absence of shipping, not a shipping method. Clients would again need to inspect shipping options to determine if something is digital.

### Alternative 3: Add a separate `stock_mode` tag (`"limited"` | `"unlimited"`)

Rejected as unnecessary. The presence or absence of the `stock` tag already encodes this information. Adding a separate tag would duplicate semantics and increase complexity without benefit. The spec's philosophy is lightweight and flexible.

### Alternative 4: Use `stock: "0"` to mean unlimited

Rejected. Zero is a meaningful quantity (out of stock), not a sentinel for unlimited. Using it as a sentinel would be ambiguous and break existing stock checks that compare against zero.

### Alternative 5: Use `stock: "-1"` to mean unlimited

Rejected. A negative stock value is semantically nonsensical and would require special handling throughout the codebase. Absence of the tag is cleaner and more aligned with the spec's optional-tag philosophy.

## Consequences

### Positive

- All real-world product types can be expressed: limited digital, unlimited digital, limited physical, unlimited physical, variable with mixed variations
- The app aligns with the Gamma Markets spec's orthogonal design
- `isProductInStock()` correctly handles unlimited products instead of hiding them
- Stock decrement only applies where it makes sense
- Checkout correctly handles mixed carts with digital and physical items
- The variable/variation model is used as intended for multi-format products
- No spec structural changes required — only a clarification proposal

### Negative / tradeoffs

- Existing products published without a `stock` tag (previously treated as "out of stock" and hidden) will become visible. This is correct behavior but may surface previously-hidden products.
- The product form becomes slightly more complex with an additional "availability" selector, but the added flexibility is necessary.
- `isProductInStock()` behavior change is a semantic shift that requires updating tests and potentially migration logic.
- Existing orders referencing products with no `stock` tag may now show different stock behavior in the stock update dialog (skipped instead of errored).

## Implementation plan

### PR 1: Fix `isProductInStock()` and add "unlimited" availability model

- Change `isProductInStock()` to return `true` when no `stock` tag is present
- Add availability concept to `ProductFormState` (`"limited"` | `"unlimited"`)
- Show/hide quantity field based on availability, not delivery
- Only emit `stock` tag when availability is `"limited"`
- Update `ProductListingSchema` to make `stock` truly optional (already optional in schema, but validation code requires it)

### PR 2: Decouple shipping from stock in publish and checkout

- Fix `deliveryRequirements.ts` to correctly map `type[2]` to both `'digital'` and `'physical'` (not just `'digital'` or `undefined`)
- Make shipping options conditional on `type[2] === 'physical'`, not on stock
- Fix `createProductEvent` to omit `stock` tag when unlimited and to omit `shipping_option` tags when digital
- Fix `migration.tsx` to pass `deliveryType`
- Fix the `['stock', '']` schema-invalid emission for digital/unlimited products

### PR 3: Update stock decrement and order flows

- `StockUpdateDialog` and `orderStockHelpers` skip products with no `stock` tag
- Re-add seller-pubkey verification for legacy event-id refs
- Order detail correctly shows "Digital delivery" for digital items and shipping info for physical items
- Mixed cart checkout separates digital and physical items

### PR 4: Update product display and detail page

- Product page shows "Unlimited" or "Available" instead of "Out of stock" when no `stock` tag
- Digital products don't show stock/pre-order badges
- Product cards in lists show availability correctly for unlimited products

### PR 5: File Gamma Markets spec clarification

- Open issue/PR on `GammaMarkets/market-spec` proposing the absent-`stock` semantics clarification
- Reference this ADR as the implementation context

## References

- NIP-99: https://github.com/nostr-protocol/nips/blob/master/99.md
- Gamma Markets spec: https://github.com/GammaMarkets/market-spec/blob/main/spec.md
- PR #1201: https://github.com/PlebeianApp/market/pull/1201
- Product listing schema: `src/lib/schemas/productListing.ts`
- Product queries: `src/queries/products.tsx`
- Delivery requirements: `src/lib/checkout/deliveryRequirements.ts`
- Product form state: `src/lib/stores/product.ts`
- Publish products: `src/publish/products.tsx`