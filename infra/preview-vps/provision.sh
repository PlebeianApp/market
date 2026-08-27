#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# provision.sh — Idempotent VPS provisioning for the nsite gateway,
# on-demand TLS ask endpoint, and the preview lazy-start manager.
#
# Checks existing state and only creates/changes what's missing.
# Safe to run on every CI run — no-ops if everything is already up.
#
# Requires these env vars:
#   PREVIEW_VPS_HOST    — VPS hostname or IP
#   PREVIEW_VPS_USER    — SSH user (typically "debian")
#   PREVIEW_VPS_SSH_KEY — path to the SSH private key file
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Trim whitespace from env vars (GitHub secrets often have trailing newlines) ──
HOST="$(echo -n "${PREVIEW_VPS_HOST:?PREVIEW_VPS_HOST is required}" | tr -d '[:space:]')"
_VPS_USER="$(echo -n "${PREVIEW_VPS_USER:?PREVIEW_VPS_USER is required}" | tr -d '[:space:]')"
KEY="$(echo -n "${PREVIEW_VPS_SSH_KEY:?PREVIEW_VPS_SSH_KEY is required}" | tr -d '[:space:]')"

SSH_BASE=(ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
SCP_BASE=(scp -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

echo "==> Provisioning VPS ${_VPS_USER}@${HOST}"

# ── 0. Install base tooling (Docker + Caddy) if missing ──
# The target VPS may be a bare Debian box with neither Docker nor Caddy
# installed. This step is idempotent: it only installs what's missing and
# never touches an existing install. Docker is needed for the per-PR
# compose services and the nsite gateway; Caddy is the on-demand TLS
# reverse proxy that serves the pr{N}.test-market.orangesync.tech
# subdomains.
echo "==> Ensuring Docker + Caddy are installed"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail

# --- Docker ---
if ! command -v docker >/dev/null 2>&1; then
  echo "  Installing Docker (docker.io)"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker.io
  sudo systemctl enable --now docker
  # Allow the deploy user to run docker without sudo.
  sudo usermod -aG docker "${USER}"
  echo "  Docker installed"
else
  echo "  Docker already installed"
fi

# --- Caddy ---
if ! command -v caddy >/dev/null 2>&1; then
  echo "  Installing Caddy (official Debian repo)"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
  echo "  Caddy installed"
else
  echo "  Caddy already installed"
fi

# --- Docker log rotation (optional but recommended on a shared VPS) ---
if [ ! -f /etc/docker/daemon.json ]; then
  echo "  Configuring Docker log rotation"
  sudo mkdir -p /etc/docker
  sudo tee /etc/docker/daemon.json > /dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
  sudo systemctl restart docker
  echo "  Docker log rotation configured"
fi
REMOTE

# ── 1. Create remote directory ──
echo "==> Creating /home/${_VPS_USER}/preview-infra"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "mkdir -p ~/preview-infra"

# ── 2. Copy preview_manager.py to VPS ──
echo "==> Copying preview_manager.py to VPS"
"${SCP_BASE[@]}" \
  "${SCRIPT_DIR}/preview_manager.py" \
  "${_VPS_USER}@${HOST}:~/preview-infra/"

# ── 3. Ensure nsite-gateway Docker container is running ──
# Uses locally-built image nsite-gateway-nsite:latest (built from
# the nsite-gateway Dockerfile in the tollgate infra). If the image
# doesn't exist, clone and build it. If container is already running,
# skip entirely.
echo "==> Checking nsite-gateway container"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail

# Check if container is already running
if docker ps --filter name=tollgate-nsite-gateway --format '{{.Names}}' | grep -q tollgate-nsite-gateway; then
  echo "  tollgate-nsite-gateway already running — skipping"
  docker ps --filter name=tollgate-nsite-gateway --format '  {{.Names}} {{.Status}} {{.Ports}}'
  exit 0
fi

# Check if image exists locally
if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q 'nsite-gateway-nsite:latest'; then
  echo "  Image not found — building from source"
  cd /tmp
  if [ -d nsite-gateway ]; then
    cd nsite-gateway && git pull --quiet
  else
    git clone --quiet https://github.com/fiatjaf/nsite.git nsite-gateway
    cd nsite-gateway
  fi
  docker build -t nsite-gateway-nsite:latest .
  echo "  Image built"
fi

# Start container (idempotent — remove stale container first)
docker rm -f tollgate-nsite-gateway 2>/dev/null || true
docker run -d \
  --name tollgate-nsite-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:3002:3000 \
  -e PUBLIC_DOMAIN=nsite.orangesync.tech \
  -e MAX_FILE_SIZE="128 MB" \
  -e NSITE_PORT=3000 \
  -e NSITE_HOST=0.0.0.0 \
  -e LOOKUP_RELAYS=wss://user.kindpag.es,wss://purplepag.es \
  -e "NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol,wss://relay.ngit.dev,wss://relay.orangesync.tech" \
  -e BLOSSOM_SERVERS=https://blossom2.orangesync.tech \
  nsite-gateway-nsite:latest

echo "  Container started"
docker ps --filter name=tollgate-nsite-gateway --format '  {{.Names}} {{.Status}} {{.Ports}}'
REMOTE

# ── 4. Ensure TLS ask endpoint + preview lazy-start manager ──
# The ask endpoint is a Python HTTP server run as a systemd service. It
# returns 200 for *.nsite.orangesync.tech and *.test-market.orangesync.tech,
# 403 otherwise. It doubles as a wake hook for the preview-manager: when it
# approves a preview subdomain it calls the manager to `docker compose start`
# that preview. The manager itself is installed below as its own systemd
# timer-driven service.
echo "==> Checking TLS ask endpoint + preview-manager"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail

# Write the ask endpoint script (inlined — no separate ask-endpoint.ts file).
cat > ~/preview-infra/ask-endpoint.py <<'PYTHON'
#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse
import subprocess
import os

MANAGER = os.path.expanduser("~/preview-infra/preview_manager.py")
BASE_DOMAIN = "test-market.orangesync.tech"

class AskHandler(BaseHTTPRequestHandler):
    def _handle(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/ask":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        domain = params.get("domain", [""])[0]
        allowed_suffixes = (
            ".nsite.orangesync.tech",
            ".test-market.orangesync.tech",
        )
        approved = any(domain.endswith(s) for s in allowed_suffixes)
        if approved:
            # Wake hook: a preview subdomain is being requested, so someone is
            # about to visit it. Ask the manager to wake a stopped preview so
            # it is warm. Never block TLS issuance on compose start.
            if domain.endswith("." + BASE_DOMAIN):
                try:
                    subprocess.Popen(
                        ["/usr/bin/python3", MANAGER, "--wake", domain],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                except OSError:
                    pass
            self.send_response(200)
        else:
            self.send_response(403)
        self.end_headers()

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def log_message(self, *args):
        pass  # silent

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 6799), AskHandler).serve_forever()
PYTHON

# Create systemd service if it doesn't exist
if [ ! -f /etc/systemd/system/tls-ask.service ]; then
  sudo tee /etc/systemd/system/tls-ask.service > /dev/null <<UNIT
[Unit]
Description=TLS Ask endpoint for Caddy on-demand TLS + preview wake hook
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/${USER}/preview-infra/ask-endpoint.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable tls-ask
fi
sudo systemctl restart tls-ask
echo "  tls-ask service started"

# Install preview-manager as a systemd timer service that runs a cycle
# periodically (e.g. every 10 minutes) to stop idle previews and apply
# recency-based cleanup.
if [ ! -f /etc/systemd/system/preview-manager.service ]; then
  sudo tee /etc/systemd/system/preview-manager.service > /dev/null <<UNIT
[Unit]
Description=Preview lazy-start manager (idle stop + recency cleanup)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/${USER}/preview-infra/preview_manager.py --cron --preview-root /home/${USER}/previews
Environment=GITHUB_REPO=PlebeianApp/market
Environment=GITHUB_TOKEN=
Environment=CLOUDFLARE_ZONE_ID=
Environment=CLOUDFLARE_API_TOKEN=
UNIT
  sudo tee /etc/systemd/system/preview-manager.timer > /dev/null <<UNIT
[Unit]
Description=Run preview-manager cycle periodically

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now preview-manager.timer
fi
echo "  preview-manager.timer active"
REMOTE

# ── 5. Ensure Caddy has on_demand_tls global block ──
echo "==> Checking Caddy on_demand_tls global block"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
CADDYFILE="/etc/caddy/Caddyfile"

if ! sudo grep -q 'on_demand_tls' "$CADDYFILE" 2>/dev/null; then
  echo "  Adding on_demand_tls global block to Caddyfile"
  TMP=$(mktemp)
  cat > "$TMP" <<'GLOBAL'
{
  on_demand_tls {
    ask http://localhost:6799/ask
  }
}

GLOBAL
  sudo cat "$CADDYFILE" >> "$TMP"
  sudo mv "$TMP" "$CADDYFILE"
  echo "  Global block added"
else
  echo "  on_demand_tls block already present"
fi
REMOTE

# ── 6. Ensure Caddy has *.nsite.orangesync.tech site block ──
echo "==> Checking *.nsite.orangesync.tech site block"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
CADDYFILE="/etc/caddy/Caddyfile"

if ! sudo grep -q 'nsite.orangesync.tech' "$CADDYFILE" 2>/dev/null; then
  echo "  Adding *.nsite.orangesync.tech site block"
  sudo tee -a "$CADDYFILE" > /dev/null <<'SITE'

*.nsite.orangesync.tech {
  tls {
    on_demand
  }
  reverse_proxy localhost:3002
}
SITE
  echo "  Site block added"
else
  echo "  nsite.orangesync.tech route already present"
fi
REMOTE

# ── 7. Validate and reload Caddy ──
echo "==> Validating Caddy config"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "sudo caddy validate --config /etc/caddy/Caddyfile 2>&1 || true"

echo "==> Reloading Caddy"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy"

echo "==> Done. VPS provisioned successfully."
