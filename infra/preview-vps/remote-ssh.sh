#!/usr/bin/env bash
# remote-ssh.sh — run a command on the preview VPS over OpenSSH, pinned to the
# ed25519 host key prepared by ssh-prepare.sh.
#
# usage:
#   remote-ssh.sh <command> [args...]
#   remote-ssh.sh bash -s <<'REMOTE'      # multi-line script on stdin
#   remote-ssh.sh bash -s < script.sh
#
# Reads PREVIEW_KEY_FILE, PREVIEW_KNOWN_HOSTS, PREVIEW_SSH_PORT and
# PREVIEW_SSH_TARGET from the environment (exported by the workflow from
# ssh-prepare.sh via $GITHUB_ENV).
#
# This is the SINGLE place the preview SSH options are defined. Every VPS
# connection in .github/workflows/preview-deploy.yml goes through this script
# or remote-scp.sh — never through a Go-based action (appleboy/*), whose default
# HostKeyAlgorithms negotiate a different host key than OpenSSH against this
# VPS and therefore cannot share the PREVIEW_VPS_HOST_FINGERPRINT pin. See
# ssh-prepare.sh for the measured fingerprints.
#
# StrictHostKeyChecking=yes against a private known_hosts means an unknown or
# changed host key is a hard failure, not an interactive prompt: a CI job must
# never silently trust a key it was not shown.
set -euo pipefail

: "${PREVIEW_KEY_FILE:?PREVIEW_KEY_FILE is not set — run ssh-prepare.sh first}"
: "${PREVIEW_KNOWN_HOSTS:?PREVIEW_KNOWN_HOSTS is not set — run ssh-prepare.sh first}"
: "${PREVIEW_SSH_TARGET:?PREVIEW_SSH_TARGET is not set — run ssh-prepare.sh first}"

exec ssh \
  -i "$PREVIEW_KEY_FILE" \
  -p "${PREVIEW_SSH_PORT:-22}" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ConnectTimeout=20 \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$PREVIEW_KNOWN_HOSTS" \
  -o HostKeyAlgorithms=ssh-ed25519 \
  "$PREVIEW_SSH_TARGET" "$@"
