# Plebeian Market Relay Strategy

> **Status:** Living document. Updated with PR #1066 (market-kind gate).
> **Related issues:** #1046 (dead-relay timeouts), #1066 (aggregator relay).

## Architecture Overview

Three relay services serve Plebeian Market. They have **distinct roles** —
no duplicates:

| Relay                        | Software               | Role                                                              | Internal Port                        | Deploy Artifacts            |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------- | ------------------------------------ | --------------------------- |
| `relay.plebeian.market`      | **Khatru** (custom Go) | **WRITE** — app publishes stalls, listings, auctions, orders here | `127.0.0.1:3334`                     | `deploy-simple/relay/`      |
| `relay.plebeian.market` | **strfry**             | **READ** — fast cache, market-kind gated, scrapes upstream relays | `127.0.0.1:7780` → container `:7777` | `deploy-simple/aggregator/` |
| `bugs.plebeian.market`       | —                      | Bug report intake                                                 | —                                    | —                           |

## Data Flow

### Write Path

```
[Market App]
     │ publishes (stalls, listings, auctions, orders, reactions)
     ▼
[relay.plebeian.market : Khatru :3334]
```

- Sellers publish stalls (NIP-15/99), listings, shipping options, and orders.
- Deployed via GitHub Actions + systemd (`deploy-simple/relay/`).
- This is the **authoritative source** for marketplace events.

### Read Path (Production)

```
[Market App]
     │ queries (ONE relay, ~5ms)
     ▼
[relay.plebeian.market : strfry :7780]
     │ market-kind gate       ↑ scrapes upstream
     │ (any pubkey,           │
     │  market-relevant)      │
     ▼                        │
[write-policy.py]      [relay.plebeian.market]
                            [relay.damus.io]
                            [nos.lol]
```

- The aggregator **pre-fetches** market events from upstream relays.
- The app queries **one fast relay** instead of fanning out to 6+
  potentially-dead public relays (eliminates the 8s
  `fetchEventsWithTimeout` waterfall from #1046).
- **Gate policy:** market-kind gate — accepts market-relevant events from
  **any pubkey**, ensuring all marketplace participants' content is visible.

### Read Path (Development / Staging)

Unchanged — no aggregator relay. Uses `MAIN_RELAY_BY_STAGE[stage]` +
`DEFAULT_PUBLIC_RELAYS` directly.

## Relay Constants in App Code

All relay configuration lives in `src/lib/constants.ts`:

| Constant                  | Purpose                       | Count    | Used For                                 |
| ------------------------- | ----------------------------- | -------- | ---------------------------------------- |
| `MAIN_RELAY_BY_STAGE`     | Primary relay per stage       | 3 stages | Write operations, app relay set          |
| `DEFAULT_PUBLIC_RELAYS`   | Read fan-out to broader Nostr | 6 relays | Backup read path                         |
| `MARKET_AGGREGATOR_RELAY` | Production read primary       | 1 relay  | Prepended in production `getRelayUrls()` |
| `ZAP_RELAYS`              | Zap receipt detection         | 7 relays | NIP-57 payment monitoring                |
| `DEFAULT_NIP46_RELAYS`    | NIP-46 bunker connections     | 5 relays | Wallet/signing                           |
| `BUG_RELAY`               | Bug report submission         | 1 relay  | Error reporting                          |

> **Future:** Consider consolidating these into a single `RELAY_TOPOLOGY`
> config object so adding/removing a relay happens in one place.

## Aggregator Gate Policy

### Dual-Mode Gate (current — reconciled from #1066 + #1069)

The write-policy plugin (`deploy-simple/aggregator/write-policy.py`) uses a
**dual-mode** gate that separates public market data from private data:

1. **PUBLIC market kind** (from any pubkey) — profiles, stalls, listings,
   comments, zap receipts, relay lists, app settings, etc.
2. **RESTRICTED kind** (from root npub or WoT allowlist only) — gift wraps,
   order messages, payment receipts, Cashu wallets, app-specific data
3. **Root npub** — bootstrap/personal events always accepted
4. **Allowlisted pubkey** — additional trust layer for future use

Market-relevant kinds (discovered from the codebase):

| Kind  | NIP | Description                            |
| ----- | --- | -------------------------------------- |
| 0     | 1   | Metadata (user profiles)               |
| 3     | 2   | Contacts / follow lists                |
| 5     | 9   | Deletions                              |
| 1     | 1   | Text notes (bug reports)               |
| 4     | 4   | DMs                                    |
| 7     | 25  | Reactions                              |
| 13    | 59  | Seals (private order details)          |
| 14    | 17  | General communication (order messages) |
| 16    | —   | Order processing and status updates    |
| 17    | —   | Payment receipts                       |
| 1059  | 59  | Gift wraps (private order details)     |
| 1111  | —   | Comments                               |
| 30018 | 15  | Products (legacy)                      |
| 30402 | 99  | Classified listings (products)         |
| 30405 | —   | Collections                            |
| 30406 | —   | Shipping options                       |
| 31989 | 89  | Handler recommendation                 |
| 31990 | 89  | App handler info                       |
| 9735  | 57  | Zap receipts                           |
| 10000 | 51  | Mute lists                             |
| 10002 | 65  | Relay lists                            |
| 30000 | 51  | App settings, vanity, NIP-05           |
| 30078 | 78  | Cart persistence, relay prefs, v4v     |
| 9775  | 78  | App-specific data (NWC wallets)        |
| 25910 | —   | ctxvm client messages                  |

### Previous: WoT-Social Gate (replaced)

The original gate accepted events only from the root npub + its 2-hop social
follow set. This was **wrong for a marketplace**: buyers must see all
sellers' stalls, not just those in the operator's personal social graph.
A new seller publishing a stall who wasn't in the follow set → aggregator
rejected the event → invisible through the primary read relay.

## strfry Configuration Highlights

| Setting            | Value   | Rationale                                                                     |
| ------------------ | ------- | ----------------------------------------------------------------------------- |
| DB mapsize         | 3 GB    | Market events are small but numerous                                          |
| `maxTagsPerFilter` | 8       | Market queries filter on stall_id, category, price, location (was 3, too low) |
| `maxNumTags`       | 2000    | Stalls/listings carry many tags (price, images, shipping)                     |
| `maxFilterLimit`   | 500     | Matches app-side query limits                                                 |
| `maxReqFilterSize` | 200     | Complex market filters                                                        |
| Negentropy         | enabled | Fast sync from upstream relays                                                |

## Future Considerations

1. **Aggregator as sole production read relay** — once completeness is
   verified, drop the 6 `DEFAULT_PUBLIC_RELAYS` from the production read
   path to fully eliminate dead-relay timeouts. Requires a monitoring
   script that checks aggregator coverage vs. main relay for sample kinds.

2. **Relay constant consolidation** — merge the 6 relay arrays in
   `constants.ts` into a single typed `RELAY_TOPOLOGY` object.

3. **Coverage monitoring** — a script that compares event counts per kind
   between the aggregator and `relay.plebeian.market` to detect gaps.

4. **Allowlist as verified-seller tier** — the hot-reload allowlist
   mechanism is preserved for future use as a verified-seller badge or
   premium-tier feature.
