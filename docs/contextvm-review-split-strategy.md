# ContextVM Review Split Strategy

## Problem

Pull request #735 accumulated several different kinds of changes at once:

- ContextVM currency server feature work
- reviewer-requested follow-up refactors
- test script changes
- deployment/process manager changes
- E2E and CI stabilization work

That made it hard to tell which changes were responsible for CI failures. After attempting to adapt the branch to review feedback, CI failures expanded beyond the original feature area and we lost a clear signal about which modifications were safe.

The branch was therefore rolled back to the last known good feature commit:

- `bc861176f4193b57068b73c3f6547ab5a5a8eafe` — `test: add endpoint contract coverage and stabilize cache expiry`

## Goal

Recover a reliable development path by splitting the review feedback into narrow branches that each represent one concern and can be validated independently in CI.

## Approach

Create a fresh integration/planning branch from `bc861176f4193b57068b73c3f6547ab5a5a8eafe` and then create separate feature branches from the same commit for each follow-up area:

1. `feature/contextvm-server-runtime-rename`
2. `feature/ctxcn-client-checkin-and-naming`
3. `feature/test-script-generalization`
4. `feature/deploy-contextvm-pm2`
5. `feature/fix-e2e-flaky-price-and-payment` (or a clean split branch if the original branch name is already occupied)

Each branch gets its own design document and should stay narrowly scoped.

## Working Rules

- Branches start from the same known-good base commit.
- Each branch addresses exactly one reviewer-requested concern.
- CI results are interpreted per branch rather than across a combined stack.
- E2E flake fixes stay separate from ContextVM runtime and deployment changes.
- Only changes proven safe in isolation should later be combined.

## Expected Outcome

This split should let us answer the key question cleanly:

- which review changes are safe on their own,
- which ones trigger CI regressions,
- and whether the regressions live in runtime code, workflows, test scripts, or E2E timing.

Once those branches have run in CI, we can recombine the passing changes intentionally instead of continuing to debug one overloaded branch.
