# Design: Fix E2E Flaky Price and Payment Tests

## Branch

`feature/fix-e2e-flaky-price-and-payment-clean-split`

## Goal

Stabilize flaky BTC price and payment-related E2E tests without mixing that work into the ContextVM feature/refactor branches.

## Why

The CI failures seen while adapting review feedback made it unclear whether breakage came from product changes or from E2E timing assumptions. This branch isolates the test-hardening work so CI can answer that question directly.

## Scope

- Fix timing assumptions in BTC price E2E assertions
- Add shared payment-step wait helpers where needed
- Refactor affected E2E specs to use the shared helper
- Expand E2E workflow trigger coverage for feature branch pushes if needed for visibility

## Non-goals

- No ContextVM runtime rename
- No ctxcn generation changes
- No deployment/PM2 changes
- No unrelated business-logic changes unless required for deterministic test behavior

## Proposed Changes

1. Replace brittle immediate text checks with explicit waits for sats/fiat rendering
2. Add a shared helper for invoice readiness and reliable WebLN payment clicking
3. Update checkout, order lifecycle, messaging, shipping, and payment specs to use the helper where appropriate
4. Keep assertions semantic rather than layout-fragile
5. Only change workflow triggers as needed to ensure the E2E workflow actually runs on the split branch

## Validation

- Targeted runs of affected Playwright specs
- `bun run test:e2e-new` when feasible
- Confirm workflow syntax and branch trigger behavior

## Implementation and Validation Checklist

### Completed

- [x] Create clean split branch: `feature/fix-e2e-flaky-price-and-payment-clean-split`
- [x] Archive the earlier E2E stabilization attempt on `backup/e2e-flaky-price-attempt-20260411`
- [x] Replace brittle sats-price assertions with explicit waits in `e2e-new/tests/btc-price.spec.ts`
- [x] Add shared payment wait helper in `e2e-new/utils/payment-waits.ts`
- [x] Refactor payment-related E2E specs to use the shared helper where applicable:
  - [x] `e2e-new/tests/checkout.spec.ts`
  - [x] `e2e-new/tests/order-lifecycle.spec.ts`
  - [x] `e2e-new/tests/order-messaging.spec.ts`
  - [x] `e2e-new/tests/shipping-special.spec.ts`
- [x] Update `e2e-new/tests/payments.spec.ts` to be more tolerant of legitimate completion states and CI timing
- [x] Expand `.github/workflows/e2e.yml` push triggers to include `feature/**`
- [x] Keep this branch test-only by leaving `src/components/PriceDisplay.tsx` out for now

### Still to do

- [ ] Run targeted Playwright validation for the changed specs:
  - [ ] `e2e-new/tests/btc-price.spec.ts`
  - [ ] `e2e-new/tests/checkout.spec.ts`
  - [ ] `e2e-new/tests/order-lifecycle.spec.ts`
  - [ ] `e2e-new/tests/order-messaging.spec.ts`
  - [ ] `e2e-new/tests/payments.spec.ts`
  - [ ] `e2e-new/tests/shipping-special.spec.ts`
- [ ] Run `bun run test:e2e-new` if feasible after targeted validation passes
- [ ] Push the branch and confirm GitHub Actions triggers the E2E workflow on `feature/**`
- [ ] Confirm workflow syntax/behavior in CI rather than only locally
- [ ] Reassess whether any app-side fix is still needed only if E2E remains flaky after the test-only changes

## Branch Status Note

### Latest CI signal

A full E2E CI run was triggered on this split branch after adding the `feature/**` workflow trigger.

Observed result summary:

- 86 tests passed
- 6 tests failed consistently
- 8 tests were marked flaky
- 6 tests were skipped

### What appears unrelated to this branch

The following flaky tests are in files not changed by this branch and should be treated as pre-existing or separate suite instability until proven otherwise:

- `e2e-new/tests/app-settings.spec.ts`
- `e2e-new/tests/navigation.spec.ts`
- `e2e-new/tests/products.spec.ts`
- `e2e-new/tests/shipping-options.spec.ts`

The navigation/product/shipping-option failures show `page.goto(...)` being interrupted by a redirect back to `/`, which suggests existing authentication or page-startup instability rather than regressions introduced by this branch.

### What this branch did surface clearly

The consistently failing tests are all in the payment-flow area that this branch was intended to isolate:

- `e2e-new/tests/checkout.spec.ts`
- `e2e-new/tests/order-lifecycle.spec.ts`
- `e2e-new/tests/order-messaging.spec.ts`
- `e2e-new/tests/shipping-special.spec.ts`

In each case CI reached the payment step far enough for the `Invoices` heading to appear, but neither `Pay with WebLN` nor the skip/pay-later path became visible within the helper timeout.

This points to an unresolved payment/invoice readiness problem. The current evidence does **not** show that the split-branch refactor created a brand-new class of failure. More likely, the refactor centralized the waits but the underlying payment-step flake still exists.

### Current assessment

- The branch successfully isolated the payment-related failure area.
- The branch also revealed unrelated E2E flakiness elsewhere in the suite.
- The branch is **not yet ready** to merge into the integration branch.
- There is not enough evidence yet to conclude that the split-branch changes themselves caused the payment failures.

### Recommendation

Proceed in two tracks:

1. **Keep this branch separate for now.** Do not merge it into `feature/contextvm-review-split-integration` yet.
2. **Investigate the payment-step failure directly** using CI screenshots, traces, and error-context files to determine what the page is doing after `Continue to Payment`:
   - stuck on invoice generation,
   - redirected away,
   - blocked by overlay/toast/modal,
   - showing a different button label/state,
   - or waiting on app-side pricing/payment state that never resolves.
3. **Treat the unrelated flaky tests as a separate issue bucket.** They should not block reasoning about the payment helper changes because they are outside the files modified on this branch.
4. **Only consider app-side fixes if the traces show the UI itself is stuck.** If the payment page never becomes actionable, a small app fix may be justified later, but that should be done based on evidence rather than assumption.
5. **After diagnosis, rerun only the affected payment specs first** before attempting another full-suite run.

## Risks

- Test hardening can accidentally mask real product regressions if assertions become too loose
- Workflow trigger edits can change CI visibility without fixing the underlying flake
- Small UI timing changes may still require app-side adjustments if loading behavior is genuinely inconsistent

## Success Criteria

- The affected E2E specs pass reliably on repeated runs
- The workflow triggers consistently on the intended feature branches
- Test-only fixes remain separate from runtime or deployment refactors
