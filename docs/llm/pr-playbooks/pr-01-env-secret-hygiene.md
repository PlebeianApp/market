# PR 1 Playbook: Env and Secret Hygiene

This playbook defines PR 1 only. Do not include bootstrap, NIP-57, wallet storage, order lifecycle, XSS/media, package-manager policy, route generation, or app behavior changes.

## Goal

Stop tracking local env material, prevent new tracked secrets, and document rotation risk without deleting developer files or rewriting history.

## Scope

- Untrack `.env.dev` while preserving the local file for developers.
- Ignore `.env.dev` and local env variants that should not be committed.
- Preserve `.env.example`, `.env.dev.example`, and `.env.local.example`.
- Add a lightweight secret guard that scans tracked files in CI.
- Optionally add a staged-file scanning mode for local pre-commit usage.
- Document that any committed app key must be treated as exposed unless maintainers confirm it was disposable test-only material.

## Non-Goals

- Do not delete local env files.
- Do not print secret values.
- Do not clean git history.
- Do not rotate keys automatically.
- Do not modify bootstrap/admin setup.
- Do not modify NIP-57 zap receipt verification.
- Do not modify wallet, Cashu, NWC, order, XSS/media, payment, package manager, generated-route, or app behavior.
- Do not mutate issue trackers.

## Source-of-Truth Map

- Git tracked files define what can leak in future commits.
- Example env files define documented configuration names and must remain safe to publish.
- Maintainers own the decision to rotate or retire any previously committed key material.
- CI owns the minimum tracked-file secret guard.

## Boundary Map

- Local env files: developer machine state, not source of truth.
- Example env files: public documentation, allowed only with placeholders.
- CI secret guard: detection boundary, not a rotation tool.
- Git history: out of scope for PR 1.

## Suggested Implementation

1. Confirm current state with read-only commands:

   ```sh
   git status --short
   git ls-files .env.dev .env.example .env.dev.example .env.local.example
   git grep -l "APP_PRIVATE_KEY"
   ```

   Redact values. Report only paths and variable names.

2. Untrack `.env.dev` without deleting the local file.

   Use an approach equivalent to:

   ```sh
   git rm --cached .env.dev
   ```

3. Update ignore rules for local env files while preserving tracked examples.

4. Add a secret guard script or CI step that scans tracked files and fails on high-risk patterns.

5. Add a narrow allowlist for example placeholders and intentional test fixtures. Do not allow real-looking secrets in examples.

6. Document rotation risk in maintainer-facing docs.

## Acceptance Criteria

- `.env.dev` is no longer tracked.
- The local `.env.dev` file is not deleted by the patch.
- Local env variants are ignored.
- Example env files remain tracked and contain placeholders only.
- CI fails if tracked files contain private-key, nsec, NWC, Cashu token/proof, mnemonic, API key, bearer token, preimage, seed, or credential patterns outside the allowlist.
- The guard reports path and pattern only, not values.
- Rotation risk is documented without implying automated rotation happened.
- No app behavior changes are included.

## Suggested Checks

```sh
git status --short
git diff --stat
bun run format:check
```

If a secret guard script is added, run it locally and include its redacted output summary.

## Review Focus

- Confirm `.env.dev` is removed from tracking but not deleted from the developer machine.
- Confirm ignore rules do not hide example files.
- Confirm the guard cannot print secret values.
- Confirm allowlists are narrow and documented.
- Confirm no unrelated source, package, lockfile, route, bootstrap, payment, wallet, order, or XSS changes slipped in.

## Rollback

Revert the PR. If maintainers decide `.env.dev` must remain tracked temporarily, replace real values with safe placeholders first and keep the secret guard.
