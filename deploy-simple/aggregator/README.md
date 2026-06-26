# Market Aggregator Relay

WoT-gated strfry aggregation relay for Plebeian Market. Solves the
dead-relay timeout problem identified in #1046 by serving all
market-relevant events from a single fast relay.

## Architecture

```
[Market App]
     | queries (ONE relay, ~5ms local)
     v
[market-agg.orangesync.tech : strfry :7780]
     ^ write-policy checks      ^ scrapes upstream
     |                           |
[allowed.npubs]            [nos.lol, damus, relay.orangesync.tech]
     | WoT allowlist (2-hop trust graph)
```

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Container orchestration |
| `strfry.conf` | Relay configuration (DB size, limits, write-policy) |
| `write-policy.py` | WoT gate — only accepts events from allowed npubs |
| `Dockerfile` | strfry + python3 for write-policy plugin |

## Deploy

```bash
cd deploy-simple/aggregator
mkdir -p db state
docker compose up -d --build
```

The allowlist (`state/allowed.npubs`) is populated by the reconcile/scrape
timers in the tollgate-infrastructure-kit playbook
(`39-plebeian-market-agg.yml`). The root npub's events are always accepted
to bootstrap.

## Market app wiring

After deployment, `src/lib/stores/ndk.ts` uses
`wss://market-agg.orangesync.tech` as a primary relay for production.
