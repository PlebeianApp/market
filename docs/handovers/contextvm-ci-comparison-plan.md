# ContextVM pricing branch CI comparison plan

This document is a handoff for a future agent. The goal is to determine whether the current branch’s failing CI/E2E tests are caused by the ContextVM pricing refactor or whether they already existed on the branch point from `master`.

## Why this matters

The current feature branch changes how BTC exchange rates are resolved:

- it replaces the old remote price endpoint as the primary path
- it introduces a ContextVM/Nostr-based client for `get_btc_price`
- it keeps a Yadio fallback path for resilience
- it changes runtime config wiring so the client knows the ContextVM server pubkey and relay list

The CI failures observed so far are mostly in checkout/payment flows. Those flows depend on price conversion and invoice generation, so they may be legitimately related to the pricing refactor. We need an A/B comparison before treating them as unrelated flake.

## Current branch context

- Feature branch: `feature/get-currency-context-vm`
- Merge-base with repo default integration point: `8ef025e0f3d03a95ebb237b62fc36d51cac7d063`
- Merge-base message: `Restore shipping ref validation after V4V rebase`
- The remote-tracking branch used as the comparison base in this repo is `remotes/plebian/master`
- Local `main` does not exist in this checkout, so use `remotes/plebian/master` or the merge-base SHA above

## Working-tree caveat

At the time this note was written, the working tree was not clean.
If you want to do the comparison later, first decide whether to:

1. commit or stash the current WIP, or
2. create the comparison branches from a clean checkout

Do not mix the comparison work with unrelated local edits.

## Objective

Create two pushed branches and compare their CI outputs:

1. **Current head branch** — the exact branch tip with the ContextVM changes
2. **Baseline branch** — the exact merge-base commit where this branch split from `remotes/plebian/master`

The comparison should answer:

- Are the checkout/payment E2E failures reproducible only on the feature branch?
- Do the same tests fail on the baseline commit?
- Are the failures confined to pricing/invoice flows, or do unrelated tests also regress?

## Recommended branch names

Use temporary diagnostic branches, for example:

- `compare/contextvm-head`
- `compare/contextvm-base`

You can use different names if the repo already has conventions, but keep them clearly temporary and comparison-focused.

## Exact setup procedure

### 1) Confirm the base commit

```bash
git fetch plebian
BASE=$(git merge-base HEAD remotes/plebian/master)
echo "$BASE"
git show -s --oneline "$BASE"
```

Expected base commit for the current branch at the time of writing:

```text
8ef025e0f3d03a95ebb237b62fc36d51cac7d063 Restore shipping ref validation after V4V rebase
```

### 2) Create the head comparison branch

This branch should point to the current feature branch tip.

```bash
git checkout feature/get-currency-context-vm
git checkout -b compare/contextvm-head
```

Push it:

```bash
git push -u plebian compare/contextvm-head
```

### 3) Create the baseline comparison branch

This branch should point to the merge-base commit.

```bash
git checkout -b compare/contextvm-base "$BASE"
```

Push it:

```bash
git push -u plebian compare/contextvm-base
```

### 4) Trigger CI for both branches

Wait for the standard branch workflows to run on both comparison branches.
If the project uses manual reruns or a specific e2e workflow, trigger the same workflow for both branches.

## What to compare

Focus on the same jobs that failed in the feature branch run:

- `e2e-full`
- any checkout / payments / shipping special cases jobs
- any other job that covers the same payment or invoice flow

Record:

- pass/fail status
- failing test names
- failing assertion or selector
- whether the failure is deterministic or flaky
- whether the failure appears in the baseline branch too

## Expected interpretation

### If baseline passes and head fails

That strongly suggests the ContextVM pricing change introduced a regression.

Pay special attention to failures such as:

- missing `Pay with WebLN`
- missing `Pay later`
- missing `All Payments (N)`
- timeouts while waiting for invoice/payment UI

Those are likely downstream of price conversion / invoice generation.

### If baseline and head both fail in the same way

That suggests pre-existing CI flake or a shared environment problem.

In that case, note whether the failures are:

- identical
- mostly identical but with timing differences
- only present in the head branch after some additional delay

### If head fails but with different errors than baseline

That may indicate the branch made the app slower or changed the timing of state transitions without breaking the underlying logic.

## Suspicion ranking for this branch

Likely related to the ContextVM pricing refactor:

- checkout payment flow tests
- order lifecycle tests that wait for invoice UI
- shipping-special checkout tests
- multi-seller checkout invoice count tests
- payment event publication tests

Less likely to be directly related:

- product comment reaction visibility
- collection edit visibility

These may still be affected indirectly by startup timing, but they should be treated as a separate bucket unless the baseline comparison says otherwise.

## What to look for in logs

When a failure occurs, inspect:

- missing UI elements rather than wrong values
- rate fetch logs
- ContextVM client initialization logs
- fallback-to-Yadio logs
- invoice generation logs
- checkout state transition logs

Useful clues:

- the checkout page renders, but invoice/payment controls never appear
- the app falls back to Yadio too late or not at all
- the conversion query never resolves
- a price request times out and leaves the UI in a loading or empty state

## Suggested debugging questions for the future agent

1. Does the baseline branch render the payment UI correctly?
2. Does the head branch fail before or after the exchange-rate fetch?
3. Are the failing tests all waiting on the same page region?
4. Is there evidence that the ContextVM client is slower than the old remote endpoint path?
5. Did the removal of local caching make checkout/invoice rendering too dependent on network timing?
6. Is the Yadio fallback masking a failure in the main path, or does it also fail?

## Reporting format

When the future agent finishes, they should report back in this structure:

### Branches tested

- `compare/contextvm-head`: <CI result>
- `compare/contextvm-base`: <CI result>

### High-level conclusion

One paragraph stating whether the failures appear introduced by the ContextVM changes or pre-existing.

### Per-test comparison table

| Test / Job                         | Base result | Head result | Notes |
| ---------------------------------- | ----------- | ----------- | ----- |
| `e2e-full`                         |             |             |       |
| checkout / payments flow           |             |             |       |
| shipping-special flow              |             |             |       |
| order lifecycle flow               |             |             |       |
| unrelated product/collection tests |             |             |       |

### Evidence

Include:

- relevant CI links
- the specific failing assertion or selector
- any logs showing ContextVM fetch / fallback behavior

### Recommendation

Choose one of:

- fix the ContextVM pricing branch before merge
- treat the failures as pre-existing flake and document them
- split the branch further because checkout/payment concerns are now too broad

## Definition of done for the comparison exercise

The comparison is useful only if all of the following are true:

- both comparison branches were pushed
- both branches ran the same CI workflow(s)
- the outputs were compared against the same failure bucket
- a short report was written back into the PR or handoff notes

## Reminder

Do not use this as a replacement for code fixes if the branch introduced a real regression.
This document is only for controlled diagnosis and later reporting.
