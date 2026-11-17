# Plebeian Market Relay

This directory contains the declarative relay deployment assets for both
`staging` and `production`.

## Layout

- `cmd/market-relay/main.go` - Repo-owned `khatru` relay application
- `config/*.env` - Committed stage configuration
- `systemd/market-relay.service` - Systemd unit template used on every host
- `install-relay.sh` - Idempotent remote installer used by GitHub Actions

## Resilience

- `systemd/20-limits.conf` installs as
  `/etc/systemd/system/market-relay.service.d/20-limits.conf`:
  `MemoryMax=5G`, `MemorySwapMax=0`, `Restart=always`. There is deliberately
  no `MemoryHigh`: hitting the hard limit should OOM-kill the unit in its
  cgroup and restart it, not spend minutes in reclaim.
- `market-relay-watchdog.timer` runs every 30s, probes `/healthz`, and
  SIGKILLs + restarts the unit when it stops answering. This covers the
  hung-but-alive case that `Restart=on-failure` cannot see.
- `GOGC=50` is set in the stage env. `GOMEMLIMIT` is added only after the
  live heap has been measured with `GODEBUG=gctrace=1`; it must stay above
  the live heap or the collector will spend its time spinning.
- The installer removes the old
  `/etc/systemd/system.control/market-relay.service.d/50-Memory{High,Max}.conf`
  drop-ins so they cannot override the repo-managed limits, and restores them
  if the deployment rolls back.

## Deployment Model

The relay is built from this repository and deployed by
`.github/workflows/deploy-relay.yml`.

Each deploy uploads:

- `market-relay` binary
- systemd unit
- committed stage config
- install script

Then the install script converges the VPS to the desired state:

1. install binary
2. install config
3. install systemd unit
4. create data directories
5. restart `market-relay`
6. verify local NIP-11

## Stage Config

The stage env files are committed because relay config is operational state that
should live in git:

- `config/staging.env`
- `config/production.env`

Secrets are intentionally not required for the relay service itself.
