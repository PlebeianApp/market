# CVM Worker for NIP-53 Live Activity Status Updates (Issue #967)

## Problem
NIP-53 live activities (`kind:30311`) are published once and never updated. The spec says clients may treat events with no updates for 1 hour as `ended`. Status is only derived client-side — no interop with other NIP-53 clients.

## Solution
Switch live activity authoring from **seller-signed** to **CVM-signed**. Add a periodic worker loop to the CVM server that publishes status updates and participant counts.

## Architecture Change

### Before (PR #947)
```
Seller publishes auction (kind:30408, signed by seller)
  -> Client publishes live activity (kind:30311, signed by seller key)
  -> Coordinate: 30311:<seller_pubkey>:<dTag>
  -> Never updated
```

### After (this PR)
```
Seller publishes auction (kind:30408, signed by seller)
  -> CVM worker creates live activity (kind:30311, signed by CVM_SERVER_KEY)
  -> Coordinate: 30311:<cvm_pubkey>:<dTag>
  -> Seller as ['p', sellerPubkey, '', 'Host']
  -> Worker updates status: planned -> live -> ended
  -> Worker updates participant counts
```

## Worktree Strategy
- Main working dir `/home/c03rad0r/market` untouched (used by other LLMs)
- CVM worker developed in `/home/c03rad0r/market-cvm-worker` (git worktree on `feat/cvm-worker-nip53-status`)
- Isolated — no conflicts with other agents

## Query Strategy
- **v1 (this PR): Approach A** — Fetch all recent kind:30408 auctions from relays (time-bounded, last 7 days)
- **Roadmap: Approach B** — Maintain local watchlist from MCP tool calls
- **`path_issuer` filtering**: Optional via env var. Handle all auctions by default.

## Configuration (env vars)
| Variable | Default | Description |
|----------|---------|-------------|
| `LIVE_ACTIVITY_INTERVAL_MS` | `60000` | Poll interval in milliseconds |
| `LIVE_ACTIVITY_LOOKBACK_DAYS` | `7` | How far back to look for auctions |
| `LIVE_ACTIVITY_PATH_ISSUER_FILTER` | (empty) | Only manage auctions with this path_issuer |

## New Tags on kind:30311
```
['current_participants', '<count>']   — unique chat authors in last 5 minutes
['total_participants', '<count>']     — total unique chat authors since activity start
```

## Checklist

### Phase 1: Setup
- [x] Create git worktree at `/home/c03rad0r/market-cvm-worker`
- [x] Merge `feat/nip53-auction-live-chat` into `feat/cvm-worker-nip53-status`
- [x] Verify nip53 files present in worktree

### Phase 2: Worker module
- [x] Create `contextvm/tools/live-activity-worker.ts`
  - [x] `startLiveActivityWorker(ctx, intervalMs)` — interval loop
  - [x] `pollAndUpdateLiveActivities(ctx)` — single poll iteration
  - [x] `fetchRecentAuctions(ctx)` — query recent kind:30408 events
  - [x] `fetchExistingLiveActivity(ctx, auctionCoord)` — query by `#a` tag
  - [x] `fetchChatParticipants(ctx, liveActivityCoord)` — count unique authors
  - [x] `countParticipants(messages, now)` — current + total
  - [x] `publishLiveActivityUpdate(ctx, params)` — create/update kind:30311
  - [x] In-memory dedup map
  - [x] Configurable via env vars
- [ ] Create `contextvm/tools/__tests__/live-activity-worker.test.ts`
  - [x] countParticipants tests (5 tests)
  - [x] configuration tests (6 tests)
  - [x] dedupMap tests (3 tests)
  - [x] pollAndUpdateLiveActivities tests (4 tests — 3 failing, fix in progress)
  - [ ] Fix failing tests and verify all pass

### Phase 3: Integrate into CVM server
- [ ] Modify `contextvm/server.ts` — add `startLiveActivityWorker()` call after MCP connect

### Phase 4: Update client code
- [ ] Modify `src/publish/liveChat.tsx` — remove `publishLiveActivity` auto-publish, remove `updateLiveActivityStatus`
- [ ] Modify `src/queries/liveChat.tsx` — change query from `authors: [seller]` to `#a` tag
- [ ] Modify `src/publish/auctions.tsx` — remove fire-and-forget `publishLiveActivity` call

### Phase 5: Update nip53 helpers
- [ ] Modify `src/lib/nip53.ts` — add `current_participants`/`total_participants` to interface + parser
- [ ] Update `src/lib/nip53.test.ts`
- [ ] Update `src/publish/liveChat.test.ts`
- [ ] Update `src/queries/liveChat.test.ts`

### Phase 6: Update E2E tests
- [ ] Modify `e2e/tests/auction-live-chat.spec.ts` — sign with CVM key, update assertions
- [ ] Modify `e2e/tests/auction-live-chat-ui.spec.ts` — same

### Phase 7: Validate and ship
- [ ] Run full unit test suite in worktree
- [ ] Run E2E tests locally (if dev server available)
- [ ] Commit all changes
- [ ] Push to upstream
- [ ] Create PR targeting `auctions/p2pk-path-oracle-via-cvm-v1`
- [ ] Verify CI green

## Roadmap (future PRs)
- **Approach B watchlist**: SQLite table of known auctions from MCP tool calls
- **Adaptive interval**: Poll more frequently near status transitions
- **Participant tracking optimization**: Cache message author sets between iterations
