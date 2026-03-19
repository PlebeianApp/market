# Relay Deployment

The relay is now deployed from this repository with a repo-owned `khatru`
application under [deploy-simple/relay](/Users/schlaus/workspace/market/deploy-simple/relay).

## What Deploys

The relay deploy workflow ships these artifacts together:

1. `market-relay` binary built from `deploy-simple/relay/cmd/market-relay`
2. `market-relay.service` systemd unit
3. committed stage config from `deploy-simple/relay/config`
4. stage Caddyfile from `deploy-simple/caddyfiles`
5. `install-relay.sh` to converge the host state

## Workflow

The GitHub Actions workflow is [deploy-relay.yml](/Users/schlaus/workspace/market/.github/workflows/deploy-relay.yml).

- Pushes to `master` that touch `deploy-simple/relay/**` deploy staging
- `workflow_dispatch` can deploy `staging`, `production`, or `all`

Production uses the same installer and binary as staging. The only differences
are the committed stage config and the GitHub environment secrets for SSH.

## Stage Config

- [staging.env](/Users/schlaus/workspace/market/deploy-simple/relay/config/staging.env)
- [production.env](/Users/schlaus/workspace/market/deploy-simple/relay/config/production.env)

Those files are intentionally committed so relay operational state stays
declarative in git.

## Remote Layout

The installer converges the host to this layout:

- Binary: `/usr/local/bin/market-relay`
- Service: `market-relay`
- Env file: `/etc/market-relay.env`
- Data dir: `/var/lib/market-relay`
- Search index: `/var/lib/market-relay/search`
- Raw event store: `/var/lib/market-relay/raw`

## Verification

After deploy, verify:

```bash
curl -s -H 'Accept: application/nostr+json' https://relay.staging.plebeian.market/ | jq .
ssh deployer@staging.plebeian.market 'sudo systemctl status market-relay --no-pager'
ssh deployer@staging.plebeian.market 'sudo journalctl -u market-relay -n 50 --no-pager'
```

For production, replace the hostname with `relay.plebeian.market`.

## Data Migration

Use [scripts/migrate-relay.ts](/Users/schlaus/workspace/market/scripts/migrate-relay.ts)
to copy events from an old relay to the new relay at the Nostr protocol layer.

Examples:

```bash
# Migrate bug reports into the main app relay
SOURCE_RELAYS=wss://bugs.plebeian.market \
TARGET_RELAYS=wss://relay.plebeian.market \
TAG_T=plebian2beta \
bun run scripts/migrate-relay.ts

# Full relay copy
SOURCE_RELAYS=wss://relay.plebeian.market \
TARGET_RELAYS=wss://relay-new.internal.example \
bun run scripts/migrate-relay.ts
```

## Rollback

If a deploy fails, `install-relay.sh` restores the previous binary, env file,
and service unit before exiting non-zero. The workflow also restores the
previous Caddy config if the new relay Caddyfile fails to reload.
