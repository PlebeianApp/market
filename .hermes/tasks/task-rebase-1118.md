## Context

Repo: ~/repos/market
PR #1118: security/sha-pin-remaining-workflows → master
Current state: mergeStateStatus DIRTY (conflicts with master), CI green on stale run.

## Task

1. Checkout the branch:
```
git checkout security/sha-pin-remaining-workflows
```

2. Rebase onto latest master:
```
git fetch upstream
git rebase upstream/master
```

3. Resolve any conflicts. The PR SHA-pins GitHub Actions in workflow files. Conflicts likely in `.github/workflows/` if master added new workflow files or changed existing ones. For each conflict:
- Keep BOTH the SHA-pin (our change) AND any new content from master
- The goal is: all workflow files use SHA-pinned action versions

4. Verify CI locally:
```
~/.bun/bin/bun run format:check
~/.bun/bin/bun run test:unit 2>&1 | tail -5
```

5. Commit the rebase resolution if needed:
```
git add -A && git rebase --continue
```

6. Force-push:
```
git push fork security/sha-pin-remaining-workflows --force --no-verify
```

## CRITICAL RULES
- Do NOT change the SHA-pinning logic — only resolve conflicts
- Preserve all existing SHA pins
- If a workflow file was added on master that doesn't have SHA pins, add them
- Report the conflict resolution details for audit

## Audit checkpoint
After completing, report: which files had conflicts, how they were resolved, and the final git log --oneline -5. Felix will verify before considering this unblocked.
