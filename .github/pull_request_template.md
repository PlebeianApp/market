<!--
  PR Trust Pipeline — Human-Consumption Gate (Layer H)
  See docs/plans/pr-trust-pipeline.md § Layer H.
  The trust pipeline generates artifacts (trace, video, coverage report, E2E
  results) but cannot prove a human actually reviewed them. Checking the boxes
  below is the explicit anti-AI-vs-AI-loop gate. Do NOT check a box you did not
  personally perform; automated reviewers (bots, AI) must not satisfy it.
-->

## Summary

<!-- What does this PR change and why? -->

## Verification

<!-- How did you verify this change? Reference the trust pipeline artifacts posted on this PR. -->

### Human-consumption checklist (required before merge)

This is the gate that keeps a human in the loop. Check each box **only** after you personally performed the action.

- [ ] I reviewed the **Playwright trace/video evidence** — I opened `trace.zip` via https://trace.playwright.dev (or downloaded the `.webm`/`.png` artifacts) for at least one affected spec.
- [ ] I used the **live preview** when one was deployed for this PR, or noted here that no preview was available for this change.
- [ ] I reviewed the **coverage report** if a coverage check was configured for this PR.
- [ ] I reviewed the **E2E results report** comment (pass/fail/flaky summary + artifact links) posted by the trust pipeline.

### Reviewer disclosure

- [ ] This PR was **not** approved solely by an automated/AI reviewer. A human reviewer performed the checks above.

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Docs / CI / tooling
- [ ] Other

## Related issues / tasks

<!-- e.g. Closes #123 -->
