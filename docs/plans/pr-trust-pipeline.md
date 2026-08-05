# PR Trust Pipeline — Comprehensive Plan

**Goal:** Compress the review→merge loop from days to hours by providing automated trust signals on every PR: coverage gates, visual proof (happy-path videos), and live preview environments.

**Branch:** `feat/pr-trust-pipeline` on `felixfelix-bot/market`
**Date:** 2026-07-30

---

## Problem Statement

AI compresses implementation from weeks to hours. But the review loop still takes days because:

1. No coverage enforcement — reviewers can't trust that code is tested
2. No visual proof — reviewers can't see what the feature does without checking out the branch
3. No live preview — reviewers can't click through without local setup
4. Reviewers set AI on review, creating an AI-vs-AI review loop with no human grounding

**Solution:** Three layers of automated trust signals, delivered directly in the PR.

---

## Layer 1: Coverage Gate

**Requirement:** Every modified or introduced piece of logic must have test coverage.

### Phase 1A — Diff-Aware Coverage Gate (IMPLEMENTED)

**Status:** Implemented on `feat/pr-trust-pipeline`. Shipped:

- `scripts/check-coverage.ts` — the gate. Pure, unit-tested parsers (65 tests,
  ≥94% self-coverage) plus subprocess runners isolated behind a `CoverageRunners`
  interface.
- `scripts/check-coverage.test.ts` — TDD test suite for the gate.
- `scripts/git-hooks/pre-push` — local **soft** gate (warns, does not block).
- `.github/workflows/coverage-gate.yml` — CI **hard** gate (blocks merge).
- `package.json` — `check-coverage` script; `prepare` wires both hooks.

**How it works:**

1. Runs `git diff ${COVERAGE_BASE_REF:-origin/master}...HEAD --unified=0` and
   extracts the NEW-file line numbers of every added/modified `.ts`/`.tsx` line.
2. Runs `bun test --coverage --coverage-reporter=lcov` and reads the emitted
   `lcov.info` for precise per-line hit counts.
3. Cross-references: a modified line is a violation only if it is explicitly
   marked uncovered (hit count 0) in the coverage data.
4. Exits `0` if all modified lines are covered; `1` if any are uncovered; `2`
   on internal error.

**Why LCOV, not the text table:** bun's text-table "Uncovered Line #s" column
is unreliable — observed empty for some files despite `<100%` line coverage
(the column is truncated when output is piped). LCOV `DA:<line>,<hit>` records
give exact per-line data, so the text-table parser is kept only as a fallback
inside the unified `parseCoverage()` auto-detector.

**Scope:** only modified `.ts`/`.tsx` files are gated. Test files
(`*.test.ts`/`*.spec.ts`), the `e2e/` tree, and `node_modules/` are excluded.
Pre-existing untested code is NEVER blocked — only diff lines.

**Env knobs:**

- `COVERAGE_BASE_REF` — diff base (default `origin/master`; CI sets
  `origin/${{ github.base_ref }}`).
- `COVERAGE_TEST_PATHSPEC` — dirs/globs passed to `bun test` (default
  `src contextvm`). CI overrides with the unit-test selection (mirrors
  `test:unit`, excludes `*.integration.test.ts` which need a relay/server).
- `COVERAGE_BUN` — bun binary path (default `bun`).
- `COVERAGE_GATE_SKIP=1` — silence the local soft gate.

**Validation criteria (met):**

- Gate exits 1 when a new function has no test (verified end-to-end on a
  throwaway repo: uncovered `multiply()` → `exit 1` flagging its line; after a
  test is added → `exit 0`).
- Gate does NOT block on pre-existing untested code (diff-scoped).
- Runs in <30s locally, <2min in CI.

**Known limitation:** the coverage run uses the unit-test suite. A modified
file covered only by integration tests would show as uncovered — mitigated by
the `coverageExitCode` note in the report. Phase 1B (function-level) may refine
this.

### Phase 1B — Self-Hosted Coverage Report (Blossom + Buzz) (IMPLEMENTED)

> **Codecov was dropped** (2026-08-05, commit `8d02c25`): it requires
> GitHub-App OAuth and forge-dependent PR comments, incompatible with the
> ngit/nostr git roadmap. The DIY gate from Phase 1A is reinstated as the sole
> diff-aware coverage gate; **the required status check for branch protection is
> `coverage-gate`**.

**Status:** Implemented on `feat/pr-trust-pipeline`. A fully self-hosted
coverage pipeline built on top of Phase 1A's DIY gate — no third-party SaaS, no
OAuth app, no manual GitHub admin. The gate stays the hard merge gate AND now
also feeds a browsable HTML report published to Blossom, announced via Buzz.

**What's in `coverage-gate.yml` (the single coverage workflow):**

1. **Generate LCOV once** — `bun test --coverage --coverage-reporter=lcov` over
   the unit suite (same selection as `test:unit`).
2. **DIY diff-aware gate (HARD)** — `scripts/check-coverage.ts` reuses that LCOV
   via the new `COVERAGE_LCOV_FILE` env knob (no second test run). Only modified
   `.ts`/`.tsx` lines are gated; this step's failure is the only one that blocks
   merge.
3. **HTML report** — `genhtml` (from the `lcov` apt package) renders the LCOV
   into a browsable annotated-source tree at `coverage/html/`.
4. **Blossom publish** — the `publish-nsite` action (same one the E2E dashboard
   uses) deploys `coverage/html/` to Blossom with an ephemeral key, yielding a
   public `https://<npub>.nsite.orangesync.tech/` URL. `CI_ANNOUNCE_NSEC`
   (optional) signs the discoverability announcement.
5. **Notify** — an idempotent PR comment (found/updated via a marker tag) and a
   Buzz `#ci` notification both carry the report URL.

**File scope:** whatever the unit suite instruments — `src/`, `contextvm/`, and
`scripts/` are all reported. The gate still only enforces MODIFIED lines, so
pre-existing untested code is never blocked.

**Relationship to Phase 1A:** the script is unchanged in behavior; the
`COVERAGE_LCOV_FILE` knob is purely additive (default path still spawns
`bun test --coverage`). The local pre-push soft gate is unaffected.

**No manual steps required.** (If `CI_ANNOUNCE_NSEC` is unset, the report still
deploys via the ephemeral key — only the signed announcement is skipped.)

**Step B2 — Parallel multi-server Blossom redundancy (IMPLEMENTED):** The
`publish-nsite` action's `publish.sh` now passes all 5 Blossom servers as a
single comma-separated `--servers` list to one `nsyte deploy` call, instead of
looping through servers sequentially (one `nsyte deploy` per server). nsyte
already uploads to all servers concurrently within a single deploy (per-server
concurrency workers, shared scan/compare/publish cycle). The old sequential loop
was the root cause of the 5–10 minute publish timeouts on large genhtml reports
(t_26317db1) — each of the 5 iterations re-scanned the entire directory,
re-compared all files, and re-published nostr events independently. The
min-success gate (default 2 of 5 servers) is preserved by parsing nsyte's
"Blossom Server Summary" output for per-server success counts.

### Phase 1C — Custom Diff-Aware Coverage (function-level, after 1A validated)

- **What:** AST-level diff analysis for function-level coverage enforcement
- **Tool:** TypeScript compiler API (`ts-morph`) to parse changed files, identify which functions/methods were modified, and map them to test coverage
- **Advantage:** "This function was changed but no test calls it" (more precise than line-level)
- **Status:** Design phase. Implement after 1A is validated and merged. Largely
  superseded in signal quality by Phase 1D mutation testing (below), which catches
  the "test calls the function but asserts nothing" case that function-level
  coverage still misses.

### Phase 1D — Mutation Testing (Stryker, diff-scoped) (IMPLEMENTED)

**Status:** Implemented on `feat/pr-trust-pipeline`. WARNING-ONLY — a low
mutation score never blocks merge. Stryker mutates the production code changed in
the PR and checks whether the unit suite catches each mutation. This is the only
coverage metric that resists the **"touch a function without asserting"** gaming
attack: a test that merely calls a function (100% line/branch/AST coverage) yields
0% mutation score if no assertion fails when the code is mutated.

**Why mutation testing, not just more AST coverage:** line-level (Phase 1A) and
function-level (Phase 1C) coverage are both gameable — a test that calls a
function but asserts nothing gets full coverage. Stryker flips the question from
"was this line executed?" to "would a change here be caught?", which is strictly
stronger evidence of test quality.

**What's in `.github/workflows/mutation.yml`:**

1. **Scope** — `scripts/stryker-changed-files.ts` runs `git diff --name-only` vs
   the base ref and filters to mutable `.ts`/`.tsx` source files (drops tests,
   `.d.ts`, `e2e/`, generated, `node_modules/`). If nothing mutable changed, the
   job exits 0 immediately.
2. **Mutate** — a runtime config (`stryker.run.json`) is generated from the
   committed base `stryker.config.json` + the dynamic `mutate` array, then
   `stryker run` mutates only the changed files.
3. **Score** — Stryker's `mutation.json` report is parsed into an aggregate score
   (killed / survived / no-coverage / timeout), excluding `RuntimeError` and
   `CompileError` from the denominator (matching Stryker's own formula).
4. **Comment** — `scripts/mutation-comment.ts` renders an idempotent PR comment
   (marker `<!-- pr-mutation-report -->`) carrying the score, mutated-file list,
   and a ⚠️ warning when below the 50% break floor. Re-runs update the same
   comment.

**Thresholds:** `{ high: 80, low: 60, break: 50 }`. Below `break` (50%) the
comment shows a 🔴 warning. The gate is **never** a hard block today — promotion
to a required status check is a deliberate later step once the baseline is green.

**Config notes:**

- `coverageAnalysis: "off"` — there is no native Stryker runner for `bun test`, so
  the built-in `command` runner wraps the full unit suite (inferred pass/fail from
  the exit code). The command runner reports no per-test coverage, so `perTest` is
  unavailable; mutation testing still works, just slower (full suite per mutant).
- The `mutate` array is **not** in `stryker.config.json` — it is injected
  dynamically per-PR by the scope script. Run via `bun run mutation:diff`, not
  `stryker run` directly.
- Stryker requires a **green baseline** (all unit tests pass on unmutated code)
  before it can mutation-test. If any pre-existing test fails, Stryker exits early
  without writing a report; the warning-only design surfaces this as a "no
  mutants" comment rather than blocking.

**Local run:** `bun run mutation:diff` (uses `origin/master` as the base ref;
override with `MUTATION_BASE_REF`). Render-only: `bun run mutation:comment`.

---

## Layer 2: Visual Proof (Happy-Path Videos)

**Requirement:** Record happy-path Playwright videos, post in PR comments so reviewers see the feature working.

### Approach: Extend Existing nsite Dashboard

Build on `c03rad0r/plebeian-testing-nsite-actions` — already 90% done.

**Changes needed:**

1. **Playwright config** (`e2e/playwright.config.ts`):
   - Change `video: 'retain-on-failure'` → `video: 'on'` for happy-path specs
   - Change `screenshot: 'only-on-failure'` → `screenshot: 'on'` for all specs
   - Add CI JSON reporter alongside github reporter

2. **render-dashboard action** (`plebeian-testing-nsite-actions/.github/actions/render-dashboard/render_dashboard.py`):
   - Add `<video>` tag support in test cards
   - Copy video files alongside screenshots into dashboard output
   - Show inline video player in the dashboard HTML

3. **publish-nsite action** (`plebeian-testing-nsite-actions/.github/actions/publish-nsite/publish.sh`):
   - Fix known DNS bug: hex→bech32 npub conversion, subdomain URL format
   - Upload video files to Blossom alongside HTML
   - Post PR comment with dashboard URL

4. **e2e.yml workflow** (`market/.github/workflows/e2e.yml`):
   - Add render-dashboard + publish-nsite steps after test run
   - Set `CI_ANNOUNCE_NSEC` secret (pending from Felix)

5. **Happy-path spec convention:**
   - Specs tagged `@happy-path` in test title (e.g., `"User can browse products @happy-path"`)
   - CI runs happy-path specs with `--video on`
   - Other specs keep existing `retain-on-failure` behavior

**Validation criteria:**

- Video plays in the nsite dashboard
- PR comment contains clickable link to dashboard
- Dashboard shows pass/fail status, screenshots, AND video for each test

### Layer 2c — Wiring Status (complete)

**What landed on `feat/pr-trust-pipeline`:**

1. **Playwright JSON reporter** (`e2e/playwright.config.ts`) — CI now emits a JSON
   report to `test-results/results.json` alongside the `github` reporter. This is
   the structured input the `render-dashboard` action needs (per-test statuses,
   attachments, durations).
2. **`render-dashboard` + `publish-nsite` wired into `e2e-pricing`**
   (`.github/workflows/e2e.yml`) — after the test run and artifact upload, the
   dashboard is rendered from `test-results/` and published to nsite via Blossom
   using the `CI_ANNOUNCE_NSEC` secret. Both steps run with `if: !cancelled()` so
   a failing suite still produces a dashboard showing the failure.
3. **Idempotent PR comment** (`scripts/e2e-pr-comment.ts`) — a pure
   `formatComment()` formatter (15 unit tests) plus a `main()` that finds an
   existing comment by a hidden marker tag and **updates** it rather than posting
   a duplicate. The `publish-nsite` action's built-in one-line comment is
   suppressed (no `pr-number` passed) so the richer comment is the single source.
4. **Buzz notify fix** — the pricing job's Buzz step referenced a non-existent
   `steps.test.outcome`; corrected to `steps.e2e-test.outcome`.

**Remaining for full Layer 2 (separate tasks):**

- Task 2A (Playwright `video: 'on'` / `screenshot: 'on'`) — not yet on this branch.
- Task 2B/2D (`render-dashboard` `<video>` support + nsite DNS hardening) —
  tracked on `c03rad0r/plebeian-testing-nsite-actions`.

---

## Layer 3: Live Preview (Per-PR Subdomain Auto-Deploy)

**Requirement:** Every push auto-deploys to a testable URL, auto-destroyed after TTL.

### Phase 3A — Docker-on-VPS (start here)

Use existing `plebeian-market-e2e-infra` Ansible playbooks.

**Architecture:**

- GitHub Action triggers on PR push
- Action SSHes into test VPS, runs `deploy-pr` Ansible playbook
- Playbook creates Docker containers: market app + relay on per-PR ports
- Caddy auto-configures subdomain: `pr<N>.test-market.orangesync.tech`
- Cloudflare DNS A record created via API
- Action posts live URL in PR comment
- Separate teardown job runs after 30min TTL (or on PR close/merge)

**Files to create:**

1. `.github/workflows/preview-deploy.yml` — triggers on PR, deploys, posts URL
2. `.github/actions/teardown-preview/` — composite action for cleanup
3. Wire to existing `plebeian-market-e2e-infra/ansible/playbooks/deploy-pr.yml`

**Infrastructure (pending from Felix):**

- Fresh VPS on Sovereign Hybrid Compute (Felix provisioning)
- npub-gated access for security
- Domain: `test-market.orangesync.tech` (or new domain for Sovereign VPS)

### Phase 3B — Firecracker VMs (roadmap)

- Self-hosted Firecracker microVMs on Sovereign Hybrid Compute
- Full isolation, ~125ms boot, auto-destroy
- eCash payment integration
- **Status:** Design phase. After 3A is validated.

---

## Layer H — Human-Consumption Gate (anti-AI-vs-AI-loop)

**Problem:** Layers 1–3 produce trust artifacts (coverage report, Playwright
trace/video, E2E results comment, live preview) but nothing forces a human to
actually consume them. Without an explicit human-acknowledgment gate, the
pipeline perpetuates the AI-vs-AI review loop it was built to fix: an AI opens
the PR, an AI reviews it, artifacts are generated and never opened.

**Goal:** A human must explicitly acknowledge they consumed the trust artifacts
before a PR may merge.

### Mechanism

1. **PR template checklist — `.github/pull_request_template.md`.**
   Every new PR opens with an unchecked human-consumption checklist that the
   author/reviewer must tick:
   - I reviewed the Playwright trace/video evidence (`trace.zip` via
     https://trace.playwright.dev, or the `.webm`/`.png` artifacts).
   - I used the live preview when one was deployed (or noted none was available).
   - I reviewed the coverage report (`coverage-gate` passed / published artifact).
   - I reviewed the E2E results report comment.
     The checklist also requires a reviewer disclosure: "This PR was not approved
     solely by an automated/AI reviewer."
2. **Branch protection on `master`** (GitHub metadata, set by an admin):
   - Require pull-request review approval.
   - Require conversation resolution (an open/unresolved conversation blocks merge).
   - Required status checks: `coverage-gate` and `e2e-pricing`.
3. **Documentation.** This section plus the PR template are the in-repo gate.

### Status

- **In-repo gate (this task):** `.github/pull_request_template.md` + this section
  ship on `feat/pr-trust-pipeline`. These are reviewable, version-controlled,
  and self-documenting.
- **Branch protection (metadata step, needs a human/admin):** not yet applied.
  See "Open branch-protection decision" below.

### Open branch-protection decision (human/admin gate)

The original Layer H spec listed `codecov/patch` as a required status check and
`master` + `auctions` as protected branches. Both are stale against the current
repo state:

- **Codecov was dropped** (commit `8d02c25`, see Phase 1B). The required coverage
  check must be `coverage-gate` (the DIY LCOV gate), not `codecov/patch`.
- **No `auctions` branch exists** on `felixfelix-bot/market` (only `master` and
  `feat/pr-trust-pipeline`). `auctions`-branch protection belongs on the
  Plebeian auction repos, not here.
- **`master` is currently unprotected** (the spec's "review approval already
  enforced" does not hold). The `coverage-gate` workflow does **not** yet exist
  on `master` (it ships with this feature branch), so requiring it on `master`
  should happen **after** `feat/pr-trust-pipeline` merges.

Recommended command for an admin to run **after** the feature branch merges to
`master` (do not run before merge — it would deadlock on checks absent from
`master`):

```bash
gh api -X PUT repos/felixfelix-bot/market/branches/master/protection \
  -H "Accept: application/vnd.github+json" --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "contexts": ["coverage-gate", "e2e-pricing"] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

This metadata change is intentionally a human/admin action: it locks merge rules
for the main branch and is not version-controlled.

---

## Implementation Order

| Priority | Task                                   | Depends on           | Estimated effort |
| -------- | -------------------------------------- | -------------------- | ---------------- |
| P0       | 1A: Bun coverage hook + CI             | Nothing              | 1 kanban task    |
| P0       | 2A: Video in playwright config         | Nothing              | 1 kanban task    |
| P0       | 2B: Extend render-dashboard for video  | 2A                   | 1 kanban task    |
| P0       | 2C: Wire e2e.yml for dashboard publish | 2B, CI_ANNOUNCE_NSEC | 1 kanban task    |
| P0       | 2D: Fix nsite DNS bug                  | 2B                   | 1 kanban task    |
| P1       | 3A: Preview deploy GitHub Action       | VPS from Felix       | 2 kanban tasks   |
| P1       | 3A: Preview teardown automation        | 3A deploy working    | 1 kanban task    |
| P2       | 1B: Custom diff-aware coverage         | 1A validated         | 2 kanban tasks   |
| P3       | 3B: Firecracker VMs                    | 3A validated, eCash  | Design phase     |

---

## Quality Gates

Every task in this plan must pass:

1. **TDD** — Test exists and was observed failing before implementation
2. **Tests pass** — Full suite run, output verified
3. **Docs updated** — In the same commit as code changes
4. **Atomic commits** — One concern per commit, conventional messages
5. **PUSHED** — `git push` succeeded, remote verified
6. **Cold review** — Fresh eyes review the diff

---

## Worker Profile Assignments

| Task                                | Worker profile | Model   | Rationale            |
| ----------------------------------- | -------------- | ------- | -------------------- |
| Coverage hook script (1A)           | worker-balloon | glm-5.2 | Code writing, TS/Bun |
| Playwright config change (2A)       | worker-balloon | glm-5.2 | Config edit          |
| render-dashboard video support (2B) | worker-balloon | glm-5.2 | Python + HTML        |
| nsite DNS fix (2D)                  | worker-balloon | glm-5.2 | Shell script fix     |
| e2e.yml wiring (2C)                 | worker-balloon | glm-5.2 | YAML workflow        |
| Preview deploy Action (3A)          | worker-balloon | glm-5.2 | YAML + Ansible       |
| Custom diff coverage (1B)           | worker-balloon | glm-5.2 | TS compiler API      |

---

## Secrets / Config Needed (from Felix)

| Item                         | Status                                         | Purpose                 |
| ---------------------------- | ---------------------------------------------- | ----------------------- |
| Sovereign Hybrid Compute VPS | PENDING — Felix provisioning in 30min          | Preview deploy target   |
| CI_ANNOUNCE_NSEC             | SET (fork secret)                              | nsite dashboard publish |
| Sovereign npub key           | GENERATED — nsec1c3vtt0s... (see below)        | VPS auth/access         |
| Cloudflare API token         | EXISTING — in tollgate-infrastructure-kit .env | DNS for subdomains      |
| Blossom server               | EXISTING — blossom.orangesync.tech             | Video/upload hosting    |
| Test VPS SSH key             | PENDING — need from Felix                      | GitHub Action → VPS     |

### Generated Sovereign Hybrid Compute Bot Key

Key generated via `nak key generate`. Felix has the nsec — will add to GitHub Actions secrets as `SOVEREIGN_BOT_NSEC` on felixfelix-bot/market.

npub: `npub1nt0gkyl2vah03z9sg07n62fd7cp6q97qhk3mhrmrnxk4xvjqs07q62qfgv`

---

## Repository Strategy

| Repo                                                       | Role                     | Changes                                                 |
| ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `felixfelix-bot/market` (branch: `feat/pr-trust-pipeline`) | Main work branch         | Coverage hook, e2e.yml changes, preview-deploy workflow |
| `c03rad0r/plebeian-testing-nsite-actions`                  | Dashboard publishing     | Video support, DNS fix                                  |
| `plebeian-market-e2e-infra`                                | Ansible deploy playbooks | Already built, just needs GitHub Actions wiring         |
| `tollgate-infrastructure-kit`                              | VPS infra reference      | Read-only — reference for Ansible patterns              |

**Workflow:** All changes go to `feat/pr-trust-pipeline` on felixfelix-bot/market. Test CI on the fork. Once validated, PR upstream to PlebeianApp/market.

---

## Testing on felixfelix-bot/market

Per Felix's instruction: do NOT test on c03rad0r/market. All work goes to felixfelix-bot/market fork.

---

## Open Questions (for follow-up)

1. Sovereign Hybrid Compute API — need API endpoint + auth details for provisioning
2. Firecracker VM host — who manages, what CLI/API, eCash payment flow
3. Production VPS — confirm none currently running (Felix says fresh start)
4. Domain for preview subdomains — use existing test-market.orangesync.tech or new domain on Sovereign VPS?
5. Happy-path spec naming convention — `@happy-path` tag in title, or separate spec files?

---

## Phase B — Hermetic Media

### Step B1: Local Blossom server in CI — hermetic test images (IMPLEMENTED)

**Problem:** E2E tests referenced external `https://placehold.co/...` image URLs
(product images, collection fixtures, app-settings picture/banner). If
placehold.co is rate-limited, slow, or down, image-dependent tests fail for
reasons unrelated to the code under test — breaking the hermetic-guarantee goal
of the trust pipeline.

**Solution:** `nak serve` (the local relay already running in CI) is started with
`--blossom`, exposing a Blossom media server on the same port (10547) at zero
additional dependency cost (nak is already built + installed in the workflow).
A committed 600×600 PNG fixture (`e2e/fixtures/test-image.png`) is seeded to it
via `nak blossom upload` (NIP-98 auth with the existing test key) before tests
run, and the resulting `http://localhost:10547/<sha256>.png` URL is exported as
`TEST_IMAGE_URL` via `$GITHUB_ENV`.

All six external image references now resolve through one config point —
`TEST_IMAGE_URL` in `e2e/test-config.ts` (CI: local Blossom URL; local:
placehold.co fallback) — consumed by `seed-relay.ts` (picture/banner),
`products.spec.ts`, `v4v-product-creation.spec.ts`, and
`community.progressive-loading.spec.ts`.

**Why a real Blossom server (not a static file server):** the title calls for a
Blossom server, and nak provides one for free — one flag on the already-running
relay, no Docker, no new dependency. It is also faithful to production (Blossom
is the app's actual media protocol) and leaves the door open for a future Step
B2 that exercises the real `uploadFileToBlossom` upload path (which the current
tests do not — they type a URL, they don't upload a file).

**Files changed:**

- `e2e/fixtures/test-image.png` (NEW) — 600×600 RGBA PNG fixture (2.8 KB).
- `e2e/test-config.ts` — `TEST_IMAGE_URL` export (env-overridable).
- `e2e/seed-relay.ts` — picture/banner use `TEST_IMAGE_URL`.
- `e2e/tests/products.spec.ts`, `e2e/tests/v4v-product-creation.spec.ts`,
  `e2e/tests/community.progressive-loading.spec.ts` — use `TEST_IMAGE_URL`.
- `.github/workflows/e2e.yml` — `nak serve --blossom` + seed step (both jobs).
- `e2e/ARCHITECTURE.md` — docs updated to reference `TEST_IMAGE_URL`.
