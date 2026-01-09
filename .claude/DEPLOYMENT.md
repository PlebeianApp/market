# Plebeian Market - Deployment Guide

This guide covers deploying Plebeian Market to various environments including staging and production.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Build Process](#build-process)
4. [Deployment Methods](#deployment-methods)
5. [Staging Deployment](#staging-deployment)
6. [Production Deployment](#production-deployment)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Rollback Procedures](#rollback-procedures)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

**Server:**

- **OS**: Linux (Ubuntu 22.04 LTS recommended)
- **CPU**: 2+ cores
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 20GB+ SSD
- **Network**: Static IP or domain name

**Software:**

- **Bun**: v1.2.4 or higher
- **Node.js**: v18+ (for compatibility)
- **Git**: Latest version
- **systemd**: For service management
- **nginx** or **Caddy**: For reverse proxy (recommended)

### Required Services

1. **Nostr Relay**: Running and accessible
   - Self-hosted relay (Khatru, Strfry, or similar)
   - OR use public relays

2. **Domain & DNS**:
   - Domain name (e.g., `market.example.com`)
   - DNS A record pointing to server IP

3. **SSL Certificate**:
   - Let's Encrypt (recommended, free)
   - Or commercial SSL certificate

### Access Requirements

- SSH access to server
- Sudo privileges
- Deployment user account

---

## Environment Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Node Environment
NODE_ENV=production

# App Configuration
APP_RELAY_URL=wss://relay.example.com
APP_PRIVATE_KEY=<your-app-hex-private-key>
NIP46_RELAY_URL=wss://relay.nsec.app

# Optional: Image/Media Servers
BLOSSOM_SERVER=https://blossom.example.com
NIP96_SERVER=https://media.example.com

# Optional: Monitoring
SENTRY_DSN=https://...
LOG_LEVEL=info
```

### Security Considerations

**Important**: Never commit `.env` files or private keys to version control!

**Private Key Management**:

- Generate a dedicated key for the app
- Store securely (password manager, secrets manager)
- Rotate periodically
- Use different keys for staging and production

**Generate App Key**:

```bash
# Using nak
nak key generate

# Or use any Nostr key generator
# Save both the private key (hex) and npub
```

---

## Build Process

### Local Build

**Development build:**

```bash
bun run build
```

**Production build:**

```bash
NODE_ENV=production bun run build:production
```

This will:

- Generate route tree (`src/routeTree.gen.ts`)
- Bundle frontend code
- Minify and optimize
- Output to `dist/` directory

### Build Output

```
dist/
├── index.js           # Server bundle
├── frontend.js        # Client bundle
├── frontend.css       # Compiled styles
└── ...                # Other assets
```

---

## Deployment Methods

### Method 1: Manual Deployment

Best for: Small deployments, testing

**Steps:**

1. **Build locally**:

   ```bash
   bun run build:production
   ```

2. **Transfer to server**:

   ```bash
   rsync -avz --delete \
     dist/ public/ src/ package.json bun.lock \
     user@server:/path/to/app/
   ```

3. **SSH to server**:

   ```bash
   ssh user@server
   cd /path/to/app
   ```

4. **Install dependencies**:

   ```bash
   bun install --production
   ```

5. **Start application**:
   ```bash
   NODE_ENV=production bun src/index.tsx
   ```

### Method 2: Automated Script

Best for: Staging deployments, CI/CD

Use the provided deployment script:

```bash
# Configure in script or via env vars
export STAGING_HOST=staging.example.com
export STAGING_USER=deploy
export STAGING_PATH=/home/deploy/market

# Run deployment
bun run deploy:staging
```

See [scripts/deploy-staging.sh](../scripts/deploy-staging.sh) for details.

### Method 3: Docker (Future)

Best for: Containerized environments, Kubernetes

**Note**: Docker support is planned but not yet implemented.

---

## Staging Deployment

### Purpose

Staging environment should mirror production for testing:

- Same environment variables (different keys/relays)
- Same deployment process
- Same monitoring setup

### Prerequisites

1. **Staging server** set up (separate from production)
2. **Staging relay** configured
3. **Staging domain** (e.g., `staging.market.example.com`)

### Deployment Steps

1. **Update environment variables**:

   ```bash
   # On staging server: /path/to/app/.env
   NODE_ENV=production
   APP_RELAY_URL=wss://staging-relay.example.com
   APP_PRIVATE_KEY=<staging-app-key>
   ```

2. **Run deployment script**:

   ```bash
   # From local machine
   ./scripts/deploy-staging.sh
   ```

3. **Verify deployment**:

   ```bash
   ssh deploy@staging.example.com
   sudo systemctl status plebeian-market-staging
   curl https://staging.market.example.com/api/config
   ```

4. **Test critical paths**:
   - User login
   - Product creation
   - Cart and checkout
   - Payment flow
   - Order management

### Staging Checklist

- [ ] Environment variables configured
- [ ] Staging relay running and accessible
- [ ] App starts without errors
- [ ] `/api/config` endpoint returns valid data
- [ ] Frontend loads and renders
- [ ] User authentication works
- [ ] Product creation works
- [ ] Cart and checkout functional
- [ ] No console errors in browser

---

## Production Deployment

### Pre-deployment Checklist

- [ ] Code reviewed and approved
- [ ] All tests passing
- [ ] Staging deployment successful
- [ ] Database backups (if applicable)
- [ ] Relay backups (event database)
- [ ] Rollback plan prepared
- [ ] Monitoring configured
- [ ] Incident response plan ready

### Production Server Setup

#### 1. Server Provisioning

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y curl git build-essential

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Create deployment user
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG sudo deploy
```

#### 2. Application Setup

```bash
# Switch to deploy user
sudo su - deploy

# Clone repository
git clone https://github.com/PlebianApp/market.git
cd market

# Install dependencies
bun install --production

# Create .env file
nano .env
# (Add production environment variables)
```

#### 3. systemd Service

Create `/etc/systemd/system/plebeian-market.service`:

```ini
[Unit]
Description=Plebeian Market
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/market
ExecStart=/home/deploy/.bun/bin/bun src/index.tsx
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=plebeian-market
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Enable and start**:

```bash
sudo systemctl daemon-reload
sudo systemctl enable plebeian-market
sudo systemctl start plebeian-market
sudo systemctl status plebeian-market
```

#### 4. Reverse Proxy (nginx)

Create `/etc/nginx/sites-available/plebeian-market`:

```nginx
upstream plebeian_market {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name market.example.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name market.example.com;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/market.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/market.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Proxy settings
    location / {
        proxy_pass http://plebeian_market;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Static assets
    location /images/ {
        alias /home/deploy/market/public/images/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

**Enable site**:

```bash
sudo ln -s /etc/nginx/sites-available/plebeian-market /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. SSL Certificate (Let's Encrypt)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d market.example.com

# Auto-renewal is configured by default
```

### Deployment Process

#### Zero-Downtime Deployment

1. **Build new version**:

   ```bash
   git pull origin master
   bun install --production
   bun run build:production
   ```

2. **Test build locally**:

   ```bash
   NODE_ENV=production bun src/index.tsx
   # Verify on localhost:3000
   # Ctrl+C to stop
   ```

3. **Deploy with systemd**:

   ```bash
   sudo systemctl restart plebeian-market
   ```

4. **Verify deployment**:

   ```bash
   sudo systemctl status plebeian-market
   sudo journalctl -u plebeian-market -f
   curl https://market.example.com/api/config
   ```

5. **Monitor for errors**:
   - Check systemd logs
   - Check nginx logs
   - Monitor application metrics

### Post-deployment Checklist

- [ ] Application starts successfully
- [ ] Relay connection established
- [ ] Frontend loads without errors
- [ ] API endpoints respond correctly
- [ ] WebSocket connections work
- [ ] User authentication functional
- [ ] Critical user flows tested
- [ ] No error spikes in logs
- [ ] SSL certificate valid
- [ ] Monitoring alerts configured

---

## Monitoring & Maintenance

### Log Management

**Application logs**:

```bash
# View real-time logs
sudo journalctl -u plebeian-market -f

# View last 100 lines
sudo journalctl -u plebeian-market -n 100

# View logs from specific time
sudo journalctl -u plebeian-market --since "2025-11-20 10:00:00"
```

**nginx logs**:

```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log
```

### Health Checks

**Automated health check**:

```bash
#!/bin/bash
# /home/deploy/health-check.sh

ENDPOINT="https://market.example.com/api/config"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" $ENDPOINT)

if [ $STATUS -eq 200 ]; then
    echo "OK: Application is healthy"
    exit 0
else
    echo "ERROR: Application returned $STATUS"
    exit 1
fi
```

**Cron job** (every 5 minutes):

```bash
crontab -e

*/5 * * * * /home/deploy/health-check.sh >> /var/log/plebeian-market-health.log 2>&1
```

### Monitoring Metrics

**Key metrics to monitor**:

- Uptime
- Response time
- Error rate
- WebSocket connections
- Relay connectivity
- Memory usage
- CPU usage
- Disk usage

**Tools**:

- **Prometheus** + **Grafana**: Metrics and dashboards
- **Sentry**: Error tracking
- **Uptime Robot**: Uptime monitoring
- **Cloudflare**: CDN and DDoS protection

### Backup Strategy

**What to backup**:

1. **Environment variables** (`.env`)
2. **App configuration** (if stored locally)
3. **SSL certificates** (automatic with certbot)
4. **Relay data** (if self-hosted)

**Relay backup** (if using Strfry):

```bash
# Backup relay database
sudo systemctl stop strfry
tar -czf strfry-backup-$(date +%Y%m%d).tar.gz /var/lib/strfry/
sudo systemctl start strfry

# Store backups off-site
rsync -avz strfry-backup-*.tar.gz backup-server:/backups/
```

---

## Rollback Procedures

### Quick Rollback

If deployment fails, rollback to previous version:

**Method 1: Git revert**

```bash
# Identify last working commit
git log --oneline

# Revert to that commit
git checkout <commit-hash>

# Rebuild
bun install --production
bun run build:production

# Restart
sudo systemctl restart plebeian-market
```

**Method 2: Deployment directory**

Keep previous deployment in separate directory:

```bash
# Before deploying
mv /home/deploy/market /home/deploy/market-backup

# After successful deployment
rm -rf /home/deploy/market-backup

# To rollback
sudo systemctl stop plebeian-market
mv /home/deploy/market /home/deploy/market-failed
mv /home/deploy/market-backup /home/deploy/market
sudo systemctl start plebeian-market
```

---

## Troubleshooting

### Application Won't Start

**Check logs**:

```bash
sudo journalctl -u plebeian-market -n 100
```

**Common issues**:

1. **Missing environment variables**:

   ```
   Error: Missing required environment variables
   ```

   Fix: Check `.env` file exists and has all required vars

2. **Relay connection failed**:

   ```
   Error: Failed to connect to relay
   ```

   Fix: Verify relay URL and relay is accessible

3. **Port already in use**:
   ```
   Error: EADDRINUSE: address already in use
   ```
   Fix: Kill process using port or change port

### High Memory Usage

**Check memory**:

```bash
free -h
top
```

**Solutions**:

1. Restart application
2. Check for memory leaks
3. Increase server RAM
4. Optimize queries and caching

### Slow Response Times

**Diagnose**:

```bash
# Check server load
uptime

# Check disk I/O
iostat

# Check network
netstat -s
```

**Solutions**:

1. Optimize database queries (relay)
2. Enable caching (nginx, CDN)
3. Upgrade server resources
4. Review slow endpoints

### WebSocket Connection Issues

**Symptoms**:

- Real-time updates not working
- Events not received

**Solutions**:

1. Check nginx WebSocket configuration
2. Verify relay connectivity
3. Check firewall rules
4. Review browser console for errors

---

## Security Best Practices

### Server Hardening

- [ ] Keep system updated: `sudo apt update && sudo apt upgrade`
- [ ] Configure firewall (UFW):
  ```bash
  sudo ufw allow ssh
  sudo ufw allow http
  sudo ufw allow https
  sudo ufw enable
  ```
- [ ] Disable root login:
  ```bash
  sudo nano /etc/ssh/sshd_config
  # Set: PermitRootLogin no
  sudo systemctl reload sshd
  ```
- [ ] Use SSH keys (disable password auth)
- [ ] Install fail2ban:
  ```bash
  sudo apt install fail2ban
  sudo systemctl enable fail2ban
  ```

### Application Security

- [ ] Use environment variables for secrets
- [ ] Rotate keys periodically
- [ ] Enable HTTPS only
- [ ] Set security headers (nginx)
- [ ] Regular security audits
- [ ] Monitor for vulnerabilities
- [ ] Keep dependencies updated

---

## Performance Optimization

### nginx Caching

```nginx
# Add to nginx config
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app_cache:10m max_size=1g inactive=60m;

location / {
    proxy_cache app_cache;
    proxy_cache_valid 200 10m;
    proxy_cache_bypass $http_upgrade;
    # ... other proxy settings
}
```

### Compression

```nginx
# Enable gzip
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss;
```

### CDN Integration

Use CDN for static assets:

- Cloudflare
- AWS CloudFront
- Bunny CDN

---

## Scaling Strategies

### Horizontal Scaling

**Load balancer** (nginx):

```nginx
upstream plebeian_market {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}
```

**Considerations**:

- Session management (stateless preferred)
- WebSocket sticky sessions
- Shared caching layer

### Vertical Scaling

Upgrade server resources:

- More CPU cores
- More RAM
- Faster SSD
- Better network

---

**For questions or issues, please open a GitHub issue or contact the team.**

---

**Last Updated**: 2025-11-20
**Maintained By**: Plebeian Market Team
