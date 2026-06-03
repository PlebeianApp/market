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
- [x] Create `contextvm/tools/__tests__/live-activity-worker.test.ts` — 19 tests, all passing

### Phase 3: Integrate into CVM server
- [x] Modify `contextvm/server.ts` — add `startLiveActivityWorker()` call after MCP connect

### Phase 4: Update client code
- [x] Modify `src/publish/liveChat.tsx` — removed `publishLiveActivity`, `updateLiveActivityStatus`, `usePublishLiveActivityMutation`
- [x] Modify `src/queries/liveChat.tsx` — changed query from `authors: [seller]` to `#a` tag
- [x] Modify `src/publish/auctions.tsx` — removed fire-and-forget `publishLiveActivity` call
- [x] Modify `src/components/LiveChatPanel.tsx` — gets `liveActivityCoord` from fetched data

### Phase 5: Update nip53 helpers
- [x] Modify `src/lib/nip53.ts` — `parseLiveActivity` reads seller from `['p', ..., 'Host']` tag
- [x] Update `src/lib/nip53.test.ts` — 13 tests passing
- [x] Update `src/publish/liveChat.test.ts` — 2 tests passing (removed obsolete tests)
- [ ] Update `src/queries/liveChat.test.ts` — if exists
- [ ] Add `current_participants`/`total_participants` to `LiveActivity` interface + parser

### Phase 6: Update E2E tests
- [x] E2E tests unchanged — already have correct `#a` tag and `['p', ..., 'Host']` tag on seeded events

### Phase 7: Validate and ship
- [x] Run full unit test suite in worktree — 34 pass (19 worker + 15 client)
- [x] Commit all changes — `52bd6848`
- [x] Push to upstream — `feat/cvm-worker-nip53-status`
- [ ] Rebase after PR #947 merges
- [ ] Create PR targeting `auctions/p2pk-path-oracle-via-cvm-v1`
- [ ] Verify CI green on PR

## Roadmap (future PRs)
- **Approach B watchlist**: SQLite table of known auctions from MCP tool calls
- **Adaptive interval**: Poll more frequently near status transitions
- **Participant tracking optimization**: Cache message author sets between iterations
