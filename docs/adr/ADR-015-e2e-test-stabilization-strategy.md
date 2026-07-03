# ADR-015: E2E Test Stabilization & Migration Strategy

## Status

Proposed

## Related

- PR #1107: Auth + cart + marketplace e2e fixes (feat/e2e-reliability-comprehensive)
- ARCHITECTURE.md (e2e/ARCHITECTURE.md): Pragmatic Exceptions section
- Issue #1088: E2E tracking issue

## Scope

This ADR defines the strategy for:
1. Unskipping e2e tests that can now pass reliably after the auth/cart/marketplace fixes
2. Migrating all remaining `networkidle` wait strategies to `domcontentloaded`
3. Establishing a repeatable validation protocol for future test unskipping

## Context

### Current State (fix/e2e-reliability-comprehensive branch)

The Plebeian market repo has 20 e2e spec files. After the fixes applied in PR #1107:

**Pass rates on the fix branch:**
| Spec | Tests | Passing | Skipped | Notes |
|------|-------|---------|---------|-------|
| auth.spec.ts | 13 | 13 | 0 | Fully fixed: hydration wait, JS click, 0 networkidle |
| cart.spec.ts | 13 | 9 | 0 | 4 failures from relay rehydration timing |
| marketplace.spec.ts | 7 | 6 | 1 | 1 selector drift (fixed with .or() matcher) |
| payments.spec.ts | 10 | 3 | 3 | 4 NWC wallet state failures + 3 skipped |
| pii-exposure-remediation.spec.ts | 7 | 3 | 0 | 4 relay event propagation failures |
| checkout.spec.ts | 1 | 0 | 1 | 1 skipped (full checkout flow) |
| order-lifecycle.spec.ts | 2 | 0 | 2 | Both skipped (payment + lifecycle flows) |
| order-messaging.spec.ts | 1 | 0 | 1 | 1 skipped (requires checkout first) |
| shipping-special.spec.ts | 2 | 0 | 2 | Both skipped (digital + pickup checkout) |
| product-page.spec.ts | 1 | 0 | 1 | 1 skipped (comment reactions) |
| Stable specs (4) | ~20 | ~20 | 0 | navigation, collections, buyer-purchase, etc. |

**Total: 11 skipped tests across 7 files.**

### Root Causes of Skipping

Tests were skipped during earlier development for these reasons:

1. **NDK WebSocket prevents networkidle** — NDK maintains persistent WebSocket connections to relays, so `networkidle` never fires. This caused page load timeouts. **Fixed** in auth.spec.ts by migrating to `domcontentloaded` + hydration settle wait.

2. **Cart basket button tooltip overlay** — The basket icon's tooltip intercepted pointer events. **Fixed** with `evaluate((el) => el.click())` JS click bypass.

3. **Auth login hydration race** — React hadn't hydrated when the login button was clicked. **Fixed** with 500ms hydration settle wait.

4. **"Invoices" heading selector drift** — Cart redesign (#1045) changed the payment step heading text. **Fixed** in marketplace.spec.ts with `.or()` flexible matcher. Not yet applied to payments.spec.ts / order-lifecycle.spec.ts helpers.

5. **Relay timing** — Events published to relays need propagation time before they can be queried back. This affects 4 cart tests and 4 PII tests. **Not yet fixed** — requires relay-aware retry helpers.

6. **NWC wallet state seeding** — Tests that need wallet state don't seed it properly. **Not yet fixed** — requires fixture improvements.

### networkidle Usage (remaining)

Three files still use `waitForLoadState('networkidle')`:

- `app-settings.spec.ts:27` — helper function `navigateToSettings()` after page.goto
- `user-profile.spec.ts:92` — after `page.goto('/dashboard/account/profile')`
- `products.spec.ts:59` — in `createAuthenticatedPage()` helper after `page.goto('/')`

All three follow the same anti-pattern that was fixed in auth.spec.ts. The NDK WebSocket prevents networkidle from ever firing, making these tests fragile (they rely on Playwright's 30s timeout fallback).

## Decision

### 1. networkidle Migration Policy

**All `waitForLoadState('networkidle')` calls MUST be replaced with `waitForLoadState('domcontentloaded')` + a specific element visibility assertion.**

Pattern (from auth.spec.ts, proven in 13/13 passing tests):

```typescript
// BEFORE (fragile — never resolves due to NDK WebSocket):
await page.goto('/some-path')
await page.waitForLoadState('networkidle')

// AFTER (reliable — DOM ready + element present):
await page.goto('/some-path')
await page.waitForLoadState('domcontentloaded')
await expect(page.getByRole('heading', { name: 'Some Heading' })).toBeVisible({ timeout: 10_000 })
```

Rationale: NDK opens WebSocket connections to relays on page load. These connections never reach idle state (keepalive pings, subscription messages). `domcontentloaded` fires when the HTML is parsed and DOM is ready for interaction — the correct signal for test assertions.

### 2. Test Unskip Protocol

Each skipped test must pass this protocol before being permanently unskipped:

1. **Temporarily unskip** the test (change `test.skip` to `test`)
2. **Run 3 times consecutively** — all 3 must pass
3. **Run once more after a cold dev server restart** — must pass
4. If any run fails, investigate root cause:
   - **Selector drift** → apply `.or()` flexible matcher
   - **Timing race** → add hydration settle wait or `expect().toPass()` retry
   - **Missing fixture** → add the fixture/setup
   - **Genuine bug** → file issue, keep skipped with updated comment
5. **Document the fix** in the test's PR description

### 3. Skip Comment Policy

Any test that remains skipped MUST have a comment explaining:

```typescript
// SKIPPED: <one-line reason>. See <issue# or ADR section>.
// Last verified: <date>. Root cause: <category>.
test.skip('test name', async () => { ... })
```

This prevents "skip rot" — tests that stay skipped forever with no context.

### 4. Pragmatic Exceptions (carried from ARCHITECTURE.md)

Three exceptions to the standard Playwright patterns are documented and approved:

1. **Hydration settle wait** — After `page.goto()`, add `await page.waitForTimeout(500)` before interacting with React-rendered elements. React hydration is asynchronous; the DOM is present (domcontentloaded) but React hasn't attached event handlers yet.

2. **JS click for overlay bypass** — When a tooltip, dialog backdrop, or other overlay intercepts pointer events on a button, use `await locator.evaluate((el) => el.click())` instead of `await locator.click()`. This fires the click event directly on the element without going through the pointer event pipeline.

3. **domcontentloaded over networkidle** — As described above. NDK's persistent WebSocket prevents networkidle from ever firing.

## Phased Implementation

### Phase 1: networkidle Migration (LOW RISK)

Migrate the 3 remaining `networkidle` calls. Each is a straightforward replace-and-verify.

### Phase 2: Unskip Simple Tests (MEDIUM RISK)

Tests that have straightforward flows and were skipped due to issues now fixed:
- shipping-special.spec.ts (2 tests) — digital delivery + local pickup
- product-page.spec.ts (1 test) — comment reaction

### Phase 3: Unskip Payment-Dependent Tests (MEDIUM-HIGH RISK)

Tests that use the checkout→payment flow. Need the "Invoices" heading fix propagated:
- payments.spec.ts (2 tests) — mocked Lightning checkout + defer invoice
- marketplace.spec.ts (1 test) — multi-seller invoice count

### Phase 4: Unskip Complex Flow Tests (HIGH RISK)

Full lifecycle tests with many failure points. Each needs individual validation:
- checkout.spec.ts (1 test) — full purchase with shipping
- order-lifecycle.spec.ts (2 tests) — partial payment + full lifecycle
- order-messaging.spec.ts (1 test) — post-checkout messaging

### Phase 5: Relay-Dependent Tests (DEFERRED)

Tests that query relay events are inherently timing-dependent. These stay skipped until a relay-aware retry fixture is built:
- payments.spec.ts (1 test) — "checkout publishes order events to relay"
- The 4 cart.spec.ts relay timing failures
- The 4 pii-exposure-remediation.spec.ts relay propagation failures

## Consequences

**Positive:**
- Predictable test suite — no mystery skips
- Clear protocol for future unskipping
- networkidle migration eliminates a class of false-positive timeouts
- Documentation prevents regression to old patterns

**Negative:**
- Some tests remain skipped (relay-dependent) until infrastructure work
- networkidle migration requires per-test element selector identification
- Validation protocol (3 runs + cold restart) adds time to unskip work
