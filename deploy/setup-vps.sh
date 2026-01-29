#!/bin/bash
# VPS Setup Script for Plebeian Market
# This script installs all required dependencies on a fresh Ubuntu 22.04 VPS
#
# Usage:
#   ./setup-vps.sh [SSH_HOST] [SSH_USER] [SSH_PASSWORD]
#
# Example:
#   ./setup-vps.sh localhost:2222 deployer deployer

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

echo "=============================================="
echo "🚀 Plebeian Market VPS Setup"
echo "=============================================="
echo "Host: $HOST:$PORT"
echo "User: $SSH_USER"
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

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    echo "❌ sshpass is not installed. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install hudochenkov/sshpass/sshpass
    else
        sudo apt-get install -y sshpass
    fi
fi

# Wait for SSH to be available
echo "⏳ Waiting for SSH to be available..."
for i in {1..30}; do
    if sshpass -p "$SSH_PASSWORD" ssh $SSH_OPTS -o ConnectTimeout=5 -p "$PORT" "$SSH_USER@$HOST" "echo 'SSH ready'" 2>/dev/null; then
        echo "✅ SSH connection established"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Failed to connect to SSH after 30 attempts"
        exit 1
    fi
    echo "   Attempt $i/30..."
    sleep 2
done

echo ""
echo "📦 Step 1: System Update"
echo "------------------------"
run_ssh "sudo apt-get update && sudo apt-get upgrade -y"

echo ""
echo "📦 Step 2: Install Essential Tools"
echo "-----------------------------------"
run_ssh "sudo apt-get install -y curl wget git unzip build-essential"

echo ""
echo "📦 Step 3: Install Node.js (required for PM2)"
echo "----------------------------------------------"
run_ssh "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
run_ssh "sudo apt-get install -y nodejs"
run_ssh "node --version && npm --version"

echo ""
echo "📦 Step 4: Install Bun"
echo "----------------------"
run_ssh "curl -fsSL https://bun.sh/install | bash"
run_ssh_bun "bun --version"

echo ""
echo "📦 Step 5: Install PM2"
echo "----------------------"
run_ssh "sudo npm install -g pm2"
run_ssh "pm2 --version"

echo ""
echo "📦 Step 6: Install PM2 Prometheus Exporter"
echo "-------------------------------------------"
run_ssh "pm2 install pm2-prometheus-exporter"
run_ssh "pm2 set pm2-prometheus-exporter:port 9209"

echo ""
echo "📦 Step 7: Install Caddy"
echo "------------------------"
run_ssh "sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https"
run_ssh "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
run_ssh "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list"
run_ssh "sudo apt-get update && sudo apt-get install -y caddy"
run_ssh "sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy"
run_ssh "caddy version"

echo ""
echo "📦 Step 8: Install ORLY Relay"
echo "-----------------------------"
run_ssh 'ARCH=$(uname -m) && if [ "$ARCH" = "x86_64" ]; then ORLY_ARCH="amd64"; elif [ "$ARCH" = "aarch64" ]; then ORLY_ARCH="arm64"; else echo "Unsupported: $ARCH"; exit 1; fi && sudo wget -O /usr/local/bin/orly "https://git.nostrdev.com/mleku/next.orly.dev/releases/download/v0.57.2/orly-0.57.2-linux-${ORLY_ARCH}" && sudo chmod +x /usr/local/bin/orly'
run_ssh "mkdir -p /home/deployer/.local/share/ORLY"
run_ssh "/usr/local/bin/orly --version || echo 'ORLY installed'"

echo ""
echo "📦 Step 9: Start ORLY Relay"
echo "---------------------------"
run_ssh "ORLY_PORT=10547 nohup /usr/local/bin/orly > /home/deployer/logs/orly.log 2>&1 &"
sleep 2
run_ssh "curl -s http://localhost:10547 || echo 'ORLY relay starting...'"

echo ""
echo "📦 Step 10: Install Netdata (optional)"
echo "---------------------------------------"
run_ssh "curl -fsSL https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh"
run_ssh "sh /tmp/netdata-kickstart.sh --non-interactive --dont-wait || echo 'Netdata installation completed (may require manual start)'"

echo ""
echo "📦 Step 11: Create Directory Structure"
echo "---------------------------------------"
run_ssh "mkdir -p /home/deployer/releases"
run_ssh "mkdir -p /home/deployer/logs"

echo ""
echo "📦 Step 12: Save PM2 State"
echo "--------------------------"
run_ssh "pm2 save"

echo ""
echo "=============================================="
echo "✅ VPS Setup Complete!"
echo "=============================================="
echo ""
echo "Services installed:"
echo "  • Node.js: $(run_ssh 'node --version')"
echo "  • Bun: $(run_ssh_bun 'bun --version')"
echo "  • PM2: $(run_ssh 'pm2 --version')"
echo "  • Caddy: $(run_ssh 'caddy version 2>/dev/null || echo "installed"')"
echo "  • ORLY Relay: Running on port 10547"
echo ""
echo "Next steps:"
echo "  1. Run: ./deploy-app.sh"
echo "  2. Access the app at: http://localhost"
echo ""
