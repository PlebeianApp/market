# Staging Relay Deployment

How to deploy the ORLY relay to `relay.staging.plebeian.market`.

## Automated (GitHub Actions)

The `deploy-relay.yml` workflow triggers when `deploy-simple/relay-version`
is changed on `master`.

### How to trigger

```bash
# 1. Edit the version file to the desired ORLY release tag
echo "v0.60.4" > deploy-simple/relay-version

# 2. Commit and push (or PR → merge to master)
git add deploy-simple/relay-version
git commit -m "chore: bump staging relay to v0.60.4"
git push origin master
```

The workflow will:

1. Read the version from `deploy-simple/relay-version`
2. Query NIP-11 at `https://relay.staging.plebeian.market/` for the deployed version
3. Skip if versions already match
4. Clone the ORLY repo at the specified tag, build, test, and deploy

### Required secrets

Uses the same secrets as the market app deploy (already configured):

| Secret             | Description               |
| ------------------ | ------------------------- |
| `STAGING_HOST`     | `staging.plebeian.market` |
| `STAGING_USER`     | `deployer`                |
| `STAGING_PASSWORD` | SSH password for deployer |

The ORLY repo URL is hardcoded in the workflow (public repo).

## Manual Procedure

### Step 1: Check current version

```bash
curl -s -H 'Accept: application/nostr+json' https://relay.staging.plebeian.market/ | jq '.version'
# e.g. "0.52.17"
```

### Step 2: Clone and build

```bash
# Clone the ORLY relay repo at the desired tag
git clone --depth 1 --branch v0.60.3 \
  ssh://git@git.nostrdev.com:29418/mleku/next.orly.dev.git relay-src
cd relay-src

# Build the web UI
cd app/web && bun install && bun run build && cd ../..

# Build the binary (target: linux/amd64)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o orly ./cmd/orly

# Verify architecture
file orly
# ELF 64-bit LSB executable, x86-64
```

### Step 3: Deploy

```bash
# SSH details
HOST="staging.plebeian.market"
USER="deployer"    # or root
REMOTE_BIN="/home/deployer/.local/bin/orly.dev"

# Upload the binary
scp orly ${USER}@${HOST}:/tmp/orly-new

# SSH in and swap
ssh ${USER}@${HOST} << 'DEPLOY'
  set -e
  REMOTE_BIN="/home/deployer/.local/bin/orly.dev"

  # Backup
  cp -f ${REMOTE_BIN} ${REMOTE_BIN}.prev

  # Stop
  sudo systemctl stop orly

  # Install
  cp /tmp/orly-new ${REMOTE_BIN}
  chmod +x ${REMOTE_BIN}

  # Start
  sudo systemctl start orly

  # Verify
  sleep 5
  sudo systemctl is-active orly
  ${REMOTE_BIN} version

  # Cleanup
  rm /tmp/orly-new
DEPLOY
```

### Step 4: Verify

```bash
# Check NIP-11 version
curl -s -H 'Accept: application/nostr+json' https://relay.staging.plebeian.market/ | jq '.version'

# Check logs
ssh root@staging.plebeian.market 'journalctl -u orly -n 20 --no-pager'
```

### Rollback

```bash
ssh root@staging.plebeian.market \
  'cp /home/deployer/.local/bin/orly.dev.prev /home/deployer/.local/bin/orly.dev && sudo systemctl restart orly'
```

## Server Details

| Item         | Value                                    |
| ------------ | ---------------------------------------- |
| Host         | staging.plebeian.market (176.58.119.108) |
| User         | deployer                                 |
| Binary       | `/home/deployer/.local/bin/orly.dev`     |
| Service      | `orly` (systemd)                         |
| Port         | 10547 (behind Caddy reverse proxy)       |
| NIP-11       | `https://relay.staging.plebeian.market/` |
| Architecture | x86_64 (amd64)                           |
| OS           | Ubuntu 24.04                             |

## Notes

- The binary is named `orly.dev` on the server (historical), not `orly`
- The relay runs as the `deployer` user, not root
- Caddy handles TLS termination and reverse proxies to port 10547
- The market app runs separately on port 3000 (managed by PM2)
