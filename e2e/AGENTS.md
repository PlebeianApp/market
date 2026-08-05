# AGENTS.md — e2e

This directory follows the repository-level AGENTS.md.

## Context

`e2e/` contains Playwright tests, helpers, scenarios, and local test
configuration. The tests exercise browser workflows against app and relay test
infrastructure.

## Constraints

- E2E tests may start services, seed scenario data, and interact with local
  relays. Do not run full e2e, startup, or seed commands without explicit
  approval.
- Keep scenario data cumulative unless the seed scripts and affected tests are
  updated together.
- Treat test keys, wallet material, NWC URIs, and payment fixtures as sensitive
  even when they are only for tests. Do not print or duplicate them in docs.
- Do not treat browser UI state, relay presence, or wallet acknowledgement as
  proof of canonical payment or order state.

## Instructions

- Prefer user-visible Playwright locators where existing tests support them.
- When changing e2e behavior, document required local services and any data
  seeding assumptions.
- Keep protocol assertions explicit: validate event kind, tags, author, and
  expected relay behavior where tests inspect Nostr events.

### Visual proof — diff-aware trace + video routing

`e2e/playwright.config.ts` splits the suite into two chromium projects so only
the **recording scope** captures a full video + screenshots, while the bulk
regression suite stays on the cheap retain-on-failure / only-on-failure
defaults (see `docs/plans/pr-trust-pipeline.md` Layer 2):

| Project               | Match                                     | `video`             | `screenshot`      |
| --------------------- | ----------------------------------------- | ------------------- | ----------------- |
| `chromium`            | NOT in the recording scope (`grepInvert`) | `retain-on-failure` | `only-on-failure` |
| `chromium-happy-path` | IN the recording scope (`grep`)           | `on`                | `on`              |

The two projects partition the suite: every spec runs exactly once.
**`trace: 'on'`** is set globally for every CI run (locally `on-first-retry`),
so the interactive trace viewer (DOM scrub, network, console) is always captured
and uploaded as a workflow artifact for offline debugging.

**Recording scope resolution** (`e2e/lib/diff-specs.ts`, `getRecordingScopeSync`)
— the `grep`/`grepInvert` pattern is computed once at config load:

1. `DIFF_AFFECTED_GREP` env → that regex verbatim (manual / future Layer 1
   Codecov feed).
2. `DIFF_AFFECTED_SPECS` env → comma-separated spec stems, unioned with
   `@happy-path`.
3. **CI only:** `git diff origin/master...HEAD` → changed `src/` files → spec
   stems via a path-token heuristic (reusing Layer 1's `isCheckableFile`). The
   matched stems are depluralized and unioned with the **always-on `@happy-path`
   baseline**, so curated visual-proof specs keep recording regardless of the
   diff and this can never regress the prior behaviour.
4. Fallback (no mappable diff / non-CI) → `@happy-path` only.

Locally the resolver returns the static `/@happy-path/i` pattern with **no git
side effect**, keeping `bun test e2e/playwright.config.test.ts` hermetic.

To promote a spec to permanent visual proof, append the tag to its title, e.g.
`test('should display correct product details @happy-path', ...)`. The worker
count (`workers: 1`), parallelism (`fullyParallel: false`), and retry count are
intentionally unchanged and are asserted by `e2e/playwright.config.test.ts`.

**Video format.** Playwright records WebM at the Desktop Chrome viewport
(1280×720 = 720p). The CI workflow re-encodes every `.webm` to ~12 FPS via
ffmpeg (`continue-on-error`, skipped if ffmpeg is absent) to cap artifact size
within the 10–15 FPS target. The `recordVideo` mode must stay a **string**
(`'on'`) — `e2e/fixtures/index.ts` normalises `use.video` to a string and only
the string modes record; the object form would silently disable video.

**Artifacts.** Because the e2e page fixtures (`merchantPage`, `buyerPage`,
`newUserPage`, `unauthenticatedPage` in `e2e/fixtures/index.ts`) create their own
browser contexts for per-user isolation, Playwright's project-level `video` does
NOT auto-apply to them. The fixtures read the project's video mode via
`testInfo.project.use.video` and forward `recordVideo` for the recording project
(see `e2e/fixtures/video.ts`), then attach the recording to the test result. Each
recording-scope spec therefore produces
`test-results/<test>/attachments/video-*.webm` (plus a `test-finished-*.png`
screenshot). Non-recording specs record nothing on a manual context — failures
there still produce only a screenshot, identical to the pre-existing behaviour.

CI uploads two artifacts per job: `playwright-visual-proof-{pricing,full}`
(trace.zip + .webm + .png, 14-day retention) and the broad `test-results-*`
(JSON report + logs, 7-day retention).

## Safe Checks

- `git diff --check`
- `bun run format:check`
- Full e2e execution requires explicit approval.
