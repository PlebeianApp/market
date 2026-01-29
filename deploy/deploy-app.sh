#!/bin/bash
# Deploy Plebeian Market to VPS
# This script deploys the market application using blue-green deployment
#
# Usage:
#   ./deploy-app.sh [SSH_HOST] [SSH_USER] [SSH_PASSWORD]
#
# Example:
#   ./deploy-app.sh localhost:2222 deployer deployer

set -e

# Configuration
SSH_HOST="${1:-${SSH_HOST:-localhost:2222}}"
SSH_USER="${2:-${SSH_USER:-deployer}}"
SSH_PASSWORD="${3:-${SSH_PASSWORD:-deployer}}"

# Parse host and port
if [[ "$SSH_HOST" == *":"* ]]; then
    HOST="${SSH_HOST%:*}"
    PORT="${SSH_HOST#*:}"
else
    HOST="$SSH_HOST"
    PORT="22"
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RELEASE_NAME="market-$(date +%Y%m%d-%H%M%S)"

echo "=============================================="
echo "🚀 Deploying Plebeian Market"
echo "=============================================="
echo "Host: $HOST:$PORT"
echo "User: $SSH_USER"
echo "Release: $RELEASE_NAME"
echo "Project: $PROJECT_DIR"
echo "=============================================="
echo ""

# SSH options to avoid host key issues and connection limits
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=60"

# Function to run commands via SSH with small delay to avoid rate limiting
run_ssh() {
    sleep 0.5
    sshpass -p "$SSH_PASSWORD" ssh $SSH_OPTS -p "$PORT" "$SSH_USER@$HOST" "$@"
}

# Function to run commands via SSH with Bun in PATH
run_ssh_bun() {
    sleep 0.5
    sshpass -p "$SSH_PASSWORD" ssh $SSH_OPTS -p "$PORT" "$SSH_USER@$HOST" "export PATH=\"\$HOME/.bun/bin:\$PATH\" && $@"
}

# Function to copy files via SCP
run_scp() {
    sleep 0.5
    sshpass -p "$SSH_PASSWORD" scp $SSH_OPTS -P "$PORT" -r "$@"
}

echo "📦 Step 1: Build Application"
echo "----------------------------"
cd "$PROJECT_DIR"
echo "Building in: $PROJECT_DIR"
bun install
bun run generate-routes
bun run build
echo "✅ Build complete"

echo ""
echo "📦 Step 2: Create Release Directory"
echo "------------------------------------"
run_ssh "mkdir -p /home/deployer/releases/$RELEASE_NAME"

echo ""
echo "📦 Step 3: Copy Files to VPS"
echo "----------------------------"
# Create a temporary directory with files to deploy
TEMP_DIR=$(mktemp -d)
cp -r "$PROJECT_DIR/dist" "$TEMP_DIR/"
cp -r "$PROJECT_DIR/public" "$TEMP_DIR/"
cp -r "$PROJECT_DIR/src" "$TEMP_DIR/"
cp -r "$PROJECT_DIR/styles" "$TEMP_DIR/"
cp "$PROJECT_DIR/package.json" "$TEMP_DIR/"
cp "$PROJECT_DIR/bun.lock" "$TEMP_DIR/"
cp "$PROJECT_DIR/tsconfig.json" "$TEMP_DIR/"
cp "$SCRIPT_DIR/ecosystem.config.cjs" "$TEMP_DIR/"

# Copy to VPS
run_scp "$TEMP_DIR/"* "$SSH_USER@$HOST:/home/deployer/releases/$RELEASE_NAME/"

# Cleanup temp dir
rm -rf "$TEMP_DIR"
echo "✅ Files copied"

echo ""
echo "📦 Step 4: Create Environment File"
echo "-----------------------------------"
run_ssh << EOF
cat > /home/deployer/releases/$RELEASE_NAME/.env << 'ENVFILE'
NODE_ENV=production
PORT=3000
APP_RELAY_URL=ws://localhost:10547
APP_PRIVATE_KEY=0000000000000000000000000000000000000000000000000000000000000001
ENVFILE
EOF
echo "✅ Environment file created"

echo ""
echo "📦 Step 5: Install Dependencies"
echo "--------------------------------"
run_ssh_bun "cd /home/deployer/releases/$RELEASE_NAME && bun install --production"
echo "✅ Dependencies installed"

echo ""
echo "📦 Step 6: Blue-Green Swap"
echo "--------------------------"
run_ssh "pm2 stop market-staging 2>/dev/null || true"

# Handle migration from directory to symlink
run_ssh "if [ -d /home/deployer/market ] && [ ! -L /home/deployer/market ]; then mv /home/deployer/market /home/deployer/market.old.\$(date +%Y%m%d-%H%M%S); fi"

# Update symlink
run_ssh "ln -sfn /home/deployer/releases/$RELEASE_NAME /home/deployer/market"
echo "✅ Symlink updated"

echo ""
echo "📦 Step 7: Start Application with PM2"
echo "--------------------------------------"
# Start or reload app with Bun in PATH
run_ssh_bun "cd /home/deployer/market && if pm2 describe market-staging > /dev/null 2>&1; then pm2 reload market-staging; else pm2 start ecosystem.config.cjs --only market-staging; fi"
run_ssh "pm2 save --force"
run_ssh "pm2 ls"

echo ""
echo "📦 Step 8: Configure Caddy"
echo "--------------------------"
# Copy Caddyfile if exists
run_ssh "if [ -f /home/deployer/deploy/Caddyfile ]; then sudo cp /home/deployer/deploy/Caddyfile /etc/caddy/Caddyfile; fi"

# Start Caddy (use nohup to properly background in Docker, systemctl in production)
run_ssh "sudo pkill caddy 2>/dev/null || true"
run_ssh "nohup sudo caddy start --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 &"
sleep 2
echo "✅ Caddy configured"

echo ""
echo "📦 Step 9: Cleanup Old Releases"
echo "--------------------------------"
run_ssh "cd /home/deployer/releases && ls -t | tail -n +4 | xargs -r rm -rf && echo 'Remaining releases:' && ls -1"

echo ""
echo "📦 Step 10: Health Check"
echo "------------------------"
sleep 5
echo "Checking http://localhost:3000/api/config..."
if run_ssh "curl -sf http://localhost:3000/api/config > /dev/null"; then
    echo "✅ Health check passed!"
else
    echo "⚠️  Health check failed - app may still be starting"
    echo "Check logs with: ./deploy-app.sh logs"
fi

echo ""
echo "=============================================="
echo "✅ Deployment Complete!"
echo "=============================================="
echo ""
echo "Access your services:"
echo "  • App: http://localhost (or http://localhost:3000)"
echo "  • PM2 Metrics: http://localhost:9209/metrics"
echo ""
echo "Note: The app needs a Nostr relay at ws://localhost:10547"
echo "      Run 'nak serve' locally to start a test relay."
echo ""
echo "Useful commands:"
echo "  • View logs: ./pm2-control.sh logs"
echo "  • Restart: ./pm2-control.sh restart"
echo "  • SSH in: ssh -p $PORT $SSH_USER@$HOST"
echo ""
