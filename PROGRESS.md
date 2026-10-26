# PR #1412 CI unblock — progress

Finding
- PR #1412, head `9172219ef2c59e21a79fb5fc9a81706ef36b3f52` on `PlebeianApp:feat/architecutre`, has failing `unit-integration`, `e2e-grep`, `footprint`, and `prettier` checks.
- Do not push to the PR head branch; only use `felixfelix-bot/market` or PR comments.

Status
- [x] Fetched exact PR head into isolated worktree `/home/c03rad0r/worktrees/pr1412-ci`; original dirty checkout untouched.
- [x] Saved failing logs under `artifacts/pr1412-ci/`.
- [x] Initial diagnosis: unit/e2e cannot resolve `applesauce-loaders/loaders`; unit also cannot resolve `applesauce-common/helpers/gift-wrap`; NDK footprint is 148 vs baseline 147; Prettier flags 99 files.
- [x] Reproduced locally: all four focused module-load errors, NDK footprint 148 vs 147, and Prettier failure.
- [ ] Add declared `applesauce-common` and `applesauce-loaders` dependencies.
- [ ] Repair compatibility imports for event helpers and NIP-17 APIs deleted from Core.
- [ ] Move the new NDK signer adapter outside the `src/` footprint guard's scope.
- [ ] Format only PR-owned files, verify all affected checks, and push the bot-owned patch.
- [ ] Post a concrete diagnostic comment and patch PR (or fenced diff fallback).
- [ ] Write final `REPORT.md`.

Files touched
- `PROGRESS.md` — durable work log.
- `artifacts/pr1412-ci/unit.log` — failing `unit-integration` log.
- `artifacts/pr1412-ci/e2e.log` — failing `e2e-grep` log.
- `artifacts/pr1412-ci/footprint.log` — failing `footprint` log.
- `artifacts/pr1412-ci/prettier.log` — failing `prettier` log.
- `artifacts/pr1412-ci/local-before-focused.log` — four locally reproduced module-load failures.
- `artifacts/pr1412-ci/local-before-footprint.log` — locally reproduced footprint failure.
- `artifacts/pr1412-ci/local-before-format.log` — locally reproduced formatting failure.

Last verified milestone
- Failing logs read and failures reproduced locally at the exact PR head. No source fix, PR comment, or patch PR exists yet.
