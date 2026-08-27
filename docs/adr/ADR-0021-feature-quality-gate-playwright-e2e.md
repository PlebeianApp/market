# ADR-0021: Feature Quality Gate — Playwright E2E with Video Evidence

## Status

Proposed

## Date

2026-08-27

## Related

- ADR-0005 — no external service dependencies in tests (isolation rules
  the E2E gate must obey)
- ADR-0002 — e2e reliability is the migration's gating metric
- Existing infrastructure: `e2e/` (Playwright config, fixtures, helpers,
  scenario tests, seeded local relay via `nak serve`)

## Context

The maintainer (Felix, 2026-08-27) set a standing standard for the
repository:

> "full playwright based end to end test of the new functionality
> published to the respective PR to prove that the logic works as
> intended. This should be the final quality gate of any feature we
> implement in plebeian market."

Prior to this, e2e coverage was a per-PR judgment call: some feature PRs
shipped with targeted specs, others relied on unit tests and manual
review. E2e flakiness history (multiple dedicated reliability branches
and PRs) had pushed the suite toward skepticism rather than trust, which
weakens it as a merge gate precisely when greenfield features (auctions,
wallet rebuild) are landing on new architectures where unit tests cannot
prove the wiring works.

The infrastructure to make this cheap already exists: `e2e/` contains
the Playwright config (chromium project, trace/screenshot/video
retention), fixtures, scenario tests, seeded local relay, and the mock
patterns ADR-0005 established (`lightning-mock`, `nip46-mock`,
`lnurl-mock`, `page.route()` interception). Video capture is already
configured (`video: 'retain-on-failure'`); the gate requires the video
to be published regardless of pass/fail outcome where it carries
evidence.

## Decision

Every feature PR in Plebeian Market must pass a Playwright E2E quality
gate before merge:

1. **A targeted E2E test proving the new functionality.** The feature's
   PR includes at least one Playwright spec in `e2e/` that exercises
   the user-visible flow end to end — not just unit-level logic. The
   spec asserts the intended behavior; it is not a smoke check.
2. **Video evidence published to the PR.** A video of the E2E run
   proving the logic works as intended is attached to (or linked from)
   the respective PR. Reviewers can see the feature working, not just
   read assertions.
3. **This is the final quality gate.** Unit tests, `format:check`, and
   existing suite coverage remain earlier gates; the E2E run with
   published video is the last checkpoint before merge. A feature PR
   without its E2E spec and video is incomplete.

Scope and rules:

- Applies to feature PRs that change application behavior visible to
  users or to test-observable flows. Docs-only PRs, dependency bumps
  without behavior change, and refactors verified by the existing suite
  are exempt unless the change touches the e2e harness itself.
- All gate tests must obey ADR-0005 isolation: local relay
  (`nak serve`), local dev server, mocked mints and external services,
  no external network. A video recorded against external services is
  not acceptable evidence.
- Flaky gate specs must be stabilized before merge (fix the spec or the
  bug), not retried into green or skipped.

## Consequences

Positive:

- "Works as intended" becomes a reviewable artifact (the video) instead
  of a claim, which matters most for greenfield flows (auctions, wallet)
  where regressions are expensive to discover post-merge.
- The existing e2e investment is promoted from best-effort to a
  first-class merge gate, which also raises the cost of letting the
  suite rot.
- Videos localize failures: CI logs say a selector failed, the video
  shows what the user actually saw.

Negative / tradeoffs:

- Slower PR cycle: feature PRs carry test-authoring and (CI) runtime
  cost proportional to the feature.
- Video artifacts need storage/retrieval discipline (attach to the PR,
  or link from a CI run) so evidence outlives the workflow run.
- The gate is only as strong as ADR-0005 isolation; a spec that quietly
  reaches an external service undermines the evidence and must be
  treated as a defect.

## References

- Maintainer direction: Felix, 2026-08-27 (quoted in Context)
- ADR-0005: `docs/adr/ADR-0005-no-external-service-dependencies-in-tests.md`
- E2E harness: `e2e/playwright.config.ts`, `e2e/tests/`,
  `e2e/scenarios/`, `e2e/helpers/`, `e2e/utils/`
