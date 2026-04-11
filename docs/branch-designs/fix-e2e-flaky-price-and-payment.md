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

## Risks

- Test hardening can accidentally mask real product regressions if assertions become too loose
- Workflow trigger edits can change CI visibility without fixing the underlying flake
- Small UI timing changes may still require app-side adjustments if loading behavior is genuinely inconsistent

## Success Criteria

- The affected E2E specs pass reliably on repeated runs
- The workflow triggers consistently on the intended feature branches
- Test-only fixes remain separate from runtime or deployment refactors
