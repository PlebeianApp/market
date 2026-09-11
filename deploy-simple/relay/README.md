# Plebeian Market Relay

This directory contains the declarative relay deployment assets for both
`staging` and `production`.

## Layout

- `cmd/market-relay/main.go` - Repo-owned `khatru` relay application
- `internal/searchindex/` - Compatible compact mapping and offline rebuild
- `config/*.env` - Committed stage configuration
- `systemd/market-relay.service` - Systemd unit template used on every host
- `install-relay.sh` - Idempotent remote installer used by GitHub Actions
- `install-staging-relay.sh` - Guarded manual staging activation, preserving the live environment

## Deployment Model

The relay is built from this repository and deployed by
`.github/workflows/deploy-relay.yml`.

Each deploy uploads:

- `market-relay` binary
- systemd unit
- committed stage config
- install script

Staging activation is manual. `install-staging-relay.sh` checks the existing
service, disk space, and rollback files, replaces the binary and unit, preserves
the live environment, then observes runtime identity and disk growth after a
controlled restart. Production uses `install-relay.sh`, which also installs its
committed environment file. Neither installer deletes relay data.

Ordinary starts and updates preserve existing raw events and search indexes.
Missing/corrupt index metadata now fails startup instead of deleting the index.
A missing index over existing raw events also requires explicit recovery.
Shutdown closes both storage backends before exit.

## Resource Controls

- The systemd unit defaults to `GOMEMLIMIT=1GiB`; `/etc/market-relay.env` can
  override this. This is a soft Go-runtime budget, not a process RSS limit or
  proof that an OOM is impossible. Memory mappings and other VPS processes
  still need headroom. See the [Go GC guide](https://go.dev/doc/gc-guide#Memory_limit).
- `RELAY_MIN_FREE_BYTES` defaults to `536870912` (512 MiB). New event saves and
  replacements check both data filesystems and fail before writing when either
  is below the reserve. Reads remain available; no events are pruned. Setting
  this to `0` disables the check. Background compaction and other processes can
  still consume disk, so this does not replace monitoring.
- Relay journal messages are limited to 200 per 30 seconds. This bounds bursts,
  not total journal retention across the host. Journal retention remains an
  operator setting.

## Compact Search Index

New indexes use explicit fields with duplicate stored content, term vectors,
doc values, and catch-all indexing disabled. The field names and analyzers stay
compatible with the pinned `eventstore/bleve` backend. Existing indexes keep
their original mapping until explicitly rebuilt.

To rebuild, first follow the backup, disk-space, and downtime requirements in
[the operations runbook](../../docs/ops/relay-pruning.md#offline-compact-index-rebuild).
The installed binary must include the rebuild command:

```bash
# With the relay stopped and an off-host raw-event backup already verified:
GOMEMLIMIT=1GiB /usr/local/bin/market-relay \
  --rebuild-search-to /var/lib/market-relay/search-compact
```

This command opens `raw/events.db` read-only, respects the running relay's lock,
requires a new output path, checks for at least 2 GiB free before each bounded
batch, and verifies the document count. It never activates the new index,
changes raw events, or removes the old index. Failed output is retained with an
incomplete marker and cannot be used by the relay.

The fixture regression test measures roughly 88% less index storage with the
same search results. This is not a projection of savings on staging's full data.

## Khatru Upgrade Compatibility

The September 2, 2026 `fiatjaf.com/nostr` version
`v0.0.0-20260902034142-316ef6591fa2` was inspected. Its Bleve backend requires
language configuration, changes content fields from `c` to language-specific
fields, changes timestamp representation, and defaults to a kind allowlist
that omits marketplace products. Its event-store replacement API also changed.
Upgrading it directly would not preserve current search behavior. Keep the
existing dependency pinned until an explicit migration covers those changes;
do not reset the live index to make an upgrade start.

## Validation

```bash
go test -race ./...
go vet ./...
```

Tests cover damaged-index preservation, store shutdown/reopen, disk-pressure
write rejection with continuing reads, read-only rebuilds, output/lock safety,
incomplete rebuild rejection, and legacy/compact search compatibility.

## Stage Config

The stage env files are committed because relay config is operational state that
should live in git:

- `config/staging.env`
- `config/production.env`

Secrets are intentionally not required for the relay service itself.
