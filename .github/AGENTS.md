# AGENTS.md — .github

This directory follows the repository-level AGENTS.md.

## Context

GitHub configuration currently includes issue templates and these workflows:

- `.github/workflows/ci-unit.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/deploy-auctionsdev.yml`
- `.github/workflows/deploy-relay.yml`
- `.github/workflows/e2e.yml`
- `.github/workflows/prettier.yml`
- `.github/workflows/promote-production.yml`
- `.github/workflows/release.yml`

## Constraints

- Treat workflow and deployment changes as high risk. They can run remote code,
  access GitHub Actions secrets, deploy services, or alter release behavior.
- Do not trigger workflows, deployments, releases, or environment promotion
  unless explicitly authorized.
- Never print, copy, or preserve GitHub Actions secrets in logs, docs, PR
  comments, screenshots, or local files.
- Do not infer deployment guarantees from workflow names alone. Verify behavior
  from the workflow file before making claims.

## Instructions

- Keep workflow diffs small and explain trigger, permission, environment, and
  secret-handling effects in the PR notes.
- Prefer least-privilege workflow permissions and avoid broad token scopes.
- Check shell snippets for secret exposure before adding logging or debugging.

## Safe Checks

- `git diff --check`
- `bun run format:check`
