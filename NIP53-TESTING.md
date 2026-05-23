# NIP-53 Testing Plan

## Branch: `feat/nip53-auction-live-chat`
## Target: `auctions/p2pk-path-oracle-via-cvm-v1`

## Implementation Status

All 6 implementation steps are **complete**. See `NIP53-PLAN.md` for details.

## Files Created/Modified

### Market Repo (`~/plebeian-testing-15.05.2026/market`)

| File | Layer | Has Tests? |
|------|-------|------------|
| `src/lib/nip53.ts` | Core utils | Yes — `nip53.test.ts` (13 tests) |
| `src/publish/liveChat.tsx` | Publish | Yes — `liveChat.test.ts` (9 tests) |
| `src/queries/liveChat.tsx` | Queries | Yes — `liveChat.test.ts` (8 tests) |
| `src/components/LiveChatPanel.tsx` | UI | Yes — E2E Playwright (8 tests) |
| `src/components/LiveChatMessage.tsx` | UI | Yes — E2E Playwright (8 tests) |
| `src/publish/auctions.tsx` | Integration | Covered via E2E |
| `src/routes/auctions.$auctionId.tsx` | Integration | Covered via E2E |
| `src/queries/queryKeyFactory.ts` | Queries | No (trivial addition) |

### Tollgate Infrastructure Repo (`~/tollgate-infrastructure-kit`)

| File | Purpose |
|------|---------|
| `ansible/playbooks/26-plebeian-market-test.yml` | Ansible playbook |
| `ansible/roles/plebeian_market_test/` | Ansible role (deploy + teardown) |
| `tests/e2e/tests/plebeian-market.spec.ts` | Playwright smoke tests against live VPS |
| `tests/integration/test_plebeian_market.sh` | SSH-based integration tests |
| `scripts/test-plebeian.sh` | Convenience: deploy → test → teardown |

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

### 4. E2E — UI Component Tests (`e2e/tests/auction-live-chat-ui.spec.ts`) — 8 tests
- [x] Empty state message "No messages yet. Be the first!"
- [x] Message count displays as "0 messages" initially
- [x] Status indicator is gray dot when auction has not started (planned)
- [x] Message input accepts text and submits via Enter key
- [x] Chat panel is hidden on mobile viewport (375px)
- [x] Chat panel is visible on desktop viewport
- [x] Unauthenticated user sees "Log in to join" prompt instead of input
- [x] Chat messages display with relative timestamp ("just now", "5m", etc.)

### 5. E2E — Protocol Tests (`e2e/tests/auction-live-chat.spec.ts`) — 4 tests
- [x] Live chat panel is visible on auction detail page (desktop viewport)
- [x] Live chat panel shows login prompt for unauthenticated users
- [x] Merchant can type a message in the live chat input
- [x] Publishing an auction also publishes a 30311 live activity event

### 6. Tollgate — Live Smoke Tests (`tests/e2e/tests/plebeian-market.spec.ts`) — 8 tests
- [x] Market app returns successful HTTP response
- [x] Market SPA loads with HTML content
- [x] Auctions page is accessible
- [x] Products page is accessible
- [x] Login dialog opens when clicked
- [x] Test relay HTTP endpoint responds
- [x] Test relay NIP-11 info document
- [x] Test relay WebSocket upgrade succeeds

### 7. Tollgate — Integration Tests (`tests/integration/test_plebeian_market.sh`)
- [x] Test-market container running
- [x] Test-relay container running
- [x] Port 34568 listening + HTTP response
- [x] Port 10548 listening
- [x] Caddy routing to test-market subdomain
- [x] Caddy routing to test-relay subdomain
- [x] Docker compose file exists
- [x] Caddy snippet file exists

### 8. Tollgate — Ansible Deployment
- [x] Playbook `26-plebeian-market-test.yml`
- [x] Role `plebeian_market_test` with deploy + teardown
- [x] Docker Compose template (market + nak relay)
- [x] Caddy snippet template
- [x] DNS A record creation/removal
- [x] Convenience script `scripts/test-plebeian.sh`

### 9. Manual Smoke Tests (on orangesync.tech VPS)
- [ ] Deploy: `scripts/test-plebeian.sh deploy`
- [ ] Publish auction → 30311 created → chat visible in sidebar
- [ ] Chat messages appear in real-time for multiple users
- [ ] Status auto-updates (planned → live → ended)
- [ ] Teardown: `scripts/test-plebeian.sh teardown`

## Test Infrastructure

- **Unit tests**: `bun test` (project uses `bun:test` imports)
- **E2E tests (market repo)**: Playwright (`e2e/playwright.config.ts`)
- **E2E tests (tollgate repo)**: Playwright (`tests/e2e/playwright.config.ts`)
- **Integration tests**: Bash SSH scripts (`tests/integration/`)
- **Mock pattern**: See `src/publish/orders.test.ts` for NDK/signer mock examples

## Test Summary

| Category | Repo | File | Tests | Status |
|----------|------|------|-------|--------|
| Unit (core) | market | `src/lib/nip53.test.ts` | 13 | Passing |
| Unit (publish) | market | `src/publish/liveChat.test.ts` | 9 | Passing |
| Unit (queries) | market | `src/queries/liveChat.test.ts` | 8 | Passing |
| E2E (UI) | market | `e2e/tests/auction-live-chat-ui.spec.ts` | 8 | Written |
| E2E (protocol) | market | `e2e/tests/auction-live-chat.spec.ts` | 4 | Written |
| E2E (smoke) | tollgate | `tests/e2e/tests/plebeian-market.spec.ts` | 8 | Written |
| Integration | tollgate | `tests/integration/test_plebeian_market.sh` | 8 | Written |
| **Total** | | | **58** | |

## Deployment Commands

```bash
# Deploy test instance to VPS
cd ~/tollgate-infrastructure-kit
./scripts/test-plebeian.sh deploy

# Run all tests against deployed instance
./scripts/test-plebeian.sh test

# Full cycle: deploy → test → teardown
./scripts/test-plebeian.sh full

# Teardown only
./scripts/test-plebeian.sh teardown
```
