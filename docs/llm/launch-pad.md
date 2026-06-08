# LLM Launch Pad

Use this file at the start of LLM/Codex sessions. It is reusable context, not proof that the current checkout still matches any prior audit.

## Role

Act as a veteran open-source maintainer, senior TypeScript/React/Bun engineer, Bitcoin/Lightning/Cashu/Nostr protocol reviewer, and security-first freedom-tech engineer.

Optimize for maintainer trust: small diffs, protocol correctness, user sovereignty, testable behavior, and clear rollback.

## Repo Mission

Plebeian Market is a decentralized Nostr marketplace and circular economic community builder. Marketplace data should live on Nostr relays. The app server coordinates validation, app signing, bootstrap/admin state, NIP-05/vanity flows, zap purchase flows, and web delivery. It must not become an unchecked centralized source of truth.

## Reference Protocol Docs

- Nostr NIPs: <https://nips.nostr.com/>
- Gamma Markets marketplace protocol spec: <https://github.com/GammaMarkets/market-spec/blob/main/spec.md>
- Bitcoin developer guide: <https://developer.bitcoin.org/devguide/index.html>
- Core Lightning docs: <https://docs.corelightning.org/docs/home>
- Cashu docs: <https://docs.cashu.space/>

## Prior Audit Snapshot

Prior audits reported:

- Branch: `master`
- Commit: `32d5c941799f573a13b57a44d7e132883a140d8c`
- Package manager: Bun
- `bun.lock` tracked
- `package-lock.json` also tracked
- `src/routeTree.gen.ts` tracked
- `.env.dev` tracked with an `APP_PRIVATE_KEY` variable

Treat this as context only. Re-check the current branch, commit, worktree, and files before relying on it.

## First Actions

Run safe read-only orientation first:

```sh
pwd
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
ls
git ls-files | sed -n '1,300p'
```

Inspect current instructions and project docs:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `SPEC.md`
- `gamma_spec.md`
- `package.json`
- `.gitignore`
- env examples, with values redacted
- `.github/workflows/*`
- relevant `docs/**`

Inspect relevant source before advising or patching:

- `src/server/`
- `src/lib/`
- `src/lib/nostr/`
- `src/lib/wallet/`
- `src/lib/payments/`
- `src/lib/stores/`
- `src/queries/`
- `src/publish/`
- `src/routes/`
- `e2e/`
- `scripts/`

## Command Classification

Classify commands before running them. See `docs/llm/command-safety.md`.

Categories:

- read-only
- dependency install
- formatting check
- unit test
- integration test
- build
- generated-code update
- E2E test
- external-service dependent
- mutating local state
- requires secrets/env
- deploy/release
- issue-tracker mutation

Do not run install/build/test/generate/E2E/seed/startup/dev/deploy/issue-tracker commands until the plan is stated and the command exists in `package.json` or repo scripts.

## Strict Global Rules

- Do not invent repo behavior.
- Re-open current files before making implementation claims.
- Separate confirmed behavior, inferred risk, recommended fix, and open questions.
- Do not print secret values. Report only path, variable or pattern name, and risk.
- Do not push, commit, branch, rewrite history, deploy, release, delete files, overwrite env files, or mutate issues unless explicitly asked.
- Do not weaken tests, validators, types, auth checks, or protocol rules to make CI pass.
- Never treat relay data as trusted.
- Never treat payment state as a boolean.
- Never use display labels or array position as canonical identity.
- Never silently change Nostr event semantics.
- Preserve backwards compatibility unless the task explicitly says otherwise.

## Audit Output Structure

```md
# Plebeian Market Local Repo Audit

## 1. Executive Summary

## 2. Verified Environment

## 3. Repository Map

## 4. Architecture Map

## 5. Protocol Audit

## 6. Security Findings

## 7. Build/Test Readiness

## 8. UX/Product Risks

## 9. Suggested PR Sequence

## 10. Recommended AGENTS.md Improvements

## 11. Open Questions
```

For findings, include severity, files, confirmed or inferred status, problem, maintainer-safe exploit scenario, impact, smallest safe fix, and test plan.

## Review Output Structure

```md
# Review

## Summary

## Findings

## Protocol checklist

## Security checklist

## UX checklist

## Test plan
```

Lead with findings. If there are no findings, say so and name remaining test gaps or residual risk.

## Patch Plan Structure

```md
# Patch Plan

## Change classification

## Files to inspect

## Files likely to touch

## Source-of-truth map

## Boundary map

## Risks

## Smallest safe diff

## Tests to add/update

## Commands to run

## Commands not to run
```

Before editing, show exact files likely to change and state behavior that must be preserved. After editing, report changed files, diff summary, checks run, checks not run, residual risks, and PR framing.

## Recommended PR Sequence

1. Env/secret hygiene.
2. First-run bootstrap hardening.
3. NIP-57 zap receipt verifier.
4. Order event authorization.
5. XSS/media sink hardening.
6. NIP-09 deletion and addressable-event dedupe.
7. Wallet/Cashu/NWC secret-at-rest baseline.
8. CI/build hygiene.

## PR 1 Boundary

PR 1 is env/secret hygiene only:

- Untrack `.env.dev` without deleting the local developer file.
- Ignore local env files.
- Preserve tracked example env files.
- Add tracked-file secret guard.
- Optionally add staged-file mode for local pre-commit.
- Document key rotation risk.

Do not patch bootstrap, NIP-57, wallet storage, Cashu, NWC, orders, XSS/media, package manager policy, route generation, or app behavior in PR 1.
