# NIP-53 Testing Plan

## Branch: `feat/nip53-auction-live-chat`
## Target: `auctions/p2pk-path-oracle-via-cvm-v1`

## Implementation Status

All 6 implementation steps are **complete**. See `NIP53-PLAN.md` for details.

## Files Created/Modified

| File | Layer | Has Tests? |
|------|-------|------------|
| `src/lib/nip53.ts` | Core utils | Yes — `nip53.test.ts` (13 tests) |
| `src/publish/liveChat.tsx` | Publish | Yes — `liveChat.test.ts` (9 tests) |
| `src/queries/liveChat.tsx` | Queries | Yes — `liveChat.test.ts` (8 tests) |
| `src/components/LiveChatPanel.tsx` | UI | No — requires React Testing Library (not in project) |
| `src/components/LiveChatMessage.tsx` | UI | No — requires React Testing Library (not in project) |
| `src/publish/auctions.tsx` | Integration | Covered via E2E |
| `src/routes/auctions.$auctionId.tsx` | Integration | Covered via E2E |
| `src/queries/queryKeyFactory.ts` | Queries | No (trivial addition) |

## Test Coverage Checklist

### 1. Fix Existing Tests
- [x] Verify `bun test` passes 13 existing `nip53.test.ts` tests (confirmed: `bun test` works)

### 2. Unit Tests — Publish Functions (`src/publish/liveChat.test.ts`) — 9 tests
- [x] `publishLiveActivity` — constructs correct 30311 event tags from auction event
- [x] `publishLiveActivity` — includes relay tags from connected relays
- [x] `publishLiveActivity` — includes category tags from auction
- [x] `publishLiveActivity` — omits image tag when auction has no images
- [x] `publishLiveActivity` — sets Host p tag with seller pubkey
- [x] `publishLiveChatMessage` — constructs correct 1311 event with `a` tag root
- [x] `publishLiveChatMessage` — includes relay hint from connected relays
- [x] `updateLiveActivityStatus` — updates status tag while preserving other tags
- [x] `updateLiveActivityStatus` — replaces only status tag when multiple status tags exist

### 3. Unit Tests — Query Functions (`src/queries/liveChat.test.ts`) — 8 tests
- [x] `fetchLiveActivity` — returns null if event has no d tag
- [x] `fetchLiveActivity` — returns null if no events found on relay
- [x] `fetchLiveActivity` — parses live activity event from relay
- [x] `fetchLiveActivity` — returns null when NDK returns empty set
- [x] `fetchLiveChatMessages` — returns empty array when no events found
- [x] `fetchLiveChatMessages` — parses and sorts chat messages by createdAt ascending
- [x] `fetchLiveChatMessages` — handles messages with missing content gracefully
- [x] `fetchLiveChatMessages` — uses current timestamp when created_at is missing

### 4. Unit Tests — UI Components (DEFERRED)
> Project does not include React Testing Library. UI testing covered via E2E.
- [ ] `LiveChatMessage` — renders author pubkey (shortened), content, relative time
- [ ] `LiveChatPanel` — shows "not available" when no live activity
- [ ] `LiveChatPanel` — shows "Log in to join" when user is null
- [ ] `LiveChatPanel` — renders message list and input when user is present
- [ ] `LiveChatPanel` — sends message on Enter key
- [ ] `LiveChatPanel` — auto-scrolls on new messages

### 5. Integration Tests (DEFERRED)
> Covered via E2E Playwright tests below.
- [ ] Publish auction → 30311 auto-published (fire-and-forget) → query returns live activity
- [ ] Send chat message → appears in query results
- [ ] Status derivation: planned → live → ended based on timestamps

### 6. E2E / Playwright Tests (`e2e/tests/auction-live-chat.spec.ts`) — 4 tests
- [x] Live chat panel is visible on auction detail page (desktop viewport)
- [x] Live chat panel shows login prompt for unauthenticated users
- [x] Merchant can type a message in the live chat input
- [x] Publishing an auction also publishes a 30311 live activity event

### 7. Manual Smoke Tests
- [ ] Publish auction → 30311 created → chat visible in sidebar
- [ ] Chat messages appear in real-time for multiple users
- [ ] Status auto-updates (planned → live → ended)

## Test Infrastructure

- **Unit tests**: `bun test` (project uses `bun:test` imports)
- **E2E tests**: Playwright (`e2e/playwright.config.ts`)
- **Mock pattern**: See `src/publish/orders.test.ts` for NDK/signer mock examples

## Test Summary

| Category | File | Tests | Status |
|----------|------|-------|--------|
| Unit (core) | `src/lib/nip53.test.ts` | 13 | Passing |
| Unit (publish) | `src/publish/liveChat.test.ts` | 9 | Passing |
| Unit (queries) | `src/queries/liveChat.test.ts` | 8 | Passing |
| E2E | `e2e/tests/auction-live-chat.spec.ts` | 4 | Written (requires running app) |
| **Total** | | **34** | |
