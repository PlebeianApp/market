#!/usr/bin/env bash
set -euo pipefail

# Read-only reporting helper. Do not add cleanup, pruning, restart, or deploy commands here.

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <ssh-host-alias>" >&2
  echo "example: $0 market-relay-staging" >&2
  exit 64
fi

host="$1"

ssh -- "$host" 'sh -s' <<'REMOTE'
set -u

has_sudo=0
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  has_sudo=1
else
  echo "sudo not available non-interactively; privileged checks may be incomplete"
fi

run_privileged() {
  if [ "$has_sudo" = "1" ]; then
    sudo -n "$@"
  else
    "$@"
  fi
}

deploy_home="${DEPLOY_HOME:-$HOME}"

echo "== host =="
hostname || true
date -u || true

echo
echo "== filesystem usage =="
df -hT || true

echo
echo "== inode usage =="
df -i || true

echo
echo "== /var/lib top-level usage =="
run_privileged du -xhd1 /var/lib 2>/dev/null | sort -h | tail -30 || true

echo
echo "== relay data usage =="
run_privileged du -sh \
  /var/lib/market-relay \
  /var/lib/market-relay/raw \
  /var/lib/market-relay/search \
  2>/dev/null || true

echo
echo "== deploy/temp usage =="
du -sh /tmp /tmp/deploy-package 2>/dev/null || true
du -sh "$deploy_home"/deploy-package "$deploy_home"/*.tar.gz "$deploy_home"/Caddyfile.staging 2>/dev/null || true
du -sh "$deploy_home"/releases/* 2>/dev/null | sort -h || true

echo
echo "== docker usage =="
docker system df || true

echo
echo "== journal usage =="
run_privileged journalctl --disk-usage || true

echo
echo "== deleted-open-file check =="
if command -v lsof >/dev/null 2>&1; then
  run_privileged lsof +L1 2>/dev/null | sort -k7 -n | tail -20 || true
else
  echo "lsof not installed; skipping deleted-open-file check"
fi

echo
echo "== relay service status =="
run_privileged systemctl status market-relay --no-pager || true

echo
echo "== report complete =="
REMOTE
