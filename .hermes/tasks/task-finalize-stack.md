## Context

Repo: ~/repos/market
Branch: feat/nip53-status-resolver (PR #1171 → auctions)
This task DEPENDS ON task-change2-cvm-pubkey being complete first.

After CHANGE 1 + CHANGE 2 are committed, we need to:
1. Fix prettier on the branch
2. Rebase the downstream stack (#1172, #1173)
3. Force-push all 3 branches

## Task

### Step 1: Prettier fix on feat/nip53-status-resolver

```
git checkout feat/nip53-status-resolver
~/.bun/bin/bun run format:check 2>&1 | grep warn
~/.bun/bin/bunx prettier --write <affected files>
~/.bun/bin/bun run format:check  # verify clean
git add -A && git commit -m "style: prettier format" --no-verify
```

### Step 2: Run full test suite

```
~/.bun/bin/bun run test:unit 2>&1 | tail -10
```

### Step 3: Rebase downstream branches

```
# Rebase reactions on updated status-resolver
git checkout feat/nip53-reactions
git rebase feat/nip53-status-resolver

# Rebase commentator on updated reactions
git checkout feat/nip53-cvm-commentator
git rebase feat/nip53-reactions
```

Resolve any conflicts. The main risk: LiveChatPanel.tsx and nip53.ts changed significantly in CHANGE 1. The reactions and commentator branches add to LiveChatMessage.tsx and ReactionsList.tsx — these should be in different files, so conflicts should be minimal.

### Step 4: Fix prettier on rebased branches

```
git checkout feat/nip53-reactions
~/.bun/bin/bun run format:check 2>&1 | grep warn
~/.bun/bin/bunx prettier --write <affected files>
git add -A && git rebase --continue  # or git commit if needed

git checkout feat/nip53-cvm-commentator
~/.bun/bin/bun run format:check 2>&1 | grep warn
~/.bun/bin/bunx prettier --write <affected files>
git add -A && git rebase --continue
```

### Step 5: Push all 3 branches

```
git checkout feat/nip53-status-resolver
git push fork feat/nip53-status-resolver --force --no-verify

git checkout feat/nip53-reactions
git push fork feat/nip53-reactions --force --no-verify

git checkout feat/nip53-cvm-commentator
git push fork feat/nip53-cvm-commentator --force --no-verify
```

## CRITICAL RULES
- Test suite must pass before push
- Prettier must be clean before push
- Report ALL conflict resolutions for audit
- If rebasing fails catastrophically, STOP and report — do not force anything blindly

## Audit checkpoint
After completing, report:
1. Test output for all 3 branches
2. Prettier check result for all 3 branches
3. Any rebase conflicts and how they were resolved
4. Force-push confirmations
Felix will verify CI status on GitHub after push.
