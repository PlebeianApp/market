# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Local Deployment

This worktree has local deployment tooling (Makefile, ansible playbooks, deploy.env) copied from the `feature/ansible-workflow-local` branch. These files are gitignored and are NOT part of this feature branch — do not commit them.

```bash
make deploy-local    # Deploy to localhost via systemd (prompts for sudo password)
make stop-local      # Stop all services and free ports 3000/10547
make status-local    # Check systemd service status
make logs-local      # Tail service logs
make test            # Run Playwright E2E tests
```

The `deploy.env` file must be created from `deploy.env.example` before first use:

```bash
cp deploy.env.example deploy.env
```

**IMPORTANT:** These files are local-only tooling. Never add them to git on this branch.
