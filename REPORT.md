# PR #1412 CI offload report

## Finding

PR https://github.com/PlebeianApp/market/pull/1412 (`feat: sdk port`, external author hkarani) had failing `unit-integration`, `e2e-grep`, `footprint`, and `prettier` checks. Inspected head `9172219ef2c59e21a79fb5fc9a81706ef36b3f52`, branch `PlebeianApp:feat/architecutre`, base `auctions`.

No commits were pushed to the author's branch. Work was isolated in `/home/c03rad0r/worktrees/pr1412-ci`; the original dirty checkout was not modified.

## Diagnosis from failing job logs

1. `unit-integration` (run 38737121515) could not load undeclared `applesauce-loaders/loaders` and `applesauce-common/helpers/gift-wrap` imports. After adding the packages locally, further stale imports to deleted `sdk/core/nostr/eventLike.ts` and `sdk/core/nostr/nip17Relays.ts` and missing Core barrel exports became visible.
2. `e2e-grep` (run 38737121359) failed while starting the dev server because `sdk/core/event-access/ts/composition.ts` could not resolve `applesauce-loaders/loaders`.
3. `footprint` (run 38737121258) counted 148 NDK-importing files against baseline 147. The sole new importer was `src/lib/nostr/ndkEncryptingSigner.ts`.
4. `prettier` (run 38737121289) reported 99 files needing formatting.

## Delivered

- Diagnostic comment: https://github.com/PlebeianApp/market/pull/1412#issuecomment-6424780444
- Fork patch PR: https://github.com/PlebeianApp/market/pull/1425
- Patch PR link on source PR: https://github.com/PlebeianApp/market/pull/1412#issuecomment-6425137512
- Patch PR metadata was read back after creation: base `PlebeianApp/market:feat/architecutre`, head `felixfelix-bot/market:ci/pr-1412-unblock`, cross-repository `true`, head `f9a73290d8a8fa109548297532bdafb657499300`.

The first PR-create attempt incorrectly used the canonical repository as the cross-fork base and was rejected with `The baseRefName is invalid`; it created no PR. Retrying with `PlebeianApp/market` as the base repository succeeded. No fenced-diff fallback was needed.

## Patch contents

- `package.json`, `bun.lock`: explicit `applesauce-common@6.2.0` and `applesauce-loaders@6.2.0` declarations and resolved dependencies. `bun add --exact` reordered `rxjs` in the manifest but did not change its version.
- `src/lib/nostr/ndk-events.ts`: hosts the existing `toEncryptingSigner` implementation at the already-counted NDK boundary.
- `src/lib/nostr/ndkEncryptingSigner.ts`: compatibility re-export with no NDK import, preserving the public import path while restoring the footprint to 147.
- 99 PR-owned files under `method/` and `sdk/`: Prettier-only changes. Large generated/vendor HTML, JavaScript, CSS, and minified files account for most of the formatting diff; this is called out in the patch PR.
- `PROGRESS.md`, `REPORT.md`, and `artifacts/pr1412-ci/`: work log, this report, downloaded failing CI logs, and local before/after verification evidence. These are durable on the bot-owned branch, not required application runtime files.

Pushed commits on `felixfelix-bot/market:ci/pr-1412-unblock`:

- `0573cebc` `docs(pr1412): record CI diagnosis and evidence` (pushed; observed in push output).
- `1dc7e315` `docs(pr1412): reproduce failing CI checks locally` (pushed).
- `853d2512` `fix(ci): declare applesauce dependencies and keep NDK footprint flat` (pushed).
- `f9a73290` `style(pr1412): apply repository Prettier configuration` (pushed; also read back as the patch PR head).

## Verified results on the patch branch

- `bash scripts/check-ndk-footprint.sh`: PASS; `NDK footprint: 147 file(s) import @nostr-dev-kit (baseline: 147)`, `OK`.
- `bun run format:check`: PASS; `All matched files use Prettier code style!`.
- `bun test --isolate sdk/core/event-access/ts/composition.test.ts sdk/core/relay-config/ts/relay-config.test.ts`: 44 pass, 0 fail, 182 assertions.
- `bun test --isolate src/lib/__tests__/ndk-events.test.ts src/lib/__tests__/sdkAdapters.test.ts src/lib/__tests__/ndk-footprint-guard.test.ts`: 15 pass, 0 fail, 40 assertions.
- `CI=1 bunx playwright test --config e2e/playwright.config.ts --list`: exit 0; 241 tests in 38 files discovered. This was discovery only; Playwright reported all 241 `did not run`. No local servers or browser scenarios were started.
- `git diff --check`: passed at the pre-format checkpoint; formatting subsequently passed on the branch. The final evidence commit's cached diff check reports seven trailing-whitespace lines in raw Bun unit-test source-context output; the captured log was preserved unaltered and that check was not used as a commit gate for the artifact.
- Dependencies were installed successfully with `bun add --exact applesauce-common@6.2.0 applesauce-loaders@6.2.0`; initial `bun install --frozen-lockfile` at the original PR head also succeeded. A frozen-lockfile install after the manifest edit was not separately run.

## Failures and limits (not claimed as fixed)

- Full `bun run test:unit`: exit 1; 1771 pass, 34 fail, 27 errors across 185 files. Stale deleted Core Nostr paths and missing barrel exports remain on this deliberately mechanical patch. Temporary restoration during diagnosis exposed additional NIP-17/private-order behavior mismatches in relay-target shapes, plaintext rumor/decrypt handling, return shapes, and errors. No tests were weakened or skipped, and the temporary restorations were not included in the mechanical patch.
- `bunx tsc --noEmit`: exit 134 after JavaScript heap exhaustion (V8 `Ineffective mark-compacts near heap limit`). This is an aborted typecheck, not a typecheck pass. The repository has no `typecheck` script (`bun run typecheck` also reported `Script not found`).
- Full browser e2e was not run; repository instructions require explicit approval for full e2e/service startup. The original dev-server dependency failure was addressed, but no claim is made that all browser tests pass.
- No patch-PR CI result is claimed. Local results above are actual command outcomes, not inferred GitHub check results.

## Remaining steps

1. Reconcile the intentionally deleted Core Nostr APIs with the application's compatibility imports: either restore/migrate `eventLike` and `nip17Relays` plus required NIP-17/NIP-59/relay-port barrel APIs, or migrate all consumers coherently.
2. Fix and verify the NIP-17/private-order relay-target, return-shape, unwrap/symbol-metadata, and error-contract regressions using the existing tests without changing protocol expectations.
3. Re-run full unit tests and the complete e2e gate in an approved local-service/CI environment.
4. Review the large Prettier-only vendor diff in PR #1425 and merge it into the author's branch only after maintainer/author review; do not merge it into `auctions` directly.

Evidence files with exact output are under `/home/c03rad0r/worktrees/pr1412-ci/artifacts/pr1412-ci/`, including `local-final-unit.log`, `local-final-e2e-list.log`, `local-final-format.log`, `local-final-footprint.log`, and `local-final-tsc-oom.log`.
