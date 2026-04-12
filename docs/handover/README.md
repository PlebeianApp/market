# ContextVM cleanup plan index

This folder is the active cleanup checklist for the current ContextVM branch. Use these plans in order, and keep the older notes under `docs/handovers/` around only as long as they are still needed for review or validation.

## Branch progress checklist

### Completed in this branch

- [x] Create a cleanup-plan index for the ContextVM follow-up work
- [x] Clarify the order of the cleanup docs
- [x] Explain that `make browser-contextvm` should stay available until final validation is complete
- [x] Clarify that archived notes under `docs/handovers/` are still present only for review/validation
- [x] Clarify that any final removal of `Makefile` or handover docs belongs in the last cleanup step

### Still to do

- [ ] Define the trim boundary and decide what can stay for transplant
- [ ] Move only the relevant fixes onto the follow-up branch
- [ ] Create the issue that explains the failing E2E tests were inherited from `master` and must be addressed in the transplanted branch
- [ ] Draft the issue for the temporary skipped Playwright tests
- [ ] Draft the issue design for the inherited-from-`master` failures
- [ ] Run `make browser-contextvm` and verify the happy path
- [ ] Finish the remaining cleanup commit
- [ ] Remove handover docs and the `Makefile` only if they are no longer needed

## Cleanup sequence

1. [`contextvm-scope-cleanup-design.md`](./contextvm-scope-cleanup-design.md) — define the trim boundary and decide what can stay for transplant
2. [`contextvm-transplant-plan.md`](./contextvm-transplant-plan.md) — move only the relevant fixes onto the follow-up branch
3. [`contextvm-inherited-failure-issue-design.md`](./contextvm-inherited-failure-issue-design.md) — define the markdown issue that will explain the inherited-from-`master` failures and reference the transplanted branch
4. Create the issue that explains the inherited-from-`master` failures and notes that they must be addressed in the transplanted branch described by `contextvm-transplant-plan.md`
5. [`contextvm-e2e-skip-issue.md`](./contextvm-e2e-skip-issue.md) — draft the issue for the temporary skipped Playwright tests
6. [`contextvm-final-browser-cleanup.md`](./contextvm-final-browser-cleanup.md) — run `make browser-contextvm`, verify the happy path, then do the final cleanup commit

Important:

- Keep the Makefile available until the final browser validation is complete.
- Keep handover/debug docs around until the final cleanup commit if they are still needed for testing or review.
- If `Makefile` or handover docs are removed, do it in the final cleanup step together with any other no-longer-needed debug artifacts.

Related archived context docs still living under `docs/handovers/`:

- `browser-contextvm-debug-resolve-plan.md`
- `contextvm-ci-comparison-plan.md`
- `contextvm-ci-failure-comparison.md`
- `contextvm-review-feedback-plan.md`
