#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# provision.sh — Idempotent VPS provisioning for the preview gateway
# (on-demand-TLS ask endpoint + subdomain router), the Caddy routing +
# JSON access log, and the preview lazy-start manager.
#
# Checks existing state and only creates/changes what's missing or whose
# content changed (sha256-compared — services are restarted only then, so
# re-running from CI never bounces the gateway).
#
# Requires these env vars:
#   PREVIEW_VPS_HOST             — VPS hostname or IP (SSH port 22)
#   PREVIEW_VPS_USER             — SSH user (typically "debian")
#   PREVIEW_VPS_SSH_KEY          — path to the SSH private key file
#   PREVIEW_VPS_HOST_FINGERPRINT — VPS SSH *host* key SHA256 fingerprint
#                                  (format: `SHA256:...`, exactly as printed
#                                  by `ssh-keyscan -t ed25519 <host> |
#                                  ssh-keygen -lf -`; the SAME secret the
#                                  appleboy actions verify via their
#                                  `fingerprint:` input). The connection is
#                                  pinned to it — no TOFU, no
#                                  StrictHostKeyChecking=no.
#   PREVIEW_CLOUDFLARE_API_TOKEN — Cloudflare token (DNS edit on the zone);
#                                  shipped to the VPS as manager.env so the
#                                  manager can delete preview DNS records.
#   PREVIEW_CLOUDFLARE_ZONE_ID   — Cloudflare zone id for test-market…
#                                  (same purpose).
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Trim whitespace from env vars (GitHub secrets often have trailing newlines) ──
HOST="$(echo -n "${PREVIEW_VPS_HOST:?PREVIEW_VPS_HOST is required}" | tr -d '[:space:]')"
_VPS_USER="$(echo -n "${PREVIEW_VPS_USER:?PREVIEW_VPS_USER is required}" | tr -d '[:space:]')"
KEY="$(echo -n "${PREVIEW_VPS_SSH_KEY:?PREVIEW_VPS_SSH_KEY is required}" | tr -d '[:space:]')"
FINGERPRINT="$(echo -n "${PREVIEW_VPS_HOST_FINGERPRINT:?PREVIEW_VPS_HOST_FINGERPRINT is required}" | tr -d '[:space:]')"
CF_TOKEN="${PREVIEW_CLOUDFLARE_API_TOKEN:?PREVIEW_CLOUDFLARE_API_TOKEN is required}"
CF_ZONE="$(echo -n "${PREVIEW_CLOUDFLARE_ZONE_ID:?PREVIEW_CLOUDFLARE_ZONE_ID is required}" | tr -d '[:space:]')"

# ── Pinned host-key verification (no MITM window, no TOFU) ──────────────
# Scan the host key, compare its SHA256 fingerprint against the pinned
# secret, and abort BEFORE any private-key material is exchanged: a
# mismatch means impostor and the deploy key is never handed over. The
# pinned line is then written to a private known_hosts and ssh runs with
# StrictHostKeyChecking=yes against it. HostKeyAlgorithms pins the
# negotiation to the verified ed25519 key, so an impostor cannot offer a
# different key type that was never pinned.
echo "==> Verifying VPS host key fingerprint for ${HOST}"
HOSTKEY_LINE="$(ssh-keyscan -T 10 -t ed25519 "${HOST}" 2>/dev/null | head -n 1)"
if [ -z "${HOSTKEY_LINE}" ]; then
  echo "FATAL: ssh-keyscan could not reach ${HOST} to fetch its host key" >&2
  exit 1
fi
ACTUAL_FP="$(printf '%s\n' "${HOSTKEY_LINE}" | ssh-keygen -lf - | awk '{print $2}')"
if [ "${ACTUAL_FP}" != "${FINGERPRINT}" ]; then
  echo "FATAL: host key fingerprint mismatch for ${HOST}" >&2
  echo "  pinned: ${FINGERPRINT}" >&2
  echo "  actual: ${ACTUAL_FP}" >&2
  echo "  Refusing to hand the deploy key to an unverified host." >&2
  exit 1
fi
echo "  Host key fingerprint verified (${FINGERPRINT})"

KNOWN_HOSTS="$(mktemp)"
printf '%s\n' "${HOSTKEY_LINE}" > "${KNOWN_HOSTS}"
chmod 600 "${KNOWN_HOSTS}"
trap 'rm -f "${KNOWN_HOSTS}"' EXIT

SSH_BASE=(ssh -i "${KEY}" -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${KNOWN_HOSTS}" -o HostKeyAlgorithms=ssh-ed25519 -o LogLevel=ERROR)
SCP_BASE=(scp -i "${KEY}" -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${KNOWN_HOSTS}" -o HostKeyAlgorithms=ssh-ed25519 -o LogLevel=ERROR)

echo "==> Provisioning VPS ${_VPS_USER}@${HOST} (host key pinned)"

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

# ── 1. Create remote directories ──
echo "==> Creating /home/${_VPS_USER}/preview-infra and /home/${_VPS_USER}/previews"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "mkdir -p /home/${_VPS_USER}/preview-infra /home/${_VPS_USER}/previews"

# ── 2. Copy manager + gateway to the VPS ──
# Record the pre-copy sha256 of the installed files so we can decide
# whether the gateway service must be restarted (m7: restart only when
# content actually changed — never unconditionally).
NEW_MANAGER_SHA="$(sha256sum "${SCRIPT_DIR}/preview_manager.py" | cut -d' ' -f1)"
NEW_GATEWAY_SHA="$(sha256sum "${SCRIPT_DIR}/preview_gateway.py" | cut -d' ' -f1)"
OLD_GATEWAY_SHA="$("${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "sha256sum /home/${_VPS_USER}/preview-infra/preview_gateway.py 2>/dev/null | cut -d' ' -f1" || true)"

echo "==> Copying preview_manager.py + preview_gateway.py to VPS"
"${SCP_BASE[@]}" \
  "${SCRIPT_DIR}/preview_manager.py" \
  "${SCRIPT_DIR}/preview_gateway.py" \
  "${_VPS_USER}@${HOST}:/home/${_VPS_USER}/preview-infra/"

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

# ── 4. Ship manager.env (Cloudflare credentials for DNS cleanup) ─────────
# Written remotely with umask 077 via stdin, so the token never appears in
# a process argv or a local file. The manager's systemd unit loads it via
# EnvironmentFile= and uses it ONLY for deleting preview A records.
# Key names match what preview_manager.py reads: CLOUDFLARE_API_TOKEN /
# CLOUDFLARE_ZONE_ID (the CI-side secrets are PREVIEW_CLOUDFLARE_*; the
# mapping happens here — do NOT rename one side without the other).
echo "==> Writing manager.env (Cloudflare credentials, chmod 600)"
printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ZONE_ID=%s\n' \
  "${CF_TOKEN}" "${CF_ZONE}" \
  | "${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" \
    'umask 077; mkdir -p /home/'"${_VPS_USER}"'/preview-infra && cat > /home/'"${_VPS_USER}"'/preview-infra/manager.env && chmod 600 /home/'"${_VPS_USER}"'/preview-infra/manager.env && echo "  manager.env written (600)"'

# ── 5. Preview gateway service (TLS ask + HTTP router) ───────────────────
# preview_gateway.py is version-controlled and shipped with the deploy
# package (step 2) — no inlined heredoc script. The service runs as the
# provisioned user (NOT root) with explicit absolute paths and HOME set,
# so ~/ never expands to /root. It listens on 127.0.0.1:6799 and Caddy
# fronts it for:
#   - on_demand_tls ask approvals (/ask?domain=…)
#   - *.test-market.orangesync.tech routing (Host pr{N} → 127.0.0.1:3000+(N%100)*10)
# m7: the service is restarted only on FIRST install, when the shipped
# gateway file content changed, or when the unit file content changed.
echo "==> Installing preview-gateway service"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "NEW_GATEWAY_SHA=${NEW_GATEWAY_SHA} OLD_GATEWAY_SHA=${OLD_GATEWAY_SHA} bash -s" <<'REMOTE'
set -euo pipefail

# Migrate away from the old root-run tls-ask service if this box was
# provisioned by an earlier version of this script.
if systemctl list-unit-files --type=service 2>/dev/null | grep -q '^tls-ask'; then
  echo "  Removing legacy tls-ask service (superseded by preview-gateway)"
  sudo systemctl stop tls-ask 2>/dev/null || true
  sudo systemctl disable tls-ask 2>/dev/null || true
  sudo rm -f /etc/systemd/system/tls-ask.service
  sudo systemctl daemon-reload
fi

RESTART=0
if [ ! -f /etc/systemd/system/preview-gateway.service ]; then
  RESTART=1
fi
if [ "${OLD_GATEWAY_SHA}" != "${NEW_GATEWAY_SHA}" ]; then
  RESTART=1
fi

TMP_UNIT="$(mktemp)"
cat > "${TMP_UNIT}" <<UNIT
[Unit]
Description=Preview gateway (on-demand TLS ask endpoint + preview subdomain router)
After=network.target

[Service]
Type=simple
User=${USER}
Environment=HOME=/home/${USER}
ExecStart=/usr/bin/python3 /home/${USER}/preview-infra/preview_gateway.py --listen-port 6799 --manager-path /home/${USER}/preview-infra/preview_manager.py --python-bin /usr/bin/python3
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

if [ ! -f /etc/systemd/system/preview-gateway.service ] \
  || ! diff -q "${TMP_UNIT}" /etc/systemd/system/preview-gateway.service > /dev/null; then
  sudo cp "${TMP_UNIT}" /etc/systemd/system/preview-gateway.service
  sudo systemctl daemon-reload
  sudo systemctl enable preview-gateway
  RESTART=1
fi
rm -f "${TMP_UNIT}"

if [ "${RESTART}" = "1" ]; then
  sudo systemctl restart preview-gateway
  echo "  preview-gateway service (re)started (first install or content changed)"
else
  echo "  preview-gateway unchanged — left running"
fi
systemctl is-active preview-gateway
REMOTE

# ── 6. Preview manager systemd unit + timer ───────────────────────────────
# The timer owns the preview lifecycle (idle stop, recency ranking,
# closed-PR cleanup). CI never runs the manager itself — see
# preview-deploy.yml. The unit:
#   - passes --access-log so idle detection reads the Caddy access log
#     (missing log data ⇒ previews are treated as unknown-access and NOT
#     stopped — fail-safe);
#   - loads Cloudflare credentials from manager.env via EnvironmentFile=
#     so closed-PR teardown can delete DNS records;
#   - queries GitHub anonymously (public repo; no GITHUB_TOKEN — an empty
#     token previously made every cycle look like "all PRs closed").
# Content-compared before rewriting (m7-style) so re-provisioning is a
# no-op when nothing changed.
echo "==> Installing preview-manager unit + timer"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail

TMP_UNIT="$(mktemp)"
cat > "${TMP_UNIT}" <<UNIT
[Unit]
Description=Preview lazy-start manager (idle stop + recency cleanup)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/${USER}/preview-infra/preview_manager.py --cron --preview-root /home/${USER}/previews --access-log /var/log/caddy/access.json
Environment=GITHUB_REPO=PlebeianApp/market
EnvironmentFile=/home/${USER}/preview-infra/manager.env
UNIT

TMP_TIMER="$(mktemp)"
cat > "${TMP_TIMER}" <<UNIT
[Unit]
Description=Run preview-manager cycle periodically

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
UNIT

CHANGED=0
if [ ! -f /etc/systemd/system/preview-manager.service ] \
  || ! diff -q "${TMP_UNIT}" /etc/systemd/system/preview-manager.service > /dev/null; then
  sudo cp "${TMP_UNIT}" /etc/systemd/system/preview-manager.service
  CHANGED=1
fi
if [ ! -f /etc/systemd/system/preview-manager.timer ] \
  || ! diff -q "${TMP_TIMER}" /etc/systemd/system/preview-manager.timer > /dev/null; then
  sudo cp "${TMP_TIMER}" /etc/systemd/system/preview-manager.timer
  CHANGED=1
fi
rm -f "${TMP_UNIT}" "${TMP_TIMER}"

if [ "${CHANGED}" = "1" ]; then
  sudo systemctl daemon-reload
  sudo systemctl enable --now preview-manager.timer
  echo "  preview-manager unit/timer installed or updated"
else
  echo "  preview-manager unit/timer unchanged"
fi
systemctl is-enabled preview-manager.timer
REMOTE

# ── 7. Caddy JSON access log (idle detection data) ───────────────────────
# The manager reads /var/log/caddy/access.json to decide idle-ness.
# Owned by caddy, but readable (0644/0755) by the manager user so a
# non-root systemd unit can parse it. Roll keeps the disk bounded.
echo "==> Ensuring Caddy access log directory + readable file"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy
sudo chmod 0755 /var/log/caddy
# Pre-create the log file with world-readable perms; Caddy appends to it
# and rotation preserves the mode.
if [ ! -f /var/log/caddy/access.json ]; then
  sudo touch /var/log/caddy/access.json
fi
sudo chown caddy:caddy /var/log/caddy/access.json
sudo chmod 0644 /var/log/caddy/access.json
echo "  /var/log/caddy/access.json ready (0644, caddy:caddy)"
REMOTE

# ── 8. Ensure Caddy has on_demand_tls global block ────────────────────────
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

# ── 9. Ensure Caddy has *.nsite.orangesync.tech site block ───────────────
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

# ── 10. Ensure Caddy has the *.test-market.orangesync.tech route ─────────
# This is the block that actually routes preview traffic (M1): on-demand
# TLS (ask → preview-gateway) plus reverse_proxy to the gateway's HTTP
# router, which maps Host pr{N} → 127.0.0.1:3000+(N%100)*10 and wakes
# stopped previews on every request. The JSON access log feeds the
# manager's idle detection.
echo "==> Checking *.test-market.orangesync.tech site block"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
CADDYFILE="/etc/caddy/Caddyfile"

if ! sudo grep -q 'test-market.orangesync.tech' "$CADDYFILE" 2>/dev/null; then
  echo "  Adding *.test-market.orangesync.tech site block"
  sudo tee -a "$CADDYFILE" > /dev/null <<'SITE'

*.test-market.orangesync.tech {
  log {
    output file /var/log/caddy/access.json {
      roll_size 50MiB
      roll_keep 3
    }
    format json
  }
  tls {
    on_demand
  }
  reverse_proxy localhost:6799
}
SITE
  echo "  Site block added"
else
  echo "  test-market.orangesync.tech route already present"
fi
REMOTE

# ── 11. Validate and reload Caddy ──
echo "==> Validating Caddy config"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "sudo caddy validate --config /etc/caddy/Caddyfile 2>&1 || true"

echo "==> Reloading Caddy"
"${SSH_BASE[@]}" "${_VPS_USER}@${HOST}" "sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy"

echo "==> Done. VPS provisioned successfully."