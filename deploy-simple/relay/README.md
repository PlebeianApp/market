# Plebeian Market Relay

This directory contains the declarative relay deployment assets for both
`staging` and `production`.

## Layout

- `cmd/market-relay/main.go` - Repo-owned `khatru` relay application
- `config/*.env` - Committed stage configuration
- `systemd/market-relay.service` - Systemd unit template used on every host
- `install-relay.sh` - Idempotent remote installer used by GitHub Actions

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
