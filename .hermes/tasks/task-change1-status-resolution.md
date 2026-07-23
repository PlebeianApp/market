## Context

Repo: ~/repos/market
Branch: feat/nip53-status-resolver (PR #1171 → auctions)
Related files:
- src/lib/nip53.ts — resolveLiveActivityStatus() at line 47-66
- src/components/LiveChatPanel.tsx — consumer at line 50-54
- src/queries/liveChat.tsx — fetchLiveActivity + useLiveActivity
- src/queries/__tests__/liveChat.test.ts — 14 tests

## OPERATOR DECISION (non-negotiable)

The client must NOT derive status from auction timestamps. The CVM status tag is the sole authority for live event status.

Current resolveLiveActivityStatus() is WRONG — it overrides CVM status with timestamp boundaries. This must be rewritten.

## Required Changes

### 1. Rewrite resolveLiveActivityStatus in src/lib/nip53.ts

New logic:
```ts
export function resolveLiveActivityStatus(
    cvmStatus: LiveActivityStatus | null,
): LiveActivityStatus | null {
    // CVM status is the sole authority. Client does NOT derive from timestamps.
    // If no CVM event detected, there is no live activity — return null.
    return cvmStatus
}
```

That's it. The function becomes a pass-through. The CVM worker already computes status from timestamps server-side and publishes it. Client does not duplicate that logic.

### 2. Remove deriveLiveActivityStatus usage from LiveChatPanel.tsx

Current code uses deriveLiveActivityStatus for the refetch interval optimization (poll faster when planned). This is fine to keep for polling frequency — it does NOT affect displayed status. Keep deriveLiveActivityStatus in nip53.ts (CVM worker uses it server-side).

But the STATUS shown to the user must come ONLY from CVM:
```tsx
// BEFORE (WRONG):
const status = resolveLiveActivityStatus(liveActivity?.status ?? null, startsAt, biddingCutoffAt)

// AFTER (CORRECT):
const status = liveActivity?.status ?? null
if (!status) {
    // No CVM event — chat unavailable
    return <ChatUnavailable />
}
```

### 3. Add staleness health check in LiveChatPanel.tsx

Add a check: if liveActivity exists but its created_at/updated_at is stale (older than 2x refetch interval), show a health warning:
```tsx
const isStale = liveActivity && (now - liveActivity.createdAt > staleThreshold)
// Show: "Chat may be experiencing connectivity issues"
// This is a UI WARNING only — do NOT override the status
```

### 4. Update tests in liveChat.test.ts

Replace the 8 boundary tests with:
- No CVM event → status is null → chat unavailable
- CVM says "planned" → status is "planned" (no timestamp override)
- CVM says "live" → status is "live" (even if client clock says it should be ended)
- CVM says "ended" → status is "ended"
- Stale CVM event → health warning shown, status unchanged

Keep the anti-spoofing tests (CVM identity). Remove all timestamp boundary tests.

## CRITICAL RULES
- Do NOT change fetchLiveActivity or the CVM pubkey enforcement (that's correct already)
- Do NOT remove deriveLiveActivityStatus (CVM worker uses it)
- Do NOT push to upstream. Commit locally and report the diff.
- Run tests: `~/.bun/bin/bun test src/queries/__tests__/liveChat.test.ts`
- Run full suite: `~/.bun/bin/bun run test:unit 2>&1 | tail -10`

## Audit checkpoint
After completing, report:
1. Full git diff of all changes
2. Test output (pass/fail counts)
3. Confirmation you did NOT push
Felix will review all changes before push.
