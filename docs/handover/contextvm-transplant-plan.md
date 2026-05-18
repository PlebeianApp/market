# ContextVM transplant plan onto a new branch

## Goal

Create a fresh follow-up branch that carries only the inherited Playwright test fixes from `compare/contextvm-first`, without bringing in the ContextVM pricing implementation.

Current test-fix branch candidate: `feature/contextvm-inherited-e2e-skips`.

This is the first execution step before drafting the inherited-failure issue so the issue can reference the transplanted branch.

## Branch strategy

Start the new test-fix branch from the branch that best represents the failure baseline:

- preferred baseline: `compare/contextvm-first`
- do **not** start from `feature/get-currency-context-vm` for this branch, because the pricing implementation belongs on the main ContextVM branch instead

## What to transplant

Keep only the changes that are directly tied to the inherited failure bucket:

- the temporary Playwright workaround for the skipped tests
- any minimal comparison/test-support notes required to explain the inherited failures
- the smallest possible CI or runtime support needed to reproduce the test failures

## What not to transplant

Do not bring over:

- the ContextVM pricing implementation
- the browser/runtime client/server/deploy wiring
- unrelated social/messages/profile/UI changes
- broad deploy/release overhaul
- docs that are only about the pricing implementation unless they are being kept temporarily so the test-fix branch can be tested and explained
- old E2E suite migration work that is not required for the inherited failure bucket
- any extra temporary skip beyond the minimal baseline-comparison need

## Recommended procedure

1. Create a new branch from `compare/contextvm-first`.
2. Cherry-pick or reapply only the minimal test-skip changes that are needed.
3. Re-run the affected Playwright tests.
4. Compare the result against the same baseline branch again.
5. Keep the new branch focused on the specific inherited failure bucket only.
6. Keep the Makefile in place for now only if the test-fix branch still needs it for comparison.

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
