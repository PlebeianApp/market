# Market Aggregator Relay

A self-contained Nostr aggregation relay for Plebeian Market. It solves the
dead-relay timeout problem from #1046 by scraping market-relevant events from
upstream relays and serving them from a single fast local relay, so the market
UI reads against one endpoint (~ms local) instead of fanning out to many
unreliable relays.

## Architecture (dual-mode)

The deployment runs in one of two modes. The _write-policy_ is identical in
both — the difference is what the **scraper daemon** collects:

```
                            PERSONAL MODE (operator)            PLEBEIAN MODE (future)
  scraper collects          root npub's follow graph +         all market participants'
                            market activity + WoT network      market events
```

```
                              [Market App]
                                   | queries (ONE relay, ~ms local)
                                   v
                +--------------------------------------------+
                | market-agg.example.com : strfry :7777 |
                |   write-policy.py  <-  allowed.npubs (WoT) |
                +--------------------------------------------+
                       ^ republish EVENTS          ^ state/allowed.npubs
                       |                           |
            +-----------------------+        +-----------------------+
            | scraper daemon        |        | scrapes upstream      |
            |  publisher thread ----+        | relay.damus.io        |
            |  relay workers (N)    |        | nos.lol               |
            |  maintain timer       |        | relay.plebeian.market |
            +-----------------------+        +-----------------------+
```

### Data flow

1. **scraper** bootstraps from the seed relays: fetches the root npub's kind 3
   (follows) and kind 10002 (relay list).
2. For each followed pubkey it discovers _their_ relay lists (kind 10002),
   building a `(pubkey, relay)` index.
3. One worker thread per relay holds a persistent subscription for all tracked
   pubkeys (chunked author filters) plus a `#p` filter for events mentioning
   the root npub.
4. Every received EVENT is re-published into **strfry** via a dedicated
   publisher socket.
5. Every 5 min the scraper refreshes the root npub's replaceable events;
   every 30 min it expands the tracked set from newly-seen `p` tags (capped at
   `MAX_PUBKEYS`); every hour it prunes pubkeys unseen for `PRUNE_AGE_DAYS`.
6. The tracked set is written to `state/allowed.npubs`, which the
   **write-policy** hot-reloads (on mtime change) to gate restricted kinds.

### Write-policy (the gate)

`write-policy.py` is the strfry writePolicy plugin. It is **kind-based**, not
membership-based, so public market data is accepted broadly:

| Kind class          | Examples                                                                                       | Accepted from                       |
| ------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| **PUBLIC market**   | 0, 1, 3, 7, 9735, 1985, 10000, 10002, 1023–1026, 30402, 30405/06/08, 30440–30442, 31555, 31990 | **anyone** (public data)            |
| **RESTRICTED**      | 1059, 1060 (NIP-17 gift-wrap), 30078 (NIP-78 app data)                                         | **root npub or WoT allowlist only** |
| **everything else** | —                                                                                              | **rejected**                        |

The root npub's own events are always accepted, so the relay can bootstrap
before the allowlist is populated.

## Files

| File                 | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `docker-compose.yml` | Two services: `strfry-market-agg` + `scraper`                       |
| `strfry.conf`        | Relay config (DB size, limits, write-policy path)                   |
| `write-policy.py`    | strfry plugin — market-kind gate + WoT-restricted kinds             |
| `scraper.py`         | Scraping daemon (bootstrap → discover → scrape → expand → maintain) |
| `Dockerfile`         | strfry + python3 + websocket-client (shared by both services)       |

## Deploy

This deployment is fully **self-contained**: `docker-compose.yml` defines its
own bridge network (no external networks) and both services build from the
local `Dockerfile`. It runs standalone on any host with Docker — no other
project's networks or containers are required — so it can be deployed wherever
you like.

```bash
cd deploy-simple/aggregator
mkdir -p db state
docker compose up -d --build
```

- The relay container (`market-agg-relay`, compose service `strfry-market-agg`)
  listens on `127.0.0.1:7780` (Caddy proxies `market-agg.example.com` ->
  `:7780`).
- `scraper` starts after the relay, bootstraps the root npub's network, and
  begins scraping. Tail logs with `docker compose logs -f scraper`.

## Scraper configuration

All knobs are environment variables (see `docker-compose.yml`):

| Variable                | Default                                                          | Meaning                                |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `ROOT_HEX`              | _(required)_                                                     | root npub (hex) defining personal mode |
| `STRFRY_URL`            | `ws://localhost:7777`                                            | strfry websocket to republish into     |
| `SEED_RELAYS`           | `wss://relay.plebeian.market,wss://relay.damus.io,wss://nos.lol` | bootstrap + discovery relays           |
| `MAX_PUBKEYS`           | `2000`                                                           | cap on tracked pubkeys (personal mode) |
| `PRUNE_AGE_DAYS`        | `30`                                                             | prune pubkeys unseen this long         |
| `MAX_RELAYS`            | `10`                                                             | cap on concurrently-scraped relays     |
| `MAX_AUTH_PER_REQ`      | `200`                                                            | authors per REQ filter (relay ceiling) |
| `ROOT_REFRESH_INTERVAL` | `300` (5 min)                                                    | root replaceable-event refresh         |
| `EXPAND_INTERVAL`       | `1800` (30 min)                                                  | WoT expansion from new `p` tags        |
| `PRUNE_INTERVAL`        | `3600` (1 hour)                                                  | stale-pubkey pruning                   |

## Market app wiring

After deployment, `src/lib/stores/ndk.ts` uses
`wss://market-agg.example.com` as a primary relay for production.
