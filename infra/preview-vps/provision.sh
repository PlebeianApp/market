#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# provision.sh — Idempotent VPS provisioning for the nsite gateway
# and on-demand TLS ask endpoint.
#
# Requires these env vars (or arguments):
#   PREVIEW_VPS_HOST   — VPS hostname or IP
#   PREVIEW_VPS_USER   — SSH user (typically "debian")
#   PREVIEW_VPS_SSH_KEY — path to the SSH private key file
#
# Usage:
#   PREVIEW_VPS_HOST=1.2.3.4 PREVIEW_VPS_USER=debian \
#     PREVIEW_VPS_SSH_KEY=~/.ssh/id_ed25519 ./provision.sh
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_DIR="/home/${PREVIEW_VPS_USER:-debian}/preview-infra"
CADDYFILE="/etc/caddy/Caddyfile"

# ── Resolve env vars (use _VPS_USER to avoid shadowing $USER) ──
HOST="${PREVIEW_VPS_HOST:?PREVIEW_VPS_HOST is required}"
_VPS_USER="${PREVIEW_VPS_USER:?PREVIEW_VPS_USER is required}"
KEY="${PREVIEW_VPS_SSH_KEY:?PREVIEW_VPS_SSH_KEY is required}"

SSH_BASE=(ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
SCP_BASE=(scp -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

echo "==> Provisioning VPS ${_VPS_USER}@${HOST}"

# ── 1. Create remote directory ──
echo "==> Creating ${REMOTE_DIR}"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "mkdir -p ${REMOTE_DIR}"

# ── 2. Copy docker-compose.yml and ask-endpoint.ts ──
echo "==> Copying files to VPS"
"${SCP_BASE[@]}" \
  "${SCRIPT_DIR}/docker-compose.yml" \
  "${SCRIPT_DIR}/ask-endpoint.ts" \
  "${_VPS_USER}@${HOST}:${REMOTE_DIR}/"

# ── 3. Start / restart Docker services ──
echo "==> Starting Docker services (nsite gateway + ask endpoint)"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
cd ~/preview-infra
docker compose pull --quiet || true
docker compose up -d --remove-orphans
docker compose ps
REMOTE

# ── 4. Ensure Caddy has on_demand_tls global block ──
echo "==> Checking Caddy on_demand_tls global block"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
CADDYFILE="/etc/caddy/Caddyfile"

# Check if on_demand_tls ask block already exists
if ! grep -q 'on_demand_tls' "$CADDYFILE"; then
  echo "  Adding on_demand_tls global block to Caddyfile"
  # Create a temp file with the global block prepended
  TMP=$(mktemp)
  cat > "$TMP" <<'GLOBAL'
{
  on_demand_tls {
    ask http://localhost:6799/ask
  }
}

GLOBAL
  cat "$CADDYFILE" >> "$TMP"
  sudo mv "$TMP" "$CADDYFILE"
  echo "  Global block added"
else
  echo "  on_demand_tls block already present"
fi
REMOTE

# ── 5. Ensure Caddy has *.nsite.orangesync.tech site block ──
echo "==> Checking *.nsite.orangesync.tech site block"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
CADDYFILE="/etc/caddy/Caddyfile"

if ! grep -q 'nsite.orangesync.tech' "$CADDYFILE"; then
  echo "  Adding *.nsite.orangesync.tech site block"
  cat >> "$CADDYFILE" <<'SITE'

*.nsite.orangesync.tech {
  tls {
    on_demand
  }
  reverse_proxy localhost:6798
}
SITE
  echo "  Site block added"
else
  echo "  nsite.orangesync.tech route already present"
fi
REMOTE

# ── 6. Validate and reload Caddy ──
echo "==> Validating Caddy config"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "sudo caddy validate --config ${CADDYFILE} || true"

echo "==> Reloading Caddy"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "sudo systemctl reload caddy || sudo systemctl restart caddy"

echo "==> Done. VPS provisioned successfully."