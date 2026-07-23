## Context

Repo: ~/repos/market
Branches (already exist on fork felixfelix-bot/market):
- docs/adr-phase-enums (#1164 → master)
- docs/adr-store-layer (#1165 → master)
- docs/adr-e2e-test-stabilization (#1175 → master)
- docs/adr-relay-data-validation (#1176 → master)
- docs/adr-error-boundary-observability (#1177 → master)

## Task

CI is failing prettier check on 5 ADR PRs. All are docs-only (markdown files).

For EACH branch above:
1. `git checkout <branch>`
2. Run: `~/.bun/bin/bun run format:check 2>&1 | grep warn` to see which files need fixing
3. Run: `~/.bun/bin/bun run format:write` or `~/.bun/bin/bunx prettier --write docs/adr/<file>.md` on affected files
4. Verify: `~/.bun/bin/bun run format:check` passes clean
5. Commit: `git add -A && git commit -m "style: prettier format ADR" --no-verify`
6. Push: `git push fork <branch> --no-verify`

## CRITICAL RULES
- Do NOT modify any content in the ADRs — only formatting
- Do NOT touch files outside docs/adr/
- Each branch gets its own commit
- After all 5 branches are fixed, report which files were changed on each

## Audit checkpoint
After completing, report the exact git diff for each commit. Felix will verify before the PRs are considered clean.
