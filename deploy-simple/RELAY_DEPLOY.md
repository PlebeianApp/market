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
## Troubleshooting

### Quick diagnosis checklist

```bash
# 1. Check if the relay is running
sudo systemctl status orly

# 2. Check recent logs
sudo journalctl -u orly -n 50 --no-pager

# 3. Check disk space
df -h

# 4. Check what's using disk
sudo du -sh /var/lib/orly/.local/share/ORLY/
sudo du -sh /var/log/* | sort -rh | head -10
```

### Disk full (`no space left on device`)

**Symptoms**: Relay exits immediately with status 0, logs show:

```
Cannot write pid file "/var/lib/orly/.local/share/ORLY/LOCK" err: write ... no space left on device
```

Systemd keeps restarting the relay (restart counter climbs into thousands), which floods syslog and makes the disk situation worse.

**Fix**:

```bash
# Stop the relay to stop the log flood
sudo systemctl stop orly

# Check what's consuming space
df -h
sudo du -sh /var/log/* | sort -rh | head -10

# Truncate syslog (usually the biggest offender during crash loops)
sudo truncate -s 0 /var/log/syslog
sudo rm -f /var/log/syslog.1 /var/log/syslog.2.gz

# Clean up systemd journal
sudo journalctl --vacuum-size=500M

# Verify space was freed
df -h

# Start the relay
sudo systemctl start orly
sudo systemctl status orly
```

### Emergency mode (`refusing connection: system overloaded`)

**Symptoms**: Relay is running (`active (running)`) but refuses all WebSocket connections. Logs show:

```
refusing connection: emergency mode active
refusing connection from x.x.x.x: system overloaded
```

This typically happens when the relay has been running for a long time under memory pressure (check for swap usage in `systemctl status`).

**Fix**:

```bash
# Restart clears the emergency mode state
sudo systemctl restart orly
sudo systemctl status orly

# Verify it's accepting connections
curl -s -H 'Accept: application/nostr+json' https://relay.staging.plebeian.market/ | jq .version

# Check memory situation
free -h
```

If the relay keeps entering emergency mode after restart, the server may need more RAM or the relay's rate limiter config may need tuning.

### Relay won't start (other causes)

```bash
# Check the full service file for config issues
cat /etc/systemd/system/orly.service

# Check which binary is being used and its version
ls -la /usr/local/bin/orly /home/deployer/.local/bin/orly.dev
/usr/local/bin/orly version

# Check if the database lock file is stale (after unclean shutdown)
ls -la /var/lib/orly/.local/share/ORLY/LOCK
# If the relay is not running but LOCK exists, remove it:
sudo rm /var/lib/orly/.local/share/ORLY/LOCK
sudo systemctl start orly
```

### Common operations

```bash
# List all relay services on the server
sudo systemctl list-units --type=service | grep -i -E 'orly|relay|bugs|nostr'

# Start / stop / restart (replace SERVICE with: orly, bugs, etc.)
sudo systemctl start SERVICE
sudo systemctl stop SERVICE
sudo systemctl restart SERVICE

# Check NIP-11 info (confirms relay is responding)
curl -s -H 'Accept: application/nostr+json' https://relay.plebeian.market/ | jq .

# Follow logs in real time
sudo journalctl -u SERVICE -f
```

### Services on the server

Multiple relay services may run on the same host:

| Service | Domain                              | Description        |
| ------- | ----------------------------------- | ------------------ |
| `orly`  | `relay.staging.plebeian.market`     | Main staging relay |
| `bugs`  | `bugs.plebeian.market`              | Bugs relay         |

Use the list command above to discover all running relay services.

### Production vs staging differences

| Item    | Staging                                  | Production                         |
| ------- | ---------------------------------------- | ---------------------------------- |
| Host    | `staging.plebeian.market`                | `plebeian.market`                  |
| Binary  | `/home/deployer/.local/bin/orly.dev`     | `/usr/local/bin/orly`              |
| NIP-11  | `https://relay.staging.plebeian.market/` | `https://relay.plebeian.market/`   |
| DB path | `/var/lib/orly/.local/share/ORLY/`       | `/var/lib/orly/.local/share/ORLY/` |

## Notes

## Rollback

If a deploy fails, `install-relay.sh` restores the previous binary, env file,
and service unit before exiting non-zero. The workflow also restores the
previous Caddy config if the new relay Caddyfile fails to reload.
- The binary is named `orly.dev` on staging (historical), not `orly`
- Production uses `/usr/local/bin/orly` as the binary path
- The relay runs as the `deployer` user, not root
- Caddy handles TLS termination and reverse proxies to port 10547
- The market app runs separately on port 3000 (managed by PM2)
