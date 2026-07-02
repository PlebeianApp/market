# E2E Benchmarking

Repeatable e2e benchmarking and A/B backend comparison for the Plebeian Market
Playwright suite. Formalises the ad-hoc scripts Franchovy was running so the
whole team measures flakiness and the NDK → applesauce migration the same way.

> The Playwright suite itself is **never** executed by this tooling in CI — it
> only *orchestrates* runs locally or from a fork's Actions. The deliverables
> here are the runner, the report, the Make targets, and this doc.

## Prerequisites

- Node + Playwright deps already installed (`bun install` / `npm install`)
- A local Nostr relay reachable on `ws://localhost:10547` (Playwright's
  `webServer` starts `nak serve` for you when not on CI)
- Bash 4+, `python3` (3.8+), `make`, `find`
- System Chromium on platforms Playwright doesn't bundle one for — set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (the dev server / e2e config already
  honours this)

## Quick start

```bash
# full flake + A/B sweep across every spec (both backends, 3x each)
make e2e-benchmark-all

# read the verdict
make e2e-benchmark-report
```

Every `make e2e-benchmark-*` target is a thin wrapper around the script, so you
can run it directly for more control:

```bash
scripts/e2e-benchmark.sh --specs auth,cart --repeat 10 --backend both
scripts/e2e-benchmark.sh --specs pii-exposure --backend applesauce --repeat 5
```

## How the backend is selected

The benchmark runner exports **`NOSTR_BACKEND`** (`ndk` or `applesauce`) — plus
`NODE_OPTIONS=--dns-result-order=ipv4first`, matching the `test:e2e` package
script — on every Playwright invocation:

| `NOSTR_BACKEND` | intent |
| --- | --- |
| unset or `ndk` | NDK adapter — the historical default |
| `applesauce` | applesauce RelayPool adapter — the migration target |

> ⚠️ **Maturity note.** For backend selection to actually change app behaviour,
> the app's Nostr I/O layer must read `NOSTR_BACKEND` at boot (the expected seam
> is `src/lib/nostr/io.ts`). On plain `master` the app is **NDK-only** — there
> is no applesauce I/O path and no `NOSTR_BACKEND` switch wired up yet — so
> "applesauce" runs are currently NDK-equivalent. A/B deltas only become
> meaningful once the `NOSTR_BACKEND` switch lands on the branch under test.
> The tooling itself is backend-agnostic and ready to drive that comparison the
> moment the switch exists.

If you ever rename the flag, update the `--backend` handling in
`scripts/e2e-benchmark.sh`.

## Make targets

| Target | What it runs |
| --- | --- |
| `make e2e-benchmark-all` | all specs × 3 × both backends |
| `make e2e-benchmark-ndk` | all specs × 3 × NDK |
| `make e2e-benchmark-applesauce` | all specs × 3 × applesauce |
| `make e2e-benchmark-quick` | all specs × 1 × both backends (fast smoke) |
| `make e2e-benchmark-spec SPEC=x` | spec `x` × 5 × both backends |
| `make e2e-benchmark-ab SPEC=x` | spec `x` × 10 × both backends (A/B) |
| `make e2e-benchmark-flaky` | `auth,cart,pii-exposure,payments` × 5 × both |
| `make e2e-benchmark-report` | summarise the latest run |

`SPEC=` is the basename of a file in `e2e/tests/` minus `.spec.ts`. Prefix
matching is supported, so `pii-exposure` resolves to
`pii-exposure-remediation.spec.ts`.

## Direct script usage

```
scripts/e2e-benchmark.sh [options]

  --specs LIST       comma-separated spec names or "all" (default: all)
  --repeat N         repetitions per spec × backend (default: 3)
  --backend B        ndk | applesauce | both (default: both)
  --results-dir DIR  output root (default: ./e2e-benchmark-results)
  --grep PATTERN     optional --grep forwarded to playwright
  --no-strict        always exit 0 (default: exit 1 if any run failed)
  --playwright-bin C playwright invocation (default: npx playwright)
```

The script exports `NODE_OPTIONS=--dns-result-order=ipv4first` (matching the
`test:e2e` package script) and `NOSTR_BACKEND` on every run, then invokes
`npx playwright test --config=e2e/playwright.config.ts --reporter=json`.

## Output

Each invocation writes a timestamped directory:

```
e2e-benchmark-results/
└── 20260702T181234Z/                       # one per invocation
    ├── auth__ndk__run-1.json                # playwright JSON report
    ├── auth__ndk__run-2.json
    ├── auth__applesauce__run-1.json
    ├── ...
    ├── auth__ndk__run-1.log                 # per-run stdout/stderr
    ├── benchmark.log                        # all runs concatenated
    └── manifest.json                        # machine index of every run
└── latest -> 20260702T181234Z               # newest run (symlink)
```

The filename convention `<spec>__<backend>__run-<n>.json` is authoritative —
the report parses spec/backend/repeat from it and the test outcome counts from
the JSON body.

`e2e-benchmark-results/` is gitignored.

## Reading the report

`make e2e-benchmark-report` (or `python3 scripts/e2e-benchmark-report.py`) shows:

1. **Per-backend run pass rate** — overall green rate for NDK and applesauce.
2. **Per-spec A/B table** — NDK vs applesauce run pass rate with the delta and a
   verdict (`applesauce regresses`, `applesauce improves`, or `no change`).
   Specs where applesauce is worse are sorted to the top.
3. **Categorisation** — every spec × backend is filed as:
   - **STABLE** — 100% of repeats passed
   - **FLAKY** — 0% < pass rate < 100%
   - **BROKEN** — 0% of repeats passed
4. **Worst pass rates** — the ten lowest, with raw failure counts.

Use `--json` for a machine-readable summary, `--run <stamp>` (or `--results-dir`)
to report on a specific run, and `--all` to aggregate everything under the
results root.

## What is "A/B"?

The same spec runs the same number of times under each backend. If a spec is
green 9/10 under NDK but 4/10 under applesauce, the A/B table flags
`applesauce regresses (-50%)`. That pinpoints a migration-induced reliability
drop *before* the applesauce adapter becomes the default. The opposite direction
(applesauce improves) tells you the new adapter is strictly better.

For a result to be meaningful you need enough repeats — `make e2e-benchmark-ab
SPEC=x` (10×) is the recommended minimum for a single spec. The full
`e2e-benchmark-all` (3×) sweep is better for triage than for statistics.

## Troubleshooting

- **`no spec matched 'x'`** — the name doesn't prefix-match anything in
  `e2e/tests/`. `ls e2e/tests/*.spec.ts` to see real names.
- **All runs FAIL instantly** — the dev server or relay isn't up. Run
  `bun run test:e2e -- e2e/tests/auth.spec.ts` once by hand to surface the real
  error; the benchmark swallows per-run output into `<run>.log`.
- **`playwright: command not found`** — pass `--playwright-bin bunx playwright`
  (or `npx playwright` once deps are installed).
- **Hangs / relay port in use** — `webServer.reuseExistingServer` is on; a stale
  `nak` or dev server on the test port can confuse the suite. Kill leftovers on
  port `10547` and `34567`.
- **No backend effect** — confirm the branch you're benchmarking actually wires
  `NOSTR_BACKEND` through `src/lib/nostr/io.ts`. On plain `master` only the NDK
  adapter exists, so "applesauce" runs are NDK-equivalent until the migration
  wave lands.
- **Numbers look identical across backends** — see above; the env gate is a
  no-op until the applesauce adapter is reachable on the branch under test.
