# Plebeian Market Relay

This directory contains the declarative relay deployment assets for both
`staging` and `production`.

## Layout

- `cmd/market-relay/main.go` - Repo-owned `khatru` relay application
- `config/*.env` - Committed stage configuration
- `systemd/market-relay.service` - Systemd unit template used on every host
- `install-relay.sh` - Idempotent remote installer used by GitHub Actions

## Search

The relay advertises NIP-50 and keeps a Bleve index scoped to marketplace
events. `RELAY_SEARCH_KINDS` (default `0,30402`) controls which kinds are indexed;
everything else is stored in BoltDB only. Those are the two kinds the app
searches: profiles (0) and product listings (30402). Kind 30023 (long-form)
is not searched by the app; add it only if long-form marketplace articles
should be searchable by external NIP-50 clients. Kind 1059 gift wraps and
kind 1 notes are never indexed.

The index uses a compact mapping (`internal/searchindex`): content, kind,
pubkey suffix, and `created_at`, with no stored fields, term vectors, or doc
values. New installs create it automatically. On an existing host, rebuild it
offline after stopping the relay:

```
sudo systemctl stop market-relay
sudo -u deployer sh -c '. /etc/market-relay.env; /usr/local/bin/market-relay --rebuild-search-to /var/lib/market-relay/search-new'
sudo mv /var/lib/market-relay/search /var/lib/market-relay/search-old
sudo mv /var/lib/market-relay/search-new /var/lib/market-relay/search
sudo chown -R deployer:deployer /var/lib/market-relay/search
sudo systemctl start market-relay
```

Keep `search-old` until the rollback window closes. A missing index over a
non-empty raw store refuses startup; the rebuild command is the only way to
create a replacement.

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
