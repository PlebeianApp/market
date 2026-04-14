# Plebeian Market - Simple Deployment

Multi-stage deployment for Plebeian Market with support for development, staging, and production environments.

## Table of Contents

- [Quick Start](#quick-start)
- [First-Time VPS Setup](#first-time-vps-setup)
- [Local Development Setup](#local-development-setup)
- [Setting Up GitHub Actions](#setting-up-github-actions)
- [Manual Deployment](#manual-deployment)
- [Migration from systemd](#migration-from-systemd)

---

## Quick Start

```bash
# 1. Copy environment file for your stage
cp env/.env.development.example env/.env.development

# 2. Edit with your settings (especially APP_PRIVATE_KEY)
nano env/.env.development

# 3. Deploy
./deploy.sh development deployer@dev.example.com

# 4. Check status
./control.sh development status
```

---

## First-Time VPS Setup

### Step 1: Create a deployer user

```bash
# SSH into your VPS as root
ssh root@your-server.com

# Create deployer user
adduser deployer
usermod -aG sudo deployer

# Allow passwordless sudo for deployment commands
echo 'deployer ALL=(ALL) NOPASSWD: /usr/bin/caddy, /bin/cp, /bin/mkdir, /bin/systemctl' >> /etc/sudoers.d/deployer
```

### Step 2: Set up SSH key authentication

```bash
# On your local machine
ssh-copy-id deployer@your-server.com

# Or manually add your public key
ssh deployer@your-server.com
mkdir -p ~/.ssh
echo "your-public-key" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
```

### Step 3: Install prerequisites

```bash
# SSH as deployer
ssh deployer@your-server.com

# Install Node.js (required for PM2)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Install PM2
sudo npm install -g pm2

# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Create directories
mkdir -p ~/releases ~/logs
sudo mkdir -p /var/log/caddy /var/log/pm2
```

### Step 4: Verify installation

```bash
bun --version
pm2 --version
caddy version
```

---

## Local Development Setup

The old `deploy/` VPS simulation has been removed. For local work, run the app
locally and point it at a local relay, or use `deploy.sh development` against an
explicit development host.

### Using a local relay (nak)

```bash
# Install nak
go install github.com/fiatjaf/nak@latest

# Start local relay
nak serve  # Runs on ws://localhost:10547

# Run the app locally
bun run dev

# Or deploy to an explicit development host
./deploy.sh development deployer@dev.example.com
```

---

## Setting Up GitHub Actions

GitHub Actions are the canonical deployment path for `staging` and `production`.
The shell scripts in this directory are now best treated as manual fallback or
development helpers.

### Step 1: Create GitHub Environments

1. Go to your repo → Settings → Environments
2. Create `staging` environment
3. Create `production` environment (enable "Required reviewers" for approval)

### Step 2: Add Secrets

Go to Settings → Secrets and variables → Actions → New repository secret

**Staging secrets:**

```
STAGING_HOST=staging.plebeian.market
STAGING_USER=deployer
STAGING_PASSWORD=<deployer password>
STAGING_RELAY_URL=wss://relay.staging.plebeian.market
STAGING_APP_PRIVATE_KEY=<64-char hex private key>
```

**Production secrets:**

```
PROD_HOST=plebeian.market
PROD_USER=deployer
PROD_PASSWORD=<deployer password>
PROD_RELAY_URL=wss://relay.plebeian.market
PROD_APP_PRIVATE_KEY=<64-char hex private key>
```

### Step 3: Generate Nostr private key

```bash
# Using nak
nak key generate

# Output:
# seed: <12 words>
# private key: <64-char hex>  ← Use this for APP_PRIVATE_KEY
# public key: <64-char hex>
```

### Step 4: Deploy

```bash
# Staging: merge to master, then wait for E2E Tests to finish and trigger staging deploy
git push origin master

# Production option 1: Create a release tag manually
git tag v1.0.0-release
git push origin v1.0.0-release

# Production option 2: Run the "Promote to Production" workflow in GitHub Actions
```

---

## Manual Deployment

### Deploy to Staging

```bash
# 1. Set up environment
cp env/.env.staging.example env/.env.staging
nano env/.env.staging  # Add your secrets

# 2. Deploy
./deploy.sh staging deployer@staging.plebeian.market

# 3. Verify
./control.sh staging status
./control.sh staging logs
```

### Deploy to Production

```bash
# 1. Set up environment
cp env/.env.production.example env/.env.production
nano env/.env.production  # Add your secrets

# 2. Deploy
SSH_KEY=~/.ssh/prod_key ./deploy.sh production deployer@plebeian.market

# 3. Verify
./control.sh production status
curl https://plebeian.market/api/config
```

---

## Migration from systemd

If you're migrating from the old systemd-based deployment:

### Step 1: Install PM2 on VPS

```bash
ssh deployer@your-server.com
sudo npm install -g pm2
```

### Step 2: Deploy new version

```bash
# This will automatically:
# - Stop old systemd service
# - Disable systemd service
# - Start PM2 process
./deploy.sh production deployer@plebeian.market
```

### Step 3: Verify and cleanup

```bash
# Check PM2 is running
./control.sh production status

# Verify old service is stopped
ssh deployer@plebeian.market "sudo systemctl status market.service"

# Optionally remove old systemd unit
ssh deployer@plebeian.market "sudo rm /etc/systemd/system/market.service"
```

---

## Prerequisites

The VPS must have these installed:

| Tool      | Purpose            | Install Command                                        |
| --------- | ------------------ | ------------------------------------------------------ |
| **Bun**   | JavaScript runtime | `curl -fsSL https://bun.sh/install \| bash`            |
| **PM2**   | Process manager    | `npm install -g pm2`                                   |
| **Caddy** | Reverse proxy      | See [Caddy docs](https://caddyserver.com/docs/install) |
| **nak**   | Local Nostr relay  | `go install github.com/fiatjaf/nak@latest`             |

## Stages

| Stage         | Port | Relay                        | Description                    |
| ------------- | ---- | ---------------------------- | ------------------------------ |
| `development` | 3000 | Local (ws://localhost:10547) | Local app or explicit dev host |
| `staging`     | 3000 | Staging relay                | Pre-production testing         |
| `auctionsdev` | 3002 | Staging relay                | Auctions feature staging       |
| `production`  | 3001 | Production relay             | Live environment               |

## Environment Files

```
deploy-simple/
├── env/
│   ├── .env.development.example   # Copy to .env.development
│   ├── .env.auctionsdev.example   # Copy to .env.auctionsdev
│   ├── .env.staging.example       # Copy to .env.staging
│   └── .env.production.example    # Copy to .env.production
```

### Required Variables

| Variable          | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `APP_STAGE`       | Explicit stage override (`staging`, `production`, etc.)  |
| `NODE_ENV`        | `development`, `staging`, or `production`                |
| `PORT`            | Application port (3000 for staging, 3001 for production) |
| `APP_RELAY_URL`   | Nostr relay WebSocket URL                                |
| `APP_PRIVATE_KEY` | Server's Nostr private key for the main app (hex format) |
| `CVM_SERVER_KEY`  | Shared ContextVM server private key (hex format)         |

### Optional Variables

| Variable          | Description                              |
| ----------------- | ---------------------------------------- |
| `NIP46_RELAY_URL` | NIP-46 relay for remote signing          |
| `BLOSSOM_SERVER`  | Blossom media server URL                 |
| `NIP96_SERVER`    | NIP-96 media server URL                  |
| `LOG_LEVEL`       | Logging level (debug, info, warn, error) |

## Scripts

### `deploy.sh` - Deploy Application

```bash
# Deploy to specific stage
./deploy.sh development deployer@dev.example.com
./deploy.sh staging user@staging.example.com
./deploy.sh production user@prod.example.com

# With SSH key
SSH_KEY=~/.ssh/id_rsa ./deploy.sh production user@prod.example.com

# Override defaults
SSH_PORT=2222 ./deploy.sh staging user@example.com
```

### `control.sh` - Service Control

```bash
# Use last deployed stage
./control.sh status
./control.sh logs

# Specify stage explicitly
./control.sh development status
./control.sh staging logs 50
./control.sh production restart

# Available commands
./control.sh [stage] status       # Show service status
./control.sh [stage] logs [n]     # View last n log lines
./control.sh [stage] logs-relay   # View relay service logs
./control.sh [stage] restart      # Restart application
./control.sh [stage] stop         # Stop application
./control.sh [stage] start        # Start application
./control.sh [stage] ssh          # SSH into VPS
./control.sh [stage] releases     # List deployed releases
./control.sh [stage] rollback     # Rollback to previous release
```

## Architecture

```
Browser → Caddy (port 80)
              ├── Static files from dist/
              └── /api/* → Bun (port 3000 or 3001)
```

### What Gets Deployed

| Directory    | Purpose                                       |
| ------------ | --------------------------------------------- |
| `dist/`      | Pre-built static files (served by Caddy)      |
| `src/`       | Server code for the main app (run by Bun/PM2) |
| `contextvm/` | ContextVM server code (run by Bun/PM2)        |
| `.env`       | Environment configuration                     |

### Directory Structure on VPS

```
/home/deployer/
├── market-development/     → symlink to current development release
├── market-staging/         → symlink to current staging release
├── market-production/      → symlink to current production release
├── releases/
│   ├── market-development-20260127-120000/
│   ├── market-staging-20260127-110000/
│   └── market-production-20260127-100000/
└── logs/
    ├── market-development-out.log
    ├── market-staging-out.log
    └── market-production-out.log
```

## Deployment Flow

1. **Build** - Runs `bun run build` locally (creates `dist/`)
2. **Package** - Prepares deployment package (dist, src, package.json)
3. **Upload** - SCPs package to `/home/deployer/releases/market-{stage}-{timestamp}`
4. **Configure** - Copies stage-specific `.env` file
5. **Install** - Runs `bun install --production`
6. **Swap** - Updates symlink to new release (blue-green)
7. **Start** - Starts/reloads the main app and ContextVM server via PM2
8. **Caddy** - Generates and applies Caddyfile
9. **Cleanup** - Removes old releases (keeps last 3 per stage)
10. **Health Check** - Verifies app is responding

## Rollback

```bash
./control.sh staging rollback
```

This will:

1. Show current and previous release
2. Ask for confirmation
3. Stop current app
4. Update symlink to previous release
5. Start app

## Troubleshooting

### App not starting

```bash
./control.sh staging logs
./control.sh staging status
```

### Environment file not found

```bash
# Make sure you copied the example file
cp env/.env.staging.example env/.env.staging
```

### SSH connection issues

```bash
# Test SSH connection
ssh -p 22 user@host "echo 'Connected'"

# Use key-based auth
SSH_KEY=~/.ssh/id_rsa ./deploy.sh staging user@host
```

### Health check fails

```bash
# Check if app is responding
curl http://localhost:3000/api/config

# Check PM2 status
./control.sh staging status
```

## Files

| File            | Purpose                                |
| --------------- | -------------------------------------- |
| `deploy.sh`     | Main deployment script (local use)     |
| `control.sh`    | Service control commands               |
| `env/*.example` | Environment file templates             |
| `caddyfiles/`   | Stage-specific Caddy configurations    |
| `.env.deploy.*` | Saved connection settings (gitignored) |
| `README.md`     | This documentation                     |

## GitHub Actions

The project includes GitHub Actions workflows for automated deployments:

### Staging (`.github/workflows/deploy.yml`)

- **Trigger:** Successful completion of `E2E Tests` on `master`, or manual dispatch
- **Environment:** `staging`
- **URL:** https://staging.plebeian.market

### Production (`.github/workflows/release.yml`)

- **Trigger:** Push tag matching `*-release` (e.g., `v1.0.0-release`), or manual dispatch to redeploy an existing release tag
- **Environment:** `production` (requires approval)
- **URL:** https://plebeian.market

### Production Promotion (`.github/workflows/promote-production.yml`)

- **Trigger:** Manual dispatch
- **Purpose:** Create and push the next `*-release` tag automatically (`patch`, `minor`, or `major`)
- **Follow-up:** The production deploy workflow starts from the created tag

### Required GitHub Secrets

#### Staging Environment

| Secret                    | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `STAGING_HOST`            | Staging server hostname                                       |
| `STAGING_USER`            | SSH username                                                  |
| `STAGING_PASSWORD`        | SSH password                                                  |
| `STAGING_RELAY_URL`       | Nostr relay URL (e.g., `wss://relay.staging.plebeian.market`) |
| `STAGING_APP_PRIVATE_KEY` | App's Nostr private key (hex)                                 |

#### Production Environment

| Secret                 | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `PROD_HOST`            | Production server hostname                            |
| `PROD_USER`            | SSH username                                          |
| `PROD_PASSWORD`        | SSH password                                          |
| `PROD_RELAY_URL`       | Nostr relay URL (e.g., `wss://relay.plebeian.market`) |
| `PROD_APP_PRIVATE_KEY` | App's Nostr private key (hex)                         |

### Creating a Release

```bash
# Tag and push to trigger production deployment
git tag v1.0.0-release
git push origin v1.0.0-release
```

### Production Caddyfile

The production Caddyfile (`caddyfiles/Caddyfile.production`) manages the public
relay and preserves the legacy app:

- `plebeian.market` → Market app (PM2, port 3001)
- `relay.plebeian.market` → Nostr relay (port 3334)
- `legacy.plebeian.market` → Legacy version (port 4173)
