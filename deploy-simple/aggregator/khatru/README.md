# Market Aggregator Relay (Khatru-only alternative)

A single Go binary that combines the **WRITE tier** and **READ/cache tier** of the
Plebeian Market relay topology in one Khatru relay. This is the Khatru-only
alternative to the strfry aggregator in the [parent directory](../) — requested
by @Franchovy in PR #1066 review so the two approaches can be diffed.

It replaces the two-process strfry + `write-policy.py` + `scraper.py` setup with
one native Go binary that:

- serves a [Khatru](https://github.com/fiatjaf/khatru) relay (write path),
- enforces the same **dual-mode market-kind gate** as `write-policy.py`, but as
  a native `RejectEvent` Go hook (no Python subprocess),
- runs a **scraper goroutine** that pulls market events from the relay graph
  into local SQLite storage (read/cache path), and
- supports **NIP-77 negentropy sync** natively (`relay.Negentropy = true`).

> Addresses both of Franchovy's concerns: **no new infrastructure** (runs on the
> existing `relay.plebeian.market` host) and **no doubled relay load** (one
> process instead of strfry + a second relay).

## Architecture

```
                   WRITE + READ PATH (single process)
[Market App] ───────────────────────────────────────────────┐
     │ publishes stalls, listings, orders, reactions        │
     │ queries the same relay for cached events             │
     ▼                                                      ▼
[market-agg-relay : Khatru :3334]   (this binary)
     │ RejectEvent gate                    ▲ scraper goroutine
     │ (any pubkey,                        │ pulls market kinds from:
     │  market-relevant kinds)             │   [relay.plebeian.market]
     │ root npub + allowlist for the rest  │   [relay.damus.io]
     ▼                                     │   [nos.lol] + discovered
[SQLite store] ◄───────────────────────────┘
```

Compared to the strfry topology, the write and read tiers collapse into one
process — there is no separate strfry cache relay and no Python policy plugin.

## Files

| File          | Purpose                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `main.go`     | Relay bootstrap: SQLite store, RejectEvent gate, scraper goroutine, HTTP |
| `config.go`   | Environment-variable configuration + npub decoding                       |
| `scraper.go`  | Relay-graph discovery + market-kind subscription → local store           |
| `policy/`     | Pure-Go dual-mode gate (ported from `../write-policy.py`) + unit tests   |
| `go.mod`      | Go module: khatru, go-nostr, eventstore/sqlite3                          |

## Build

Requires Go 1.26+ (cgo, for the SQLite backend):

```bash
cd deploy-simple/aggregator/khatru
go build -o market-agg-relay .
```

Or with the Makefile:

```bash
make build
```

## Run

```bash
export SEED_NPUB=npub1...        # bech32 npub of the relay operator (required)
export DB_PATH=./market-agg.db   # SQLite path           (default: ./market-agg.db)
export LISTEN_ADDR=:3334         # bind address          (default: :3334)
export ALLOWED_PATH=./allowed.npubs  # allowlist file    (default: ./allowed.npubs)
export BOOTSTRAP_RELAYS=wss://relay.plebeian.market,wss://relay.damus.io,wss://nos.lol
export SCRAPE_INTERVAL=3600      # seconds between scrape cycles (default: 3600)

./market-agg-relay
```

The relay then listens for Nostr WebSocket clients on `LISTEN_ADDR` while the
scraper goroutine continuously discovers relays (from the seed npub's kind 3
contacts + kind 10002 relay lists, then each contact's kind 10002) and pulls
market-relevant events into the SQLite store.

## Deploy on relay.plebeian.market

The intent of this alternative is to run **on the existing relay host** rather
than as a new service. A minimal deployment:

1. Build the binary on the host (or cross-compile and ship it):
   ```bash
   go build -o /opt/market-agg-relay .
   ```
2. Create a systemd unit that exports `SEED_NPUB` (the operator npub already
   used by the write relay) and runs the binary, persisting `DB_PATH` on disk.
3. Point the reverse proxy (the existing `relay.plebeian.market` TLS terminator)
   at the Khatru `LISTEN_ADDR`, or run alongside the current write relay on a
   different port during evaluation.

No Docker image is required (unlike the strfry option), since Khatru is a single
statically-resolved Go binary with an embedded SQLite database.

## Gate policy

The `policy/` subpackage ports `../write-policy.py` faithfully. The gate rules,
in priority order:

1. **Market-relevant kind** → accepted from **any pubkey** (the marketplace is
   open to all sellers).
2. **Root operator npub** → always accepted (bootstrap + personal events).
3. **Allowlisted pubkey** → accepted even for non-market kinds (verified
   sellers / future trust tiers; the allowlist file is hot-reloaded on mtime
   change, matching the Python plugin).
4. Everything else → rejected.

The `MARKET_KINDS` set mirrors `write-policy.py` exactly — see
[`policy/policy.go`](policy/policy.go) for the authoritative list and keep the
two in sync when it changes. The unit tests in `policy/policy_test.go` lock in
the gate behaviour.

## Test

```bash
make test
# or directly:
go test ./...
```

The `policy` package has full unit coverage of the gate rules and the
hot-reloading file allowlist.
