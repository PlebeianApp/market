# ADR-015: Migrate Test Runner from Bun:test to Vitest for Stryker Mutation Testing

## Status

Proposed

## Date

2026-08-05

## Related

- PR Trust Pipeline (`feat/pr-trust-pipeline`)
- docs/plans/pr-trust-pipeline.md § Layer 1B

## Context

The PR Trust Pipeline implements a coverage gate (diff-aware, DIY) that
enforces every modified line is exercised by a unit test. This catches
untested code but does not verify that tests actually assert correct behavior.

Mutation testing (Stryker) was identified as the anti-gaming layer: it injects
small code mutations (e.g., `>` → `<`, removed conditions, flipped booleans)
and verifies the test suite detects them. A test that executes a line without
asserting results would let a mutation "survive," exposing lazy coverage.

**Problem:** Stryker requires a test runner plugin to execute the test suite.
The market repo uses Bun's built-in test framework (`bun:test`). As of
August 2026:

1. `@stryker-mutator/bun-runner` does not exist on npm (404). No official
   Bun runner has been announced.
2. The only community attempt (`menoncello/stryker-bun-runner` v0.4.0) is
   stale, targets Stryker API v8 (current is v9.6.1), and has a critical
   correctness bug (#19: crash-at-load mutants misreported as Survived).
3. Stryker officially supports: Jest, Mocha, Vitest, Karma, Jasmine.

The market repo could use `@stryker-mutator/vitest-runner` (v9.6.1, actively
maintained) if the test runner were migrated from `bun:test` to Vitest.

## Decision

**Defer mutation testing. Ship the PR Trust Pipeline without Stryker.**

When the decision to migrate from `bun:test` to Vitest is made (by project
maintainers), Stryker mutation testing can be added as a follow-up with minimal
effort — the vitest-runner is production-ready.

This ADR documents the rationale for the deferral and the precondition for
future Stryker adoption.

## Rationale

### Why not migrate now

1. **Scope mismatch.** The PR Trust Pipeline is a CI/infra change. Migrating
   the test runner is a codebase-wide change affecting every `*.test.ts` file,
   every `import { test, expect } from "bun:test"` statement, and CI workflow
   commands. Conflating these risks in a single PR is poor hygiene.

2. **Bun benefits.** `bun:test` is fast, has zero-config, and integrates
   natively with the Bun runtime that the market repo already uses for
   builds and dev server. Vitest would add a dependency and configuration
   layer.

3. **Coverage gate is sufficient for v1.** The DIY diff-aware coverage gate
   (40 tests, TDD-verified) catches the most common problem: untested
   modified lines. Stryker catches a subtler problem: tests that touch code
   without asserting behavior. The former is higher value for the initial
   trust pipeline.

4. **No blocker for upstream PR.** The trust pipeline (coverage gate +
   Playwright traces + human merge gate + LCOV HTML reports + Blossom
   publishing + Buzz notifications) is fully functional without mutation
   testing.

### When to revisit

Any of these triggers should reopen this decision:

- The market repo migrates to Vitest for any other reason (e.g., better
  watch mode, IDE integration, ESM handling)
- Stryker publishes an official `@stryker-mutator/bun-runner`
- Bun adds native mutation testing support
- Coverage gaming becomes a demonstrated problem (tests written to satisfy
  the gate without meaningful assertions)

## Consequences

- **Positive:** PR Trust Pipeline ships sooner. No large migration risk.
  Decision is documented for future reference.
- **Negative:** Tests could be "lazy" (execute code without asserting
  results) and the coverage gate wouldn't catch it. Human review is the
  remaining safeguard against this.
- **Neutral:** Stryker integration becomes a well-scoped follow-up task
  gated on the Vitest migration decision.

## Migration Path (when adopted)

1. Add `vitest` as devDependency
2. Replace `import { test, expect } from "bun:test"` with
   `import { test, expect } from "vitest"` across all `*.test.ts` files
3. Update CI workflow commands: `bun test` → `npx vitest` (or
   `bunx vitest`)
4. Update `bun run test:unit` script in package.json
5. Verify coverage output format (Vitest generates LCOV natively)
6. Add `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`
7. Configure `.stryker.conf.json` with diff-aware mutation scope
8. Add mutation testing CI step to coverage-gate workflow
