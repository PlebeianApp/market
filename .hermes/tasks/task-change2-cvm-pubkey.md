## Context

Repo: ~/repos/market
Branch: feat/nip53-status-resolver (PR #1171 → auctions)
This task DEPENDS ON task-change1-status-resolution being complete first.

## OPERATOR DECISION

CVM identity enforcement pubkey must use the SAME derivation chain as the rest of the app. The chain already exists:

### Existing chain: resolveCvmServerPubkey()

Defined in TWO places (duplicate code that must be consolidated):

1. src/server/runtime.ts:52-65 — CANONICAL (used by /api/config at runtime)
2. src/lib/cvm-identity.ts:22-35 — DUPLICATE (re-exported from constants.ts:135)

Priority chain (already implemented):
- Tier 1: CVM_CURRENCY_SERVER_PUBLIC_KEY / CURRENCY_SERVER_PUBKEY (service-specific)
- Tier 2: CVM_SERVER_PUBLIC_KEY / CVM_SERVER_PUBKEY (general)
- Tier 3: CVM_SERVER_KEY (derive via getPublicKey)
- Tier 4: THROW (no app-key fallback — deliberately removed)

## Required Changes

### 1. Consolidate duplicate code

Delete src/lib/cvm-identity.ts entirely. Update src/lib/constants.ts:135 to import from src/server/runtime.ts instead:
```ts
export { resolveCvmServerPubkey as CVM_SERVER_PUBKEY_RESOLVER } from '@/server/runtime'
```

Update any imports that referenced src/lib/cvm-identity.ts to point to the new location. Check:
- src/lib/__tests__/cvm-server-key.test.ts
- src/lib/__tests__/contextvm-client.integration.test.ts
- src/lib/constants.ts

### 2. Document the env vars in .env.local.example

Currently undocumented. Add:
```
# CVM server identity (used for live activity signing + verification)
# Tier 1: service-specific (optional, overrides general)
# CVM_CURRENCY_SERVER_PUBLIC_KEY=
# Tier 2: general CVM server pubkey
# CVM_SERVER_PUBLIC_KEY=
# Tier 3: derive from private key (recommended for dev)
CVM_SERVER_KEY=
```

### 3. Remove dead code

src/server/runtime.ts:24 has `let CVM_SERVER_PUBKEY: string | undefined` — declared but never assigned or read. Delete it.

### 4. Verify the existing tests still pass

```
~/.bun/bin/bun test src/lib/__tests__/cvm-server-key.test.ts
~/.bun/bin/bun test src/lib/__tests__/contextvm-client.integration.test.ts
```

## CRITICAL RULES
- Do NOT add an app-private-key fallback tier (tier 4 stays as throw)
- Do NOT change the 3-tier priority logic
- Do NOT change the function signature or return type
- Do NOT push. Commit locally and report the diff.

## Audit checkpoint
After completing, report:
1. Full git diff
2. Test output
3. List of all files that imported from cvm-identity.ts and their new import paths
Felix will review before push.
