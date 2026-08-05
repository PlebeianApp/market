# ADR-016: E2E Test Parallelization Strategy

## Status

Proposed

## Date

2026-08-05

## Related

- `.github/workflows/e2e.yml` — current CI e2e workflow
- `e2e/playwright.config.ts` — Playwright configuration
- Branch `chore/ci-test-infra-sharding` — prior sharding attempt (2026-07-03)
- `e2e/AGENTS.md` — e2e constraints and seed execution approval requirement

## Context

The Plebeian Market e2e suite consists of **27 spec files containing 160 active
tests** (6 skipped). The suite is **100% serial**: `workers: 1`,
`fullyParallel: false`, single Chromium project. A full run takes approximately
**20 minutes**.

CI runs the suite in two modes:

- **`e2e-pricing`** (push/PR): ~6 pricing-only tests, 30-min timeout.
- **`e2e-full`** (workflow_dispatch/schedule only): everything except pricing
  + collections, 120-min timeout.

No sharding exists. The full suite only runs on weekly schedule or manual
trigger, meaning most PRs exercise a tiny fraction of the e2e coverage.

### Shared-Infrastructure Dependencies

All tests depend on a **single in-memory Nostr relay** (`nak serve` on port
10547) and a **single Bun dev server** (port 34567). These are shared across
the entire suite with no per-worker isolation.

### Fixed Test Identities

Tests use hardcoded fixture keypairs (`devUser1`–`devUser3` from
`src/lib/fixtures.ts`). Multiple workers acting as the same identity would
publish conflicting events (Kind 0 profile updates, cart resets, admin list
modifications).

### Cross-Test Order Dependencies

Two spec files explicitly acknowledge order dependencies:

- `user-profile.spec.ts`: depends on seeded "TestMerchant" profile data and
  notes relay persistence across runs.
- `zaps.spec.ts`: comment states "previous tests may have modified seeded
  products."

### Reset Helpers Mutate Global Relay State

Five spec files use `beforeEach` to reset shared relay state:
`cart.spec.ts` (resets devUser1 cart), `product-page.spec.ts` (seeds fresh
product), `pii-exposure-remediation.spec.ts` (deletes ALL Kind 16 events),
`app-settings.spec.ts` (resets blacklist/featured lists).

### Prior Work: `chore/ci-test-infra-sharding`

A branch from 2026-07-03 attempted CI sharding with 7 grep-based parallel
jobs. It includes useful flakiness fixes (networkidle → domcontentloaded)
and tooling (`extract-failures.ts`, `merge-results.ts`), but also bundles
unrelated deletions (spec files, ADRs, AUCTIONS.md) and is ~5 weeks stale.
The failure re-run machinery was written but never wired into the workflow.

## Decision

**Adopt a two-phase parallelization strategy:**

### Phase 1: CI Sharding (immediate, low risk)

Split the full e2e suite into **3–4 parallel CI jobs** using Playwright's
native `--shard=x/y` mechanism. Each shard gets its own relay + dev server
instance (the existing CI startup steps are duplicated per job via a GitHub
Actions matrix).

This is the highest-leverage, lowest-risk change:

- No test code changes required — sharding is transparent to tests.
- Each shard has complete infrastructure isolation (own relay, own server).
- `fail-fast: false` ensures all shards complete for full failure visibility.
- Estimated wall time: ~20 min → ~6–8 min with 4 shards.

**Why grep-based sharding (as in the prior branch) over `--shard`:**
Playwright's `--shard` distributes test files evenly by count, but does not
balance by runtime. Our tests have wildly unequal durations (navigation: 6
fast tests; payments: 7 slow tests with 120s timeouts). A grep-based
partition grouped by domain allows manual load balancing across shards.

**However**, `--shard` is simpler to maintain and Playwright 1.46+ does
attempt duration-based balancing. **Decision: start with `--shard` for
simplicity, switch to grep-based only if shard imbalance proves chronic.**

### Phase 2: Worker-Level Parallelism (medium-term, higher effort)

Enable `fullyParallel: true` and raise `workers` beyond 1 for individual
shards. This requires resolving the shared-state blockers:

1. **Per-worker relay instances**: Start `nak serve` on
   `10547 + TEST_WORKER_INDEX`. Make `RELAY_URL` a worker-scoped value
   instead of a module constant.
2. **Per-worker dev server** (optional): Each worker gets its own dev server
   on `34567 + TEST_WORKER_INDEX`, or workers share one server but each
   gets a unique `APP_PRIVATE_KEY` / relay namespace.
3. **Per-worker data isolation**: Derive d-tags and test identities from
   `TEST_WORKER_INDEX` to prevent concurrent replaceable-event collisions.

Phase 2 is only pursued if Phase 1 sharding alone is insufficient for CI
time targets, or if local development iteration speed becomes a bottleneck.

## Rationale

### Why CI sharding first (not worker parallelism)

| Factor | CI Sharding | Worker Parallelism |
|--------|-------------|-------------------|
| Infrastructure changes | None (duplicate existing steps per shard) | Per-worker relay + server + identities |
| Test code changes | None | Fixture refactor, data isolation |
| Risk of flaky failures | Low (each shard is fully isolated) | Medium (shared relay race conditions) |
| Speedup | ~3–4× (parallel jobs) | ~2–8× (depends on worker count) |
| Local dev benefit | None (CI-only) | Yes (faster local runs) |
| Effort | Low (1–2 days) | Medium-High (1–2 weeks) |

CI sharding delivers the most value with the least risk. The full suite
currently only runs weekly — bringing it to every PR at ~7 min is a massive
quality improvement.

### Why not reuse the `chore/ci-test-infra-sharding` branch directly

The branch contains valuable work but cannot be merged as-is:

1. **Unrelated deletions**: Removes spec files, ADRs, and AUCTIONS.md that
   are outside the sharding scope.
2. **Diverged design**: Implemented 7 grep-shards instead of the 3 blob-shards
   its own plan document specified. The blob-merge-rerun tooling is dormant.
3. **Stale**: ~5 weeks behind current branch head, would need rebase.
4. **Missing `--shard` approach**: Uses grep only, no native Playwright
   sharding.

**Action**: Cherry-pick the flakiness fixes
(networkidle → domcontentloaded, auth selector fixes, cart/checkout
rewrite) from the branch. Implement sharding fresh using `--shard`.

### Why 3–4 shards (not 7)

- GitHub Actions free tier: 20 concurrent jobs for public repos. 7 shards
  is sustainable but wasteful if each shard only has 2–3 test files.
- 3–4 shards gives ~5 min wall time per shard with ~40 tests each — good
  balance.
- Can scale up if test count grows.

### Why `fail-fast: false`

E2e tests are inherently flaky. Failing fast hides failures in other shards
that might share root causes. Full completion gives the complete failure
picture in one CI run.

## Consequences

### Positive

- Full e2e suite runs on every PR at ~7 min (vs. weekly-only at 20 min).
- Per-shard infrastructure isolation eliminates cross-test interference.
- Cherry-picked flakiness fixes improve test reliability.
- No test code changes in Phase 1 — low regression risk.

### Negative

- CI minute consumption increases (N shards × full setup overhead per shard).
  The nak build step (clone + `go build`) is duplicated per shard. Mitigation:
  pre-build nak in a base job, or use a Docker image with nak pre-installed.
- More moving parts in CI = more potential failure modes. Mitigation:
  shard summary job that aggregates results.
- Phase 2 (if pursued) is a significant refactoring effort with real risk of
  introducing race-condition flakiness.

### Neutral

- Local `bun run test:e2e` behavior unchanged in Phase 1 (still serial, 1
  worker). Local parallelism only arrives with Phase 2.
- The prior `chore/ci-test-infra-sharding` branch should be archived after
  cherry-picking useful commits.

## Implementation Notes

### Phase 1 CI Workflow Shape

```yaml
e2e:
  strategy:
    fail-fast: false
    matrix:
      shardIndex: [1, 2, 3, 4]
      shardTotal: [4]
  steps:
    # ... setup, relay, dev server (same as today) ...
    - run: bun run test:e2e -- --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}

e2e-summary:
  needs: e2e
  if: ${{ !cancelled() }}
  steps:
    # Download all shard artifacts, merge, publish report
```

### Nak Build Optimization

Replace per-shard `go install nak` with either:

- A shared "build" job that uploads nak binary as an artifact, or
- A Docker base image with nak pre-installed.

This saves ~30–60s per shard.

### Shard Balancing

Monitor per-shard wall time after initial rollout. If one shard consistently
runs 2× longer than others, switch to grep-based partitioning or adjust
`shardTotal`.

### Cashu Mint Dependency

The auction-mint tests (`auction-bidding-mints.spec.ts`,
`auction-mint-state.spec.ts`) hit public testnet mints
(`testnut.cashu.space`). This is a network flakiness source independent of
parallelization. A local Cashu mint (e.g. nutshell/cashu-stack) would
eliminate this dependency and make these tests deterministic. This is a
separate concern tracked as a follow-up.

## Alternatives Considered

1. **Delete the 4 fully-skipped spec files** (checkout, shipping-special,
   order-lifecycle, order-messaging = 6 tests). Reduces suite size but
   loses coverage intent. Rejected — tests should be fixed, not deleted.

2. **Reduce per-test timeouts** from 60s/90s to 30s. Would speed up failure
   cases but risk false negatives on legitimately slow tests (relay round
   trips, Cashu mint calls). Rejected as standalone change; keep as tuning
   follow-up.

3. **Replace `networkidle` waits** with `domcontentloaded` or
   `waitForSelector` globally. Valuable optimization, partially done on the
   sharding branch. Should be cherry-picked alongside Phase 1.

4. **Run only pricing tests on PRs** (status quo). Rejected — leaves 154
   tests without PR-level coverage.
