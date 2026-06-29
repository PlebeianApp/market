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

## NDK → Applesauce Migration

Full plan & progress checklist: [`docs/ndk-to-applesauce-migration-plan.md`](docs/ndk-to-applesauce-migration-plan.md).
Upstream epic: `PlebeianApp/market#1005`.

**Do NOT add new files importing `@nostr-dev-kit`.** The CI guard
(`scripts/check-ndk-footprint.sh`, baseline `scripts/ndk-baseline.txt`) is
file-footprint based: it fails if the number of files importing `@nostr-dev-kit`
grows, but it does not detect additional NDK usage inside already-counted files.
New relay I/O must route through the **strangler-fig seam** instead:

```ts
import { fetchEvents, subscribe, publish, sign, getUser } from '@/lib/nostr/io'
```

- `src/lib/nostr/io.ts` — the Port (raw nostr-tools events).
- `src/lib/nostr/io-ndk.ts` — temporary NDK bridge (currently the default adapter).
- `src/lib/nostr/io-applesauce.ts` — destination adapter.

**Migration rules:**

1. **App-first, tests as gate.** Flip app modules off NDK; `bun run test:unit` (and
   the relevant `bun test:e2e -- <spec>` for root-cause waves) must stay green with
   **assertions unchanged**.
2. **Two-step flip per module:** (a) route through `io.*` while still NDK-backed;
   (b) flip that module to applesauce. One revert if wrong.
3. **Stacked PRs, one per wave, base = predecessor.** Only the bottom wave is
   non-draft at a time. Merge target: `PlebeianApp/market` `master`.
4. **Conflict-zone files** (`nip60.ts`, `publish/featured.tsx`, `publish/orders.tsx`,
   `dashboard/index.tsx`) are Wave C — last. `nip60.ts` is handed to the auctions team.
5. **NIP-46 bunker** rewrite is deferred to A3b (gates Wave D).
6. When a wave **reduces** the NDK footprint, lower the baseline in
   `scripts/ndk-baseline.txt` in the same PR so the guard ratchets down.
