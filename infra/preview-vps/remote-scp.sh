#!/usr/bin/env bash
# remote-scp.sh — copy files to the preview VPS over OpenSSH, pinned to the
# ed25519 host key prepared by ssh-prepare.sh.
#
# usage: remote-scp.sh <local...> <target:path>
#
# Reads the same environment as remote-ssh.sh. `-r` is always on: the deploy
# package is a directory tree. Note the UPPERCASE -P for scp (ssh uses -p).
#
# The remote path must be absolute: modern scp speaks SFTP and does NOT expand
# $HOME or ~ on the remote side.
set -euo pipefail

: "${PREVIEW_KEY_FILE:?PREVIEW_KEY_FILE is not set — run ssh-prepare.sh first}"
: "${PREVIEW_KNOWN_HOSTS:?PREVIEW_KNOWN_HOSTS is not set — run ssh-prepare.sh first}"
: "${PREVIEW_SSH_TARGET:?PREVIEW_SSH_TARGET is not set — run ssh-prepare.sh first}"

exec scp -r \
  -i "$PREVIEW_KEY_FILE" \
  -P "${PREVIEW_SSH_PORT:-22}" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ConnectTimeout=20 \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$PREVIEW_KNOWN_HOSTS" \
  -o HostKeyAlgorithms=ssh-ed25519 \
  "$@"
