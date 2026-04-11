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

## Inspect App Setup Events

The app setup flow writes these relay events:

- app settings: `kind=31990`, `d=plebeian-market-handler`
- admin list: `kind=30000`, `d=admins`
- editor list: `kind=30000`, `d=editors`

The current app pubkey on both staging and production is:

```text
7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb
```

The commands below query the relay directly with `nak`.

For repeatable operational checks and republishing, use the repo-owned script
folder [deploy-simple/scripts/app-settings](/Users/schlaus/workspace/market/deploy-simple/scripts/app-settings).

```bash
bun run deploy:app-settings:inspect -- --stage staging
bun run deploy:app-settings:inspect -- --stage production
```

To republish directly with the app private key:

```bash
bun run deploy:app-settings:publish -- \
  --stage staging \
  --secret-key "$APP_PRIVATE_KEY" \
  --settings-file deploy-simple/scripts/app-settings/examples/settings.example.json \
  --admins-file deploy-simple/scripts/app-settings/examples/admins.example.json \
  --editors-file deploy-simple/scripts/app-settings/examples/editors.example.json
```

### Staging

```bash
nak req -k 31990 -a 7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb --tag d=plebeian-market-handler wss://relay.staging.plebeian.market | jq '.content |= (fromjson? // .)'

nak req -k 30000 -a 7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb --tag d=admins wss://relay.staging.plebeian.market | jq '{id, created_at, pubkey, admins: [.tags[] | select(.[0] == "p") | .[1]]}'

nak req -k 30000 -a 7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb --tag d=editors wss://relay.staging.plebeian.market | jq '{id, created_at, pubkey, editors: [.tags[] | select(.[0] == "p") | .[1]]}'
```

### Production

```bash
nak req -k 31990 -a 7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb --tag d=plebeian-market-handler wss://relay.plebeian.market | jq '.content |= (fromjson? // .)'

nak req -k 30000 -a 7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb --tag d=admins wss://relay.plebeian.market | jq '{id, created_at, pubkey, admins: [.tags[] | select(.[0] == "p") | .[1]]}'

nak req -k 30000 -a 7b3979f5936f590541eb4f51c2ce3094194d1c57386e706dd05aca98766a7ceb --tag d=editors wss://relay.plebeian.market | jq '{id, created_at, pubkey, editors: [.tags[] | select(.[0] == "p") | .[1]]}'
```

If a command prints nothing beyond the relay connection line, that event is not
present on the relay.

## Back Up Market Events

For repo-owned backups and restores of market events defined in
[SPEC.md](/Users/schlaus/workspace/market/SPEC.md), use
[deploy-simple/scripts/market-events](/Users/schlaus/workspace/market/deploy-simple/scripts/market-events).

```bash
bun run deploy:market-events:backup -- --stage staging
bun run deploy:market-events:backup -- --stage production

bun run deploy:market-events:restore -- \
  --stage staging \
  --in-dir deploy-simple/backups/market-staging-20260320T000000Z
```

The backup script writes one NDJSON file per scope plus `all.ndjson` and a
`manifest.json`, so you can inspect or edit the backup before restoring it.

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
