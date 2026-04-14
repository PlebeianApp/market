# ContextVM inherited-failure issue design

## Purpose

This document defines what should go into the GitHub issue that explains why the failing E2E tests are **not necessarily caused by the ContextVM PR itself**.

The issue must be a plain markdown body that can be pasted directly into GitHub.
It should give enough context for a follow-up branch to work from the transplanted branch and the baseline comparison evidence.

## Why this issue exists

We already compared:

- `compare/contextvm-first` — the baseline branch derived from `master`
- `compare/contextvm-head` — the ContextVM head branch

The comparison showed that several failures were **already present on the baseline branch**, so the issue must describe them as inherited failures, not automatically as regressions from the ContextVM change.

The issue should also point to the transplanted branch that will address the failures.

## What the issue should say

### 1) Clear summary

Open with a short statement like:

- these E2E failures existed on the baseline comparison branch
- they appear to be inherited from `master`
- they are being tracked separately from the ContextVM pricing feature
- they still need to be fixed in the transplanted branch

### 2) Branch references

Include the branch names explicitly:

- `compare/contextvm-first`
- `compare/contextvm-head`
- `feature/get-currency-context-vm`
- the new transplanted follow-up branch created from `contextvm-transplant-plan.md`

If the transplant branch already has a name when the issue is written, reference it directly.

### 3) Failure summary

List the broad failure classes that were seen on both branches, such as:

- checkout / payment UI controls not appearing
- order-event / relay publication timing failures
- collection-management visibility failures if they are part of the same CI output
- any other test failures that were present before the ContextVM branch work

The issue should distinguish between:

- the **main inherited failure bucket**
- any **extra flaky tests** that may still need follow-up but are not part of the main bucket

### 4) Evidence

Reference the comparison notes and the branch comparison results.
The issue should mention that the baseline branch is enough to reproduce the failures, which is why they are being treated as inherited.

Include specific details only if they help explain the problem, for example:

- `Error: expect(locator).toBeVisible() failed`
- missing payment buttons such as `Pay with WebLN`
- event count assertions staying at `0`

### 5) Scope statement

Be explicit that the issue is **not** asking for a broad cleanup of unrelated features.
It should say the fix belongs in the transplanted branch and should stay within the checkout/payment / failing-E2E scope.

### 6) Follow-up action

State the next step clearly:

- fix the inherited failures in the transplanted branch
- keep the scope narrow
- re-run the same comparison tests after the fix

## What not to include

The issue should **not** become a generic branch cleanup note.
Do not include:

- unrelated social/comments/messages/zaps cleanup
- NIP05 / vanity / profile cleanup
- broad deploy or release refactors
- long browser-debug runbooks
- temporary skip details beyond the short explanation that the skips were added while investigating

## Recommended issue structure

Use this format when drafting the GitHub issue:

1. **Title**
   - short and descriptive
2. **Summary**
   - inherited-from-master framing
3. **Branches compared**
   - baseline and head refs
4. **Observed failures**
   - bullet list of the failure buckets
5. **Why this is being tracked separately**
   - why it belongs in the transplanted branch
6. **Next step**
   - what the transplanted branch must fix
7. **References**
   - link or mention the comparison handover doc

## Suggested wording constraints

The issue should make these points unambiguously:

- the failures were **already present on the baseline branch**
- the baseline branch is derived from `master` without significant feature changes
- the failures are therefore **inherited**, not necessarily caused by the ContextVM PR
- the transplanted branch is the place to address them

## Acceptance criteria for the issue

The issue is good enough when another agent can read it and understand:

- what failed
- where the failure was observed
- why it is considered inherited from `master`
- which follow-up branch is responsible for fixing it
- what should be left out of scope
