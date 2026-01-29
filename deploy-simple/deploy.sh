#!/bin/bash
# =============================================================================
# Plebeian Market - Multi-Stage Deployment Script
# =============================================================================
#
# Deploys to development, staging, or production environments.
#
# Prerequisites (must be installed on VPS):
#   - Bun (runtime)
#   - PM2 (process manager)
#   - Caddy (reverse proxy)
#
# Usage:
#   ./deploy.sh <stage> [user@host[:port]]
#
# Examples:
#   ./deploy.sh development                    # Local Docker (localhost:2222)
#   ./deploy.sh staging user@staging.example.com
#   ./deploy.sh production user@prod.example.com
#   SSH_KEY=~/.ssh/id_rsa ./deploy.sh production user@prod.example.com
#
# Stages:
#   development - Local testing (port 3000, local relay)
#   staging     - Staging server (port 3000, staging relay)
#   production  - Production server (port 3001, production relay)
#
# Environment Files:
#   env/.env.development  - Development settings
#   env/.env.staging      - Staging settings  
#   env/.env.production   - Production settings
#
# =============================================================================

set -e

# -----------------------------------------------------------------------------
# Parse arguments
# -----------------------------------------------------------------------------
STAGE="${1:-development}"
TARGET="${2:-}"

# Validate stage
if [[ ! "$STAGE" =~ ^(development|staging|production)$ ]]; then
    echo "❌ Invalid stage: $STAGE"
    echo "   Valid stages: development, staging, production"
    exit 1
fi

# Parse target (user@host:port)
if [[ -n "$TARGET" ]]; then
    if [[ "$TARGET" == *"@"* ]]; then
        SSH_USER="${TARGET%@*}"
        HOST_PORT="${TARGET#*@}"
        if [[ "$HOST_PORT" == *":"* ]]; then
            SSH_HOST="${HOST_PORT%:*}"
            SSH_PORT="${HOST_PORT#*:}"
        else
            SSH_HOST="$HOST_PORT"
        fi
    else
        SSH_HOST="$TARGET"
    fi
fi

# -----------------------------------------------------------------------------
# Stage-specific defaults
# -----------------------------------------------------------------------------
case "$STAGE" in
    development)
        SSH_HOST="${SSH_HOST:-localhost}"
        SSH_PORT="${SSH_PORT:-2222}"
        SSH_USER="${SSH_USER:-deployer}"
        SSH_PASSWORD="${SSH_PASSWORD:-deployer}"
        APP_PORT="${APP_PORT:-3000}"
        PM2_APP_NAME="market-development"
        ;;
    staging)
        SSH_HOST="${SSH_HOST:-staging.plebeian.market}"
        SSH_PORT="${SSH_PORT:-22}"
        SSH_USER="${SSH_USER:-deployer}"
        APP_PORT="${APP_PORT:-3000}"
        PM2_APP_NAME="market-staging"
        ;;
    production)
        SSH_HOST="${SSH_HOST:-plebeian.market}"
        SSH_PORT="${SSH_PORT:-22}"
        SSH_USER="${SSH_USER:-deployer}"
        APP_PORT="${APP_PORT:-3001}"
        PM2_APP_NAME="market-production"
        ;;
esac

# -----------------------------------------------------------------------------
# Paths and configuration
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$SCRIPT_DIR/env/.env.$STAGE"
RELEASE_NAME="market-$STAGE-$(date +%Y%m%d-%H%M%S)"
REMOTE_BASE="/home/$SSH_USER"
REMOTE_APP_DIR="$REMOTE_BASE/market-$STAGE"

# Check for env file
if [[ ! -f "$ENV_FILE" ]]; then
    echo "❌ Environment file not found: $ENV_FILE"
    echo "   Copy from: $ENV_FILE.example"
    exit 1
fi

# -----------------------------------------------------------------------------
# SSH setup
# -----------------------------------------------------------------------------
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
if [[ -n "$SSH_KEY" ]]; then
    SSH_CMD="ssh $SSH_OPTS -i $SSH_KEY -p $SSH_PORT $SSH_USER@$SSH_HOST"
    SCP_CMD="scp $SSH_OPTS -i $SSH_KEY -P $SSH_PORT"
else
    if [[ -n "$SSH_PASSWORD" ]]; then
        if ! command -v sshpass &> /dev/null; then
            echo "❌ sshpass not installed. Install it or use SSH_KEY for key-based auth."
            exit 1
        fi
        SSH_CMD="sshpass -p $SSH_PASSWORD ssh $SSH_OPTS -p $SSH_PORT $SSH_USER@$SSH_HOST"
        SCP_CMD="sshpass -p $SSH_PASSWORD scp $SSH_OPTS -P $SSH_PORT"
    else
        SSH_CMD="ssh $SSH_OPTS -p $SSH_PORT $SSH_USER@$SSH_HOST"
        SCP_CMD="scp $SSH_OPTS -P $SSH_PORT"
    fi
fi

run_ssh() { $SSH_CMD "$@"; }
run_ssh_bun() { $SSH_CMD "export PATH=\"\$HOME/.bun/bin:\$PATH\" && $*"; }
run_scp() { $SCP_CMD -r "$@"; }

# =============================================================================
echo ""
STAGE_UPPER=$(echo "$STAGE" | tr '[:lower:]' '[:upper:]')
echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo "║              Plebeian Market Deployment - $STAGE_UPPER"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Stage:    $STAGE"
echo "  Target:   $SSH_USER@$SSH_HOST:$SSH_PORT"
echo "  Release:  $RELEASE_NAME"
echo "  App Port: $APP_PORT"
echo "  PM2 Name: $PM2_APP_NAME"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"

# -----------------------------------------------------------------------------
# Step 1: Build locally
# -----------------------------------------------------------------------------
echo ""
echo "📦 Building application..."
cd "$PROJECT_DIR"
bun install --frozen-lockfile 2>/dev/null || bun install
bun run generate-routes
bun run build
echo "   ✓ Build complete"

# -----------------------------------------------------------------------------
# Step 2: Prepare deployment package
# -----------------------------------------------------------------------------
echo ""
echo "📦 Preparing deployment package..."
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# dist/ - pre-built static files (served by Caddy)
cp -r "$PROJECT_DIR/dist" "$TEMP_DIR/"
# src/ - server code for API (run by Bun/PM2)
cp -r "$PROJECT_DIR/src" "$TEMP_DIR/"
# Dependencies
cp "$PROJECT_DIR/package.json" "$TEMP_DIR/"
cp "$PROJECT_DIR/bun.lock" "$TEMP_DIR/"
cp "$PROJECT_DIR/tsconfig.json" "$TEMP_DIR/"

# Generate stage-specific ecosystem config
cat > "$TEMP_DIR/ecosystem.config.cjs" << EOF
module.exports = {
  apps: [{
    name: '$PM2_APP_NAME',
    script: 'src/index.tsx',
    interpreter: process.env.HOME + '/.bun/bin/bun',
    cwd: '$REMOTE_APP_DIR',
    instances: 1,
    exec_mode: 'fork',
    env_file: '.env',
    error_file: '$REMOTE_BASE/logs/$PM2_APP_NAME-error.log',
    out_file: '$REMOTE_BASE/logs/$PM2_APP_NAME-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 5000,
    max_memory_restart: '500M',
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
  }],
};
EOF

echo "   ✓ Package ready"

# -----------------------------------------------------------------------------
# Step 3: Deploy to VPS
# -----------------------------------------------------------------------------
echo ""
echo "📦 Deploying to VPS..."
run_ssh "mkdir -p $REMOTE_BASE/releases/$RELEASE_NAME $REMOTE_BASE/logs"
run_scp "$TEMP_DIR/"* "$SSH_USER@$SSH_HOST:$REMOTE_BASE/releases/$RELEASE_NAME/"
echo "   ✓ Files uploaded"

# -----------------------------------------------------------------------------
# Step 4: Copy environment file
# -----------------------------------------------------------------------------
echo ""
echo "📦 Configuring environment..."
run_scp "$ENV_FILE" "$SSH_USER@$SSH_HOST:$REMOTE_BASE/releases/$RELEASE_NAME/.env"
echo "   ✓ Environment configured"

# -----------------------------------------------------------------------------
# Step 5: Install dependencies
# -----------------------------------------------------------------------------
echo ""
echo "📦 Installing dependencies..."
run_ssh_bun "cd $REMOTE_BASE/releases/$RELEASE_NAME && bun install --production"
echo "   ✓ Dependencies installed"

# -----------------------------------------------------------------------------
# Step 6: Swap releases (blue-green)
# -----------------------------------------------------------------------------
echo ""
echo "📦 Swapping releases..."
run_ssh "pm2 stop $PM2_APP_NAME 2>/dev/null || true"
run_ssh "ln -sfn $REMOTE_BASE/releases/$RELEASE_NAME $REMOTE_APP_DIR"
echo "   ✓ Release swapped"

# -----------------------------------------------------------------------------
# Step 7: Start/restart services
# -----------------------------------------------------------------------------
echo ""
echo "📦 Starting services..."

# Start ORLY relay if development and not running
if [[ "$STAGE" == "development" ]]; then
    run_ssh "if ! pgrep -x orly > /dev/null; then
        echo '   Starting ORLY relay...'
        ORLY_PORT=10547 nohup /usr/local/bin/orly > $REMOTE_BASE/logs/orly.log 2>&1 &
        sleep 2
    fi"
fi

# Start/reload app with PM2
run_ssh_bun "cd $REMOTE_APP_DIR && pm2 startOrReload ecosystem.config.cjs --only $PM2_APP_NAME"
run_ssh "pm2 save --force"
echo "   ✓ Services started"

# -----------------------------------------------------------------------------
# Step 8: Configure Caddy
# -----------------------------------------------------------------------------
echo ""
echo "📦 Configuring Caddy..."

# Use stage-specific Caddyfile if exists, otherwise generate one
CADDYFILE="$SCRIPT_DIR/caddyfiles/Caddyfile.$STAGE"
if [[ -f "$CADDYFILE" ]]; then
    echo "   Using $CADDYFILE"
    run_scp "$CADDYFILE" "$SSH_USER@$SSH_HOST:/tmp/Caddyfile"
else
    echo "   Generating Caddyfile for $STAGE"
    CADDY_TEMP=$(mktemp)
    cat > "$CADDY_TEMP" << EOF
# Plebeian Market - $STAGE
# Auto-generated by deploy.sh

:80 {
    root * $REMOTE_APP_DIR/dist
    
    @static {
        file
        path *.html *.css *.js *.json *.svg *.png *.jpg *.ico *.woff *.woff2 *.ttf *.map
    }
    handle @static {
        file_server
    }
    
    handle /api/* {
        reverse_proxy localhost:$APP_PORT
    }
    
    @websocket {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    handle @websocket {
        reverse_proxy localhost:$APP_PORT
    }
    
    handle {
        try_files {path} /index.html
        file_server
    }

    encode gzip zstd
    
    header /chunk-* Cache-Control "public, max-age=31536000, immutable"
    header /*.css Cache-Control "public, max-age=31536000, immutable"
    header /*.js Cache-Control "public, max-age=31536000, immutable"
    
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
    
    log {
        output file /var/log/caddy/access.log
        format json
    }
}
EOF
    run_scp "$CADDY_TEMP" "$SSH_USER@$SSH_HOST:/tmp/Caddyfile"
    rm "$CADDY_TEMP"
fi

run_ssh "sudo cp /tmp/Caddyfile /etc/caddy/Caddyfile && sudo mkdir -p /var/log/caddy"
run_ssh "sudo caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || sudo caddy start --config /etc/caddy/Caddyfile --adapter caddyfile"
echo "   ✓ Caddy configured"

# -----------------------------------------------------------------------------
# Step 9: Cleanup old releases (keep last 3)
# -----------------------------------------------------------------------------
echo ""
echo "📦 Cleaning up..."
run_ssh "cd $REMOTE_BASE/releases && ls -t | grep '^market-$STAGE' | tail -n +4 | xargs -r rm -rf"
echo "   ✓ Cleanup complete"

# -----------------------------------------------------------------------------
# Step 10: Health check
# -----------------------------------------------------------------------------
echo ""
echo "📦 Running health check..."
sleep 3
if run_ssh "curl -sf http://localhost:$APP_PORT/api/config > /dev/null"; then
    echo "   ✓ App is healthy"
else
    echo "   ⚠ Health check failed - check logs with: ./control.sh $STAGE logs"
fi

# -----------------------------------------------------------------------------
# Save connection settings for control.sh
# -----------------------------------------------------------------------------
cat > "$SCRIPT_DIR/.env.deploy.$STAGE" << EOF
STAGE=$STAGE
SSH_HOST=$SSH_HOST
SSH_PORT=$SSH_PORT
SSH_USER=$SSH_USER
${SSH_KEY:+SSH_KEY=$SSH_KEY}
${SSH_PASSWORD:+SSH_PASSWORD=$SSH_PASSWORD}
APP_PORT=$APP_PORT
PM2_APP_NAME=$PM2_APP_NAME
REMOTE_APP_DIR=$REMOTE_APP_DIR
EOF

# Also save as default if it's the most recent deployment
cp "$SCRIPT_DIR/.env.deploy.$STAGE" "$SCRIPT_DIR/.env.deploy"

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  ✅ Deployment complete! ($STAGE)"
echo ""
echo "  App:     http://$SSH_HOST (port 80 via Caddy)"
echo "  API:     http://$SSH_HOST:$APP_PORT"
echo ""
echo "  Commands:"
echo "    ./control.sh $STAGE status    - Show service status"
echo "    ./control.sh $STAGE logs      - View app logs"
echo "    ./control.sh $STAGE restart   - Restart app"
echo "    ./control.sh $STAGE ssh       - SSH into VPS"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
