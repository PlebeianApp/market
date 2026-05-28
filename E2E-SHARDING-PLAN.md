# E2E Sharding + Conditional Screenshot Re-run Plan

## Overview

Restructure the E2E test pipeline from a single serial `e2e-full` job (~20 min) into a sharded architecture with 3 parallel shards (~7 min each) plus a conditional screenshot re-run for failures. Dashboard is rendered and published to nsite in all cases.

## Architecture

```
e2e-pricing (push/PR) — 6 tests, ~1 min, no sharding
  ├── Start relay + dev server
  ├── Run pricing tests (screenshot: 'on', reporter: json+github)
  ├── Render dashboard → publish to nsite
  └── Upload artifacts

e2e-shard (workflow_dispatch / schedule) — matrix: 3 shards in parallel
  ├── Start relay + dev server (each shard has its own)
  ├── Run ~49 tests/shard (screenshot: 'only-on-failure', reporter: blob)
  └── Upload blob report artifact

e2e-report (depends on e2e-shard) — always runs
  ├── Minimal setup: checkout + bun + playwright only (~1 min)
  ├── Download 3 shard blob reports
  ├── Merge blob reports → results.json
  ├── Extract failures from results.json
  │
  ├── GREEN PATH (no failures):
  │     ├── Render dashboard from merged results
  │     └── Publish to nsite → done (~1 min total)
  │
  └── RED PATH (has failures):
        ├── Install nak + Go (conditional)
        ├── Start relay + dev server (conditional)
        ├── Re-run failed tests with screenshot: 'on', retries: 0
        ├── Merge first-pass + re-run results
        ├── Render dashboard with full screenshots
        └── Publish to nsite
```

## Timing

| Path | Time |
|------|------|
| **Green** (common) | ~9 min (7 min shards + 2 min merge/publish) |
| **Red** (failures) | ~16 min (7 min shards + 2 min merge + 5 min re-run + 2 min render/publish) |
| **Current** | ~20 min (single serial job) |

## Files to Change

### 1. `e2e/playwright.config.ts` — env var overrides

| Env Var | Values | Default | Purpose |
|---------|--------|---------|---------|
| `PLAYWRIGHT_SCREENSHOT` | `'on'`, `'only-on-failure'`, `'off'` | `'only-on-failure'` | Screenshot mode |
| `PLAYWRIGHT_REPORTER` | `'json'`, `'blob'`, `'auto'` | `'auto'` (CI→github, local→list) | Reporter selection |
| `PLAYWRIGHT_RETRIES` | any number | CI→2, local→0 | Retry count |

### 2. `e2e/extract-failures.ts` — new (~35 lines)

Parses `test-results/results.json`, walks suites/specs/tests/results, finds failures (status in `failed`, `timedOut`, `interrupted`), writes `failed-tests.txt` in `--test-list` format:

```
tests/auction-live-chat.spec.ts › Auction Live Chat › should display sage in the live chat input
```

Sets GITHUB_OUTPUT: `has_failures`, `count`, `passed`, `failed`, `duration`.

### 3. `e2e/merge-results.ts` — new (~45 lines)

Merges first-pass (`test-results/results.json`) + re-run (`test-results/rerun-results.json`). For each test that appears in both (matched by `file` + `title`), re-run entry replaces first-pass. Writes merged output to `test-results/results.json`.

### 4. `.github/workflows/e2e.yml` — rewrite jobs section (~240 lines)

- `e2e-pricing`: add env vars to test step, keep render+publish
- `e2e-shard`: matrix 3-way, blob reporter, upload artifacts
- `e2e-report`: merge + conditional re-run (Option B — heavy setup only on failures) + render + publish

## Key Details

- **Blob report location**: `blob-report/` (Playwright default), each shard gets unique `.zip`
- **Merge-reports JSON output**: `PLAYWRIGHT_JSON_OUTPUT_FILE` env var to redirect to file
- **`--test-list` format**: `file › suite › test title` (line/column ignored by Playwright)
- **Re-run**: fresh relay+dev server, `retries: 0`, `screenshot: 'on'`
- **Shard balance**: file-level sharding (`fullyParallel: false`), ~8 files per shard

## Out of Scope / Blocked

- Blossom/relay network accessibility from GitHub Actions
- `CI_ANNOUNCE_NSEC` secret in fork (user action needed)

## Checklist

- [x] 1. Checkout `feat/nip53-auction-live-chat` branch and verify sync
- [x] 2. Update `e2e/playwright.config.ts` with env var overrides
- [x] 3. Create `e2e/extract-failures.ts`
- [x] 4. Create `e2e/merge-results.ts`
- [x] 5. Rewrite `.github/workflows/e2e.yml` with sharding + conditional re-run
- [x] 6. Run Prettier / formatting on all changed files
- [x] 7. Commit and push to fork
- [ ] 8. Trigger workflow and verify (run 26580092779 in progress)

## Bug Fixes (found during CI validation)

- [x] Fix `e2e-report` running when `e2e-shard` was skipped (added `needs.e2e-shard.result != 'skipped'`)
- [x] Fix `extract-failures.ts` crash on merged JSON — arrays can be undefined in merged results
- [x] Fix `merge-results.ts` — Playwright clears `outputDir` on startup, destroying first-pass results. Backup to `/tmp/` before re-run
