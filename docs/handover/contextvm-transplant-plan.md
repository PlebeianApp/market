# ContextVM transplant plan onto a new branch

## Goal

Create a fresh follow-up branch that carries only the changes needed to address the issues observed in `compare/contextvm-first`, without keeping the unrelated branch baggage.

This is the first execution step before drafting the inherited-failure issue so the issue can reference the transplanted branch.

## Branch strategy

Start the new branch from the branch that best represents the failure baseline:

- preferred baseline: `compare/contextvm-first`
- if the fix must be layered on top of the feature implementation, cherry-pick only the narrowly relevant commits from `feature/get-currency-context-vm`

## What to transplant

Keep only the changes that are directly tied to:

- ContextVM BTC pricing behavior
- the comparison-based investigation of the failing E2E bucket
- minimal CI or runtime support needed to reproduce/fix the issue
- any temporary Playwright workaround that is genuinely required to keep the transplant branch reproducible while the root cause is being investigated

## What not to transplant

Do not bring over:

- unrelated social/messages/profile/UI changes
- broad deploy/release overhaul
- docs that are only about the investigation process, unless they are being kept temporarily so the transplant branch can be tested and explained
- old E2E suite migration work that is not required for the pricing issue
- any extra temporary skip beyond the minimal baseline-comparison need

## Recommended procedure

1. Create a new branch from `compare/contextvm-first`.
2. Cherry-pick only the minimal ContextVM fixes or investigation helpers that are needed.
3. Re-run the affected Playwright tests.
4. Compare the result against the same baseline branch again.
5. Keep the new branch focused on the specific failure class only.
6. Keep the Makefile in place for now so the final browser validation can still use it.

## Expected outputs from the new branch

The new branch should make it clear whether the issue is:

- pre-existing on the baseline branch
- introduced by the ContextVM branch
- or a separate flake/timing problem

## Validation

At minimum, the follow-up branch should be validated against:

- the comparison baseline (`compare/contextvm-first`)
- the current feature head
- the failing E2E tests in the comparison bucket

## Notes

If a change does not help explain or fix the `compare/contextvm-first` failures, leave it out of the transplant branch.

If a temporary skip or documentation file is useful for the transplant branch, keep it only until the browser validation and final cleanup are complete.
