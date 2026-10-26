# PR #1412 CI unblock — progress

Finding

- PR #1412, head `9172219ef2c59e21a79fb5fc9a81706ef36b3f52` on `PlebeianApp:feat/architecutre`, has failing `unit-integration`, `e2e-grep`, `footprint`, and `prettier` checks.
- Do not push to the PR head branch; only use `felixfelix-bot/market` or PR comments.

Status

- [x] Fetched exact PR head into isolated worktree `/home/c03rad0r/worktrees/pr1412-ci`; original dirty checkout untouched.
- [x] Saved failing logs under `artifacts/pr1412-ci/`.
- [x] Initial diagnosis: unit/e2e cannot resolve `applesauce-loaders/loaders`; unit also cannot resolve `applesauce-common/helpers/gift-wrap`; NDK footprint is 148 vs baseline 147; Prettier flags 99 files.
- [x] Reproduced locally: all four focused module-load errors, NDK footprint 148 vs 147, and Prettier failure.
- [x] Added declared `applesauce-common` and `applesauce-loaders` dependencies; 44 focused SDK tests pass.
- [x] Reproduced the remaining NIP-17 app compatibility failures after module loading; do not disguise these as a mechanical fix.
- [x] Consolidated the new signer adapter into the existing `src/lib/nostr/ndk-events.ts` NDK boundary; footprint passes 147/147.
- [x] Formatted PR-owned source files with Prettier; `bun run format:check` passes.
- [x] Committed and pushed the verified mechanical patch; created https://github.com/PlebeianApp/market/pull/1425 targeting `PlebeianApp:feat/architecutre`.
- [x] Posted diagnostic: https://github.com/PlebeianApp/market/pull/1412#issuecomment-6424780444
- [x] Posted patch PR link: https://github.com/PlebeianApp/market/pull/1412#issuecomment-6425137512
- [x] Wrote final `REPORT.md` with verified actions, evidence, and remaining steps.

Files touched

- `PROGRESS.md` — durable work log.
- `artifacts/pr1412-ci/pr1412-unit.log` — failing `unit-integration` log.
- `artifacts/pr1412-ci/pr1412-e2e.log` — failing `e2e-grep` log.
- `artifacts/pr1412-ci/pr1412-footprint.log` — failing `footprint` log.
- `artifacts/pr1412-ci/pr1412-prettier.log` — failing `prettier` log.
- `artifacts/pr1412-ci/local-before-focused.log` — four locally reproduced module-load failures.
- `artifacts/pr1412-ci/local-before-footprint.log` — locally reproduced footprint failure.
- `artifacts/pr1412-ci/local-before-format.log` — locally reproduced formatting failure.
- `artifacts/pr1412-ci/local-after-*.log` and `local-final-*.log` — exact local verification output, including known unit failures and the aborted typecheck.
- `package.json`, `bun.lock` — explicit SDK dependency declarations.
- `src/lib/nostr/ndk-events.ts`, `src/lib/nostr/ndkEncryptingSigner.ts` — NDK footprint-preserving signer adapter consolidation.
- `method/` and `sdk/` — Prettier-only changes to PR-owned files.
- `REPORT.md` — full diagnosis, delivery, verification, limitations, and remaining steps.

Last verified milestone

- Diagnostic and patch PR are delivered on the bot-owned branch. `bun run format:check` and NDK footprint (147/147) pass; 44 focused SDK tests and 15 NDK/adapter/guard tests pass; Playwright discovery succeeds without running browser scenarios. Full `bun run test:unit` remains red (1771 pass, 34 fail, 27 errors) because of unresolved Core Nostr/NIP-17 compatibility work. `bunx tsc --noEmit` aborted with exit 134 (heap exhaustion). No full browser e2e or patch-PR CI result is claimed.

Post-delivery verification

- `bun run format`: PASS; `bun run format:check`: PASS; NDK footprint: PASS at 147/147.
- `bun run build`: FAIL. The first unresolved module is `@sdk/core/nostr/eventLike`, imported by `src/lib/nostr/eventLike.ts`.
- Root cause confirmed in `f1c38332`: Core's hand-built Nostr layer was deleted while `src/` was deliberately left unmigrated. The app still consumes these pure helpers through its compatibility modules.
- Repair in progress: preserve the tested pure helpers in the existing app compatibility modules without restoring the deleted SDK layer. Build and focused tests have not yet been rerun after this diagnosis.
