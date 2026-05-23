# NIP-53 Live Chat for Auctions

## Branch: `feat/nip53-auction-live-chat`
## Target: `auctions/p2pk-path-oracle-via-cvm-v1`

## Decisions
- **Event relationship**: Separate 30311 event referencing 30408 via `a` tag (Option A)
- **Same `d` tag**: `30311:seller:xyz` ↔ `30408:seller:xyz` — swap kind to derive
- **Custom tag**: `["marketplace", "plebeian"]` for filterable discovery
- **Chat persistence**: Ephemeral (NIP-53 native, kind 1311)
- **UI placement**: Sidebar panel on auction detail page
- **Access**: Anyone with a Nostr key can chat
- **Relays**: Same as auction relays
- **Auto-update**: App auto-derives status from auction timestamps
- **Participant roles**: v1 = Host (seller) only. Participant tracking deferred to Phase 2.

## Event Architecture
```
Kind 30408 (Auction)          <- existing, untouched
  ^ referenced by
Kind 30311 (Live Activity)    <- NEW: wraps auction as live event
  ^ referenced by
Kind 1311 (Live Chat Message) <- NEW: ephemeral messages
```

## Checklist

### Step 1: Core types and utilities
- [x] Create `src/lib/nip53.ts` — constants, types, coordinate helpers, status derivation, tag builder
- [x] Create `src/lib/nip53.test.ts` — 13 unit tests (all pass)

### Step 2: Publish functions
- [x] Create `src/publish/liveChat.tsx` — publishLiveActivity, publishLiveChatMessage, updateLiveActivityStatus, mutation hooks

### Step 3: Query infrastructure
- [x] Add `liveActivityKeys` to `src/queries/queryKeyFactory.ts`
- [x] Create `src/queries/liveChat.tsx` — useLiveActivity, useLiveChatMessages hooks

### Step 4: UI components
- [x] Create `src/components/LiveChatMessage.tsx` — message bubble
- [x] Create `src/components/LiveChatPanel.tsx` — sidebar chat panel

### Step 5: Integration
- [x] Modify `src/publish/auctions.tsx` — auto-publish 30311 with auction (fire-and-forget)
- [x] Modify `src/routes/auctions.$auctionId.tsx` — sidebar layout + LiveChatPanel

### Step 6: Verification
- [x] 26 unit tests pass
- [x] Build (pre-existing error in about.tsx, not related to our changes)
- [ ] Manual test: publish auction -> 30311 created -> chat visible in sidebar
- [ ] Manual test: chat messages appear in real-time for multiple users
- [ ] Manual test: status auto-updates (planned -> live -> ended)

## Files Changed

| Action | File | Lines | Purpose |
|--------|------|-------|---------|
| CREATE | `src/lib/nip53.ts` | +131 | Constants, types, utilities |
| CREATE | `src/lib/nip53.test.ts` | +140 | 13 unit tests |
| CREATE | `src/publish/liveChat.tsx` | +174 | Publish 30311 and 1311 |
| CREATE | `src/queries/liveChat.tsx` | +84 | Query hooks |
| CREATE | `src/components/LiveChatMessage.tsx` | +45 | Message bubble |
| CREATE | `src/components/LiveChatPanel.tsx` | +116 | Sidebar chat panel |
| MODIFY | `src/queries/queryKeyFactory.ts` | +6 | Add liveActivityKeys |
| MODIFY | `src/publish/auctions.tsx` | +5 | Auto-publish 30311 |
| MODIFY | `src/routes/auctions.$auctionId.tsx` | +6 | Sidebar layout |

**Total: ~707 lines added across 9 files**

## Phase 2 (NOT in scope)
- Participant presence tracking (p tags with Participant role)
- Pinned messages
- Message moderation (hide/delete)
- Reactions on chat messages (kind 7)
- Browse page for live auctions
- Mobile bottom sheet
- Notification sounds
