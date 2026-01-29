# Plebeian Market - Local Development Environment

> **⚠️ This folder is for LOCAL TESTING ONLY using Docker.**
>
> For actual staging/production deployments, see [`deploy-simple/`](../deploy-simple/README.md).

This folder simulates a VPS environment locally for testing the deployment process without affecting real servers.

## When to Use What

| Folder | Purpose | Used By |
|--------|---------|---------|
| `deploy/` | Local Docker simulation | Developers testing deployment |
| `deploy-simple/` | Real deployments | GitHub Actions, manual deploys |

## Quick Start (Local Testing with Docker)

```bash
# 1. Start the VPS simulation container
cd deploy
docker-compose up -d

# 2. Wait for container to start (~5 seconds)
sleep 5

# 3. Setup VPS (installs Caddy, Bun, PM2, Netdata)
./setup-vps.sh

# 4. Deploy the application
./deploy-app.sh

# 5. Access your services
open http://localhost          # Application (via Caddy)
open http://localhost:3000     # Application (direct)
```

> **Note**: The Docker simulation has some limitations:
>
> - No systemd (Netdata, Prometheus, Grafana won't auto-start)
> - SSH may have rate limiting after many connections
> - Use a real VPS for production deployments

## Prerequisites

### Local Machine

- Docker & Docker Compose
- `sshpass` (for automated SSH)

  ```bash
  # macOS
  brew install hudochenkov/sshpass/sshpass

  # Ubuntu/Debian
  apt-get install sshpass
  ```

### Real VPS

- Ubuntu 22.04 LTS
- SSH access
- Sudo privileges
- 4GB+ RAM recommended

## Folder Structure

```
deploy/                       # LOCAL TESTING ONLY
├── Dockerfile.vps            # Ubuntu 22.04 container with SSH
├── docker-compose.yml        # Container orchestration
├── Caddyfile                 # Reverse proxy config (Docker only)
├── ecosystem.config.cjs      # PM2 config (Docker only)
├── setup-vps.sh              # Installs dependencies on container
├── deploy-app.sh             # Deploys to Docker container
├── pm2-control.sh            # Remote PM2 control
└── README.md                 # This file

deploy-simple/                # REAL DEPLOYMENTS
├── deploy.sh                 # Multi-stage deployment script
├── control.sh                # Service control commands
├── caddyfiles/               # Stage-specific Caddy configs
│   ├── Caddyfile.staging
│   └── Caddyfile.production
├── env/                      # Environment templates
│   ├── .env.development.example
│   ├── .env.staging.example
│   └── .env.production.example
└── README.md                 # Deployment documentation
```

## Scripts

### `setup-vps.sh` - VPS Setup

Installs all required software on a fresh Ubuntu 22.04 server:

- **Bun** - JavaScript runtime
- **PM2** - Process manager
- **Caddy** - Reverse proxy with automatic HTTPS
- **Netdata** - Real-time system monitoring
- **Prometheus** - Metrics collection
- **Grafana** - Metrics visualization and dashboards

```bash
# Usage
./setup-vps.sh [SSH_HOST] [SSH_USER] [SSH_PASSWORD]

# Examples
./setup-vps.sh localhost:2222 deployer deployer
./setup-vps.sh staging.plebeian.market deployer mypassword

# Or with environment variables
export SSH_HOST=staging.plebeian.market
export SSH_USER=deployer
export SSH_PASSWORD=mypassword
./setup-vps.sh
```

### `deploy-app.sh` - Application Deployment

Deploys the Plebeian Market application using blue-green deployment:

1. Builds the application locally
2. Creates a new release directory
3. Copies files to VPS
4. Creates environment file
5. Installs dependencies
6. Swaps symlink (blue-green)
7. Starts/reloads PM2
8. Configures Caddy
9. Cleans up old releases

```bash
# Usage
./deploy-app.sh [SSH_HOST] [SSH_USER] [SSH_PASSWORD]

# Example
./deploy-app.sh localhost:2222 deployer deployer
```

### `pm2-control.sh` - Remote PM2 Control

Control PM2 processes without SSH-ing manually:

```bash
# List processes
./pm2-control.sh ls

# View logs
./pm2-control.sh logs
./pm2-control.sh logs 50  # Last 50 lines

# Restart/reload
./pm2-control.sh restart
./pm2-control.sh reload   # Zero-downtime

# Stop/start
./pm2-control.sh stop
./pm2-control.sh start

# Monitoring
./pm2-control.sh monit    # Interactive dashboard
./pm2-control.sh status   # Detailed status

# Environment
./pm2-control.sh env      # Show env variables
```

## Monitoring Stack

### PM2 Prometheus Exporter (http://localhost:9209/metrics)

Exports PM2 metrics for Prometheus:

- Process CPU and memory usage
- Restart counts
- Process status

### Netdata (http://localhost:19999) - Production VPS Only

Real-time system monitoring with:

- CPU, memory, disk, network graphs
- Per-process resource usage
- System alerts

> **Note**: Requires systemd to auto-start. In Docker simulation, run manually:
>
> ```bash
> ssh deployer@localhost -p 2222
> sudo netdata
> ```

### Prometheus + Grafana - Production VPS Only

For production VPS with systemd, you can install:

- **Prometheus**: Metrics collection and storage
- **Grafana**: Dashboards and visualization

See the full setup guide in `DEPLOYMENT.md` or install manually on your VPS.

## Blue-Green Deployment

The deployment uses blue-green (or "immutable deployment") strategy:

```
/home/deployer/
├── releases/
│   ├── market-20260126-120000/  (old)
│   ├── market-20260126-130000/  (old)
│   └── market-20260126-140000/  (current)
├── market -> releases/market-20260126-140000/  (symlink)
└── logs/
    ├── market-staging-error.log
    └── market-staging-out.log
```

Benefits:

- **Instant rollback**: Just update symlink to previous release
- **No downtime**: New version is ready before swap
- **Clean state**: Each release is isolated
- **History**: Keep last 3 releases for rollback

## Configuration Files

### Caddyfile

Configures the reverse proxy:

- Routes traffic to PM2 apps
- Handles WebSocket connections
- Automatic HTTPS (in production)
- Access logging

Edit for production:

```caddyfile
# Change from:
:80 {
    reverse_proxy localhost:3000
}

# To:
staging.plebeian.market {
    reverse_proxy localhost:3000
}

plebeian.market {
    reverse_proxy localhost:3001
}
```

### ecosystem.config.cjs

PM2 process configuration **for Docker simulation only**:

- App name, script, arguments
- Environment variables
- Log file locations
- Restart policies
- Resource limits

> **Note**: This file is NOT used for real deployments. The `deploy-simple/deploy.sh` script generates `ecosystem.config.cjs` dynamically with stage-specific paths and settings.

### Environment Files

Copy and customize:

```bash
# On staging server
cp .env.staging.example /home/deployer/market/.env
nano /home/deployer/market/.env

# On production server
cp .env.production.example /opt/market/.env
nano /opt/market/.env
```

## Production Deployment

### Initial Server Setup

1. **Create VPS** (Ubuntu 22.04 LTS)
2. **Configure DNS** (point domain to server IP)
3. **Create deployer user**:
   ```bash
   adduser deployer
   usermod -aG sudo deployer
   ```
4. **Run setup script**:
   ```bash
   ./setup-vps.sh your-server.com deployer password
   ```
5. **Update Caddyfile** with real domains
6. **Create environment file** with real secrets
7. **Deploy**:
   ```bash
   ./deploy-app.sh your-server.com deployer password
   ```

### GitHub Actions Integration

GitHub Actions workflows use `deploy-simple/` for real deployments:

- `.github/workflows/deploy.yml` → Staging (on push to master)
- `.github/workflows/release.yml` → Production (on release tags)

See [`deploy-simple/README.md`](../deploy-simple/README.md) for setup instructions.

### Security Recommendations

1. **Use SSH keys** instead of passwords for production
2. **Configure firewall** (UFW):
   ```bash
   ufw allow ssh
   ufw allow http
   ufw allow https
   ufw enable
   ```
3. **Secure Grafana** (change default password, disable anonymous access)
4. **Restrict monitoring ports** (9090, 19999, 3003) to internal network
5. **Rotate secrets** periodically

## Troubleshooting

### Container won't start

```bash
docker-compose logs vps
docker-compose down -v  # Reset volumes
docker-compose up -d
```

### SSH connection refused

```bash
# Wait for container to fully start
sleep 10
# Check container status
docker-compose ps
```

### App not starting

```bash
./pm2-control.sh logs
./pm2-control.sh status
```

### Grafana not showing data

1. Check Prometheus is running: http://localhost:9090/targets
2. Check PM2 exporter: http://localhost:9209/metrics
3. Restart Grafana: `./pm2-control.sh` then manually restart

### Reset everything

```bash
docker-compose down -v
docker-compose up -d
./setup-vps.sh
./deploy-app.sh
```

## Port Reference

| Port  | Service      | Description                       |
| ----- | ------------ | --------------------------------- |
| 2222  | SSH          | Container SSH (maps to 22 inside) |
| 80    | Caddy        | HTTP traffic                      |
| 443   | Caddy        | HTTPS traffic                     |
| 3000  | Market       | Staging application               |
| 3001  | Market       | Production application            |
| 9090  | Prometheus   | Metrics storage                   |
| 3003  | Grafana      | Dashboards                        |
| 19999 | Netdata      | Real-time monitoring              |
| 9209  | PM2 Exporter | PM2 metrics endpoint              |
