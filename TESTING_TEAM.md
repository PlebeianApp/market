# Testing Team Reference

**Companion document to AGENTS.md** - Tracks known issues, workarounds, and test records as we apply fixes.

---

## Current Session

- **Date:** 2026-04-02
- **Branch:** fix/product-form-tab-ordering
- **PR URL:** https://github.com/zapabug/market/pull/new/fix/product-form-tab-ordering

---

## Known Issues (Active)

| Issue                                    | Test File                       | Status | Workaround                                              |
| ---------------------------------------- | ------------------------------- | ------ | ------------------------------------------------------- |
| V4V button not visible                   | v4v-product-creation.spec.ts:93 | OPEN   | wait for data-v4v-loaded attribute                      |
| Collection edit not visible after submit | collections.spec.ts:158         | OPEN   | wrapped in revisitCollectionsAndAssert with 40s timeout |
| Featured item remove not visible         | app-settings.spec.ts:69         | OPEN   | wrapped in retry loop                                   |

---

## Fixed Issues (History)

| Issue                                   | Fix Applied                                           | Date       |
| --------------------------------------- | ----------------------------------------------------- | ---------- |
| Setup form hanging on EventHandler init | Added serverReady check + initialization timeouts     | 2026-03-30 |
| Vanity URL "Something went wrong"       | Added APP_LIGHTNING_ADDRESS env var                   | 2026-03-30 |
| Product form auto-navigation confusion  | Removed all auto-navigation, always start at Name tab | 2026-04-02 |
| Collection dropdown empty               | Added loading state and helpful message               | 2026-04-02 |
| Status badge border overflow            | Fixed overflow in OrderCard.tsx                       | 2026-03-30 |
| GitHub footer link wrong                | Changed PlebeianTech to PlebeianApp                   | 2026-03-30 |
| publishReplaceable for kind 30078       | Detect replaceable kinds and use publishReplaceable() | 2026-04-02 |

---

## Test Data Attributes

Use these attributes in tests to wait for async queries to complete.

| Attribute            | Component          | Purpose                         |
| -------------------- | ------------------ | ------------------------------- |
| data-shipping-loaded | ProductFormContent | Wait for shipping options query |
| data-v4v-loaded      | ProductFormContent | Wait for V4V shares query       |

**Usage:**

```typescript
// Wait for both shipping AND V4V to load
const productForm = page.locator('[data-testid="product-form"][data-shipping-loaded="true"][data-v4v-loaded="true"]')
await expect(productForm).toBeVisible({ timeout: 15000 })
```

---

## Quality Gates

Run these before submitting PR:

```bash
npm run format:check  # Check code formatting
npm run build         # Build and type check
npm run test:e2e-new  # Run e2e tests (requires dev server)
```

---

## Workarounds

### Relay Sync Timing

When UI doesn't update immediately after relay publishes, use retry loops:

```typescript
// Wrap assertion in retry loop
await expect(async () => {
	await expect(locator).toBeHidden()
}).toPass({ timeout: 20000 })
```

### Race Conditions

Wait for data attributes before interacting:

```typescript
// Wait for form to be ready
await expect(page.locator('[data-testid="form"][data-v4v-loaded="true"]')).toBeVisible()

// Then interact
await page.getByTestId('product-setup-v4v-button').click()
```

### Visible Element Filtering

When DOM contains animated/exiting elements:

```typescript
// Filter to only visible elements
const shippingTriggers = dialog.locator('[data-slot="select-trigger"]:visible').getByText('Select shipping method')
```

---

## E2E Test Patterns

### Collections

```typescript
// Navigate to collections
async function gotoCollections(page: Page) {
	await page.goto('/dashboard/products/collections')
}

// Retry assertion with page reload
async function revisitCollectionsAndAssert(page: Page, assertion: () => Promise<void>) {
	await expect(async () => {
		await gotoCollections(page)
		await assertion()
	}).toPass({ timeout: 40000 })
}
```

### Product Form

```typescript
// Wait for all async queries to complete
const productForm = page.locator('[data-testid="product-form"][data-shipping-loaded="true"][data-v4v-loaded="true"]')
await expect(productForm).toBeVisible({ timeout: 15000 })
```

---

## Questions to Investigate

- Why does collection edit require 40s timeout? Is it a replaceable event sync issue?
- Why does V4V query sometimes not load in time? Is there a caching issue?
- Are there other data attributes we should add for test stability?

---

## Related Files

- **AGENTS.md** - Agent instructions and clues for accomplishing tasks
- **src/lib/stores/ndk.ts** - Contains publishEvent with replaceable event detection
- **src/components/sheet-contents/products/ProductFormContent.tsx** - Contains data-shipping-loaded and data-v4v-loaded
