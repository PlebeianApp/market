# Draft GitHub issue: temporary E2E skips inherited from `master`

## Title

Temporarily skip failing Playwright tests inherited from `master`

## Summary

The following Playwright tests were temporarily skipped so CI can move forward while the inherited checkout/payment and product-interaction failures are investigated.

Create this issue after the test-fix branch exists so the issue can reference the transplanted branch and its scope:

- `e2e-new/tests/checkout.spec.ts`
- `e2e-new/tests/marketplace.spec.ts`
- `e2e-new/tests/order-lifecycle.spec.ts`
- `e2e-new/tests/order-messaging.spec.ts`
- `e2e-new/tests/payments.spec.ts`
- `e2e-new/tests/product-page.spec.ts`
- `e2e-new/tests/shipping-special.spec.ts`
- `e2e-new/test-config.ts` (test env override support used during the investigation)

## Why these tests were skipped

These failures were reproduced on `compare/contextvm-first`, which is the baseline branch used for the comparison and is derived from `master` without the current ContextVM changes. That means the failures do **not** appear to be introduced by the ContextVM branch.

Because the baseline already shows the same failure class, the temporary skips are acceptable as an investigation aid while the test-fix branch is being prepared.

The observed failures were mostly the same class of issues across both branches:

- missing payment UI controls such as `Pay with WebLN`
- checkout/order event assertions timing out
- product comment reaction visibility failures
- flaky multi-seller / shipping-special test cases

Because the baseline branch already exhibits the same failure mode, the skips are a **temporary stabilization measure**, not a statement that the ContextVM branch is the root cause.

## Evidence to include in the issue

Reference the comparison findings from:

- `compare/contextvm-first`
- `compare/contextvm-head`
- `docs/handovers/contextvm-ci-failure-comparison.md`

Useful failure details to mention:

- `Error: expect(locator).toBeVisible() failed`
- missing `getByRole('button', { name: 'Pay with WebLN' })`
- checkout/order event counts remaining at `0`
- product comment reaction visibility flake

## Scope statement

This skip is intentionally narrow and temporary.

Only the tests that already failed on `compare/contextvm-first` should be skipped on the feature branch or transplant branch.

Do **not** expand the skip set beyond the baseline failure bucket unless a new comparison proves the new failure is also pre-existing.

Do not mix this issue up with the final browser cleanup commit for the pricing branch; it exists to document the temporary workaround while the test-fix branch is in flight.

## Follow-up work

A future branch should:

1. reproduce the failure on `compare/contextvm-first`
2. identify whether the checkout/payment timing issue is environmental or logic-related
3. carry only the minimum skip/workaround needed for the transplant
4. remove the skips once the real root cause is fixed

## Acceptance criteria for closing this issue

- The skipped tests are no longer needed because the underlying failure is fixed.
- The feature branch has no temporary `test.skip(...)` workarounds left behind.
- Any permanent e2e changes are moved into separate, scoped PRs.
