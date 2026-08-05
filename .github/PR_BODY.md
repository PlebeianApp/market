# PR Trust Pipeline — Automated Trust Layers for PR Review

## Summary

This PR adds a multi-layer trust pipeline to every pull request, providing reviewers with verifiable evidence before merge. It replaces Codecov with a self-hosted DIY coverage gate and adds mutation testing, visual proof, and a mandatory human-consumption merge gate.

## What's Included

**Layer 1 — DIY Diff-Aware Coverage Gate** (`coverage-gate.yml`)

- Runs only unit tests covering changed files (diff-scoped)
- Generates LCOV HTML reports, publishes to Blossom via nsite
- Posts coverage report URL as PR comment (idempotent)
- Sends Buzz #ci notification on completion
- Replaces Codecov (removed in this PR)

**Layer 2 — Playwright Trace + Video** (`e2e.yml`)

- Splits test suite into recording and non-recording projects
- Diff-affected specs get full trace + video + screenshots
- Happy-path baseline always records (can't regress)
- Markdown PR report with pass/fail summary

**Layer 3 — Stryker Mutation Testing** (`mutation.yml`)

- Uses Stryker's `command` runner (no `@stryker-mutator/bun-runner` exists)
- `coverageAnalysis: "off"` (required for command runner)
- Diff-scoped: mutates only changed files
- Warning-only (`continue-on-error`) — first adoption, non-blocking
- Defers native runner to ADR on `adr/vitest-migration` branch

**Layer H — Human-Consumption Merge Gate** (`.github/pull_request_template.md`)

- Renders checklist on every PR: trace evidence, live preview, coverage report, e2e results
- A human must tick these boxes personally — AI reviewer must not
- Enforced via AGENTS.md § "PR Trust Pipeline — Human-Consumption Merge Gate"

## What Was Dropped

- **Codecov** — replaced by DIY gate (commit 8d02c25). No external dependency.
- **Stryker native runner** — `@stryker-mutator/bun-runner` doesn't exist. Command runner used instead. Native runner deferred per ADR on `adr/vitest-migration` branch.

## Important Notes for Reviewers

1. **Buzz auth**: Uses NIP-98 HTTP auth (kind 27235) for relay POST, NOT kind 24242 (which is for Blossom server uploads).

2. **Coverage test selection**: `coverage-gate.yml` includes `scripts/` directory in test discovery — mirrors `test:unit` in `package.json` plus scripts. Comment added linking the two.

3. **ADR for Vitest/Stryker deferral**: Lives on `adr/vitest-migration` branch (separate from this PR). Documents when to migrate from `bun:test` to Vitest for native Stryker runner support.

4. **E2E test images**: Uses `E2E_TEST_IMAGE_URL` GitHub secret with `blossom2.orangesync.tech` fallback. This is a maintainer-operated test image CDN — replaces flaky `cdn.satellite.earth` dependency.

5. **Nsite actions pinned**: All `c03rad0r/plebeian-testing-nsite-actions` references pinned to commit SHA `dce2d40` (not `@main`) for supply-chain security.

6. **Blossom server**: Added `blossom2.orangesync.tech` to the public `BLOSSOM_SERVERS` list as a 7th option.

## Required Secrets

| Secret                | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `CI_BUZZ_PRIVATE_KEY` | Signs Buzz #ci notifications (NIP-29 kind 9) |
| `CI_BUZZ_RELAY_URL`   | Buzz relay endpoint                          |
| `CI_ANNOUNCE_NSEC`    | Signs nsite coverage report uploads          |
| `E2E_TEST_IMAGE_URL`  | Product image URL for e2e test fixtures      |

## Checklist

- [x] DIY coverage gate with 40 unit tests
- [x] LCOV HTML → Blossom → PR comment → Buzz notify
- [x] Stryker mutation testing (command runner, diff-scoped)
- [x] Playwright trace + video for diff-affected specs
- [x] E2E report PR comment
- [x] Human merge gate (PR template + AGENTS.md)
- [x] Codecov removed
- [x] All workflows use least-privilege permissions
- [x] All action references pinned to SHAs
- [x] No secrets in committed files (verified)
- [x] Prettier passes
