# E2E Scripts

## flake-report.py

Runs each spec N times and reports per-test flakiness.

    python3 e2e/scripts/flake-report.py --runs 5
    python3 e2e/scripts/flake-report.py --specs cart,auth --runs 10
    python3 e2e/scripts/flake-report.py --grep "reaction" --runs 3

For a quick repeat-run without the report: `bun run test:e2e:flake` (defaults to 5 runs per test; override with `E2E_REPEAT=10`).

The script runs `bunx playwright test --reporter=json --retries=0` for each spec
N times, parses the JSON report at the individual test level (recursing through
nested `test.describe` suites), and aggregates pass rates across runs.

Each test is classified as:

| Classification | Pass rate |
| -------------- | --------- |
| ✅ STABLE      | 100%      |
| 🟡 FLAKY       | 60–99%    |
| 🔴 VERY-FLAKY  | 1–59%     |
| 💥 BROKEN      | 0%        |

Output:

- A terminal table sorted worst-first.
- A timestamped JSON report under `e2e/baseline-results/`.

### Requirements

- `bun install` in the repo root
- `bunx playwright install chromium`
- Relay (`nak serve` on `ws://localhost:10547`) and dev server (`bun dev` on
  port 34567). If neither is running, the Playwright `webServer` config in
  `e2e/playwright.config.ts` starts them automatically (when `CI` is unset).

### Options

| Flag                | Description                                       |
| ------------------- | ------------------------------------------------- |
| `--runs N`          | Number of runs per spec (default: 5).             |
| `--specs cart,auth` | Comma-separated spec stems to include.            |
| `--grep "reaction"` | Pass-through `--grep` filter to Playwright.       |
| `--json`            | JSON-only output (suppresses the terminal table). |
| `--timing`          | Print per-run wall-clock timing.                  |
