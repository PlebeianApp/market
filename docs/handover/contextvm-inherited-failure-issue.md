# Draft GitHub issue: inherited E2E failures from `master`

## Title

Checkout/payment E2E failures appear inherited from `master`

## Summary

Several Playwright failures were reproduced on the baseline comparison branch (`compare/contextvm-first`) as well as on the ContextVM head branch (`compare/contextvm-head`).

Because the baseline branch is derived from `master` without the current ContextVM changes, these failures appear to be inherited straight from `master`, not introduced by the ContextVM branch.

This issue exists to track those failures separately so they can be handled on the test-fix branch without broadening the pricing PR scope.

## Branches compared

- `compare/contextvm-first` — baseline branch derived from `master`
- `compare/contextvm-head` — ContextVM head branch
- `feature/get-currency-context-vm` — current pricing feature branch
- the test-fix branch created from `compare/contextvm-first`

## Observed failure bucket

The main failures seen in both branches were in the checkout / payment path:

- missing payment controls such as `Pay with WebLN`
- missing `Pay later` / `Skip payment` controls
- checkout and order event assertions timing out
- relay/event publication counts staying at `0`
- downstream shipping-special and order-lifecycle failures that depend on the payment UI

A smaller product-comment reaction visibility failure also appeared in the same CI output and may need separate follow-up if it proves unrelated.

## Why this is being tracked separately

These failures were already present on the baseline comparison branch, so they do not appear to be introduced by the ContextVM branch.

That means the right place to address them is the test-fix branch, not the trimmed pricing PR itself.

## Scope statement

This issue is intentionally narrow.

Do **not** use it to:

- broaden the ContextVM pricing PR
- reintroduce unrelated social/comments/messages/zaps cleanup
- add general browser-debug notes
- expand the temporary skip set beyond the baseline failure bucket

## Next step

1. Work from the test-fix branch.
2. Reproduce the same checkout/payment failures there.
3. Keep the scope limited to the inherited failure bucket.
4. Re-run the same comparison tests after the fix.

## References

- `docs/handovers/contextvm-ci-failure-comparison.md`
- `docs/handover/contextvm-transplant-plan.md`
- `docs/handover/contextvm-e2e-skip-issue.md`

## Paste-ready issue body

> Several Playwright failures appear to be inherited straight from `master` rather than introduced by the ContextVM branch.
>
> We reproduced the same failure bucket on both `compare/contextvm-first` and `compare/contextvm-head`:
>
> - missing payment controls such as `Pay with WebLN`
> - missing `Pay later` / `Skip payment` controls
> - checkout and order event assertions timing out
> - relay/event publication counts staying at `0`
> - downstream shipping-special and order-lifecycle failures that depend on the payment UI
>
> Because `compare/contextvm-first` is derived from `master` without the current ContextVM changes, these failures appear to be inherited and should be handled on the separate test-fix branch instead of widening the pricing PR scope.
>
> Please keep the fix limited to the checkout/payment failure bucket and re-run the same comparison tests after the transplanted branch is updated.
