# Market Aggregator Relay

Market-kind-gated strfry aggregation relay for Plebeian Market. Solves
the dead-relay timeout problem identified in #1046 by serving all
market-relevant events from a single fast relay.

This is the **READ tier** of a two-relay topology. See
[`deploy-simple/relay/`](../relay/) for the **WRITE tier** (Khatru Go relay
at `relay.plebeian.market`), and [`../../RELAY_PLAN.md`](../../RELAY_PLAN.md)
for the full relay strategy.

## Architecture

```
                        WRITE PATH
[Market App] ────────────────────────────────────────────────┐
     │ publishes stalls, listings, orders, reactions         │
     │                                                      ▼
     │ READ PATH                              [relay.plebeian.market : Khatru :3334]
     │                                                       (authoritative source)
     ▼                                                              │
[market-agg.orangesync.tech : strfry :7780] ◄──────────────────────┤
     │ market-kind gate             ◄────────────────────────────  │
     │ (any pubkey,                  ◄────────────────────────────  │
     │  market-relevant kinds)                  [relay.damus.io]    │
     ▼                                          [nos.lol]          │
[write-policy.py]                                                  │
                                                                  │
scraped upstream: relay.plebeian.market + damus + nos.lol ◄────────┘
```

## Files

| File                 | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `docker-compose.yml` | Container orchestration                                           |
| `strfry.conf`        | Relay configuration (DB size, limits, write-policy)               |
| `write-policy.py`    | Market-kind gate — accepts market-relevant events from any pubkey |
| `Dockerfile`         | strfry + python3 for write-policy plugin                          |

## Deploy

```bash
cd deploy-simple/aggregator
mkdir -p db state
docker compose up -d --build
```

The write-policy gate accepts events with market-relevant kinds (products,
stalls, orders, zaps, etc.) from **any pubkey** — the marketplace is open
to all sellers. The root npub's non-market events are also accepted for
bootstrap. The optional allowlist (`state/allowed.npubs`) serves as an
additional trust layer (future: verified-seller badge). See
`write-policy.py` for the full kind list.

## Market app wiring

After deployment, `src/lib/stores/ndk.ts` uses
`wss://market-agg.orangesync.tech` as a primary relay for production.
