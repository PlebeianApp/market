#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# provision.sh — Idempotent VPS provisioning for the nsite gateway
# and on-demand TLS ask endpoint.
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

# ── Trim whitespace from HOST and USER (GitHub secrets often have trailing
#    newlines). Do NOT trim KEY — spaces within PEM keys are not valid but
#    the key body has newlines that must be preserved. ──
HOST="$(echo -n "${PREVIEW_VPS_HOST:?PREVIEW_VPS_HOST is required}" | tr -d '[:space:]')"
_VPS_USER="$(echo -n "${PREVIEW_VPS_USER:?PREVIEW_VPS_USER is required}" | tr -d '[:space:]')"
KEY="${PREVIEW_VPS_SSH_KEY:?PREVIEW_VPS_SSH_KEY is required}"

SSH_BASE=(ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
SCP_BASE=(scp -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

echo "==> Provisioning VPS ${_VPS_USER}@${HOST}"

# ── 1. Create remote directory ──
echo "==> Creating /home/${_VPS_USER}/preview-infra"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "mkdir -p ~/preview-infra"

# ── 2. Copy ask-endpoint.ts to VPS ──
echo "==> Copying files to VPS"
"${SCP_BASE[@]}" \
  "${SCRIPT_DIR}/ask-endpoint.ts" \
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

# ── 4. Ensure TLS ask endpoint is running ──
# Uses a simple Python HTTP server as a systemd service.
# Returns 200 for *.nsite.orangesync.tech, 403 otherwise.
echo "==> Checking TLS ask endpoint"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail

# Check if systemd service already exists and is running
if systemctl is-active --quiet tls-ask 2>/dev/null; then
  echo "  tls-ask service already running — skipping"
  exit 0
fi

# Write the ask endpoint script
cat > ~/tls-ask.py <<'PYTHON'
#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

class AskHandler(BaseHTTPRequestHandler):
    def do_GET(self):
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
        if any(domain.endswith(s) for s in allowed_suffixes):
            self.send_response(200)
        else:
            self.send_response(403)
        self.end_headers()

    def do_POST(self):
        self.do_GET()

    def log_message(self, *args):
        pass  # silent

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 6799), AskHandler).serve_forever()
PYTHON

# Create systemd service if it doesn't exist
if [ ! -f /etc/systemd/system/tls-ask.service ]; then
  sudo tee /etc/systemd/system/tls-ask.service > /dev/null <<UNIT
[Unit]
Description=TLS Ask endpoint for Caddy on-demand TLS
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/${USER}/tls-ask.py
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