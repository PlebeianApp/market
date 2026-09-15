#!/usr/bin/env bash
# ssh-prepare.sh — materialise the preview VPS SSH private key and pin its host
# key, using OpenSSH ONLY.
#
# usage: ssh-prepare.sh <workdir>
#
# Required environment (the workflow maps the PREVIEW_VPS_* secrets onto these):
#   PREVIEW_VPS_SSH_KEY           unencrypted OpenSSH private key
#   PREVIEW_VPS_USER              login user on the VPS
#   PREVIEW_VPS_HOST              VPS hostname or IP
#   PREVIEW_VPS_HOST_FINGERPRINT  SHA256 ed25519 fingerprint (SHA256:...)
# Optional:
#   PREVIEW_VPS_SSH_PORT          defaults to 22
#
# On success prints exactly these lines on stdout, so the caller can append them
# straight to $GITHUB_ENV:
#   PREVIEW_KEY_FILE=<path>
#   PREVIEW_KNOWN_HOSTS=<path>
#   PREVIEW_SSH_PORT=<port>
#   PREVIEW_SSH_TARGET=<user>@<host>
# Diagnostics go to stderr and the exit status is nonzero on any failure, so the
# stdout stream stays a clean KEY=VALUE block.
#
# ── Why OpenSSH only ─────────────────────────────────────────────────────────
# This key is also used by infra/preview-vps/provision.sh, which pins the host
# key with `ssh-keyscan -t ed25519` and `-o HostKeyAlgorithms=ssh-ed25519`.
# GitHub's appleboy/* actions are Go programs (drone-ssh on
# golang.org/x/crypto/ssh) whose DEFAULT HostKeyAlgorithms negotiate a
# different host key against this VPS than OpenSSH does. Measured 2026-09-11
# against 23.182.128.51:22 with an unmodified Go ssh client:
#
#   OpenSSH -> ssh-ed25519          SHA256:rjbvoYsKckQMv/L9Y4LQNCx86z95pqonoNGmXdUS41M
#   Go      -> ecdsa-sha2-nistp256  SHA256:UTl0gzMwYlKNuORtrA8jxS7gmj9U1x8taGQh5vxaXQo
#
# One PREVIEW_VPS_HOST_FINGERPRINT secret cannot satisfy two SSH stacks that
# disagree about which host key to negotiate, so every appleboy step died with
#
#   ssh: handshake failed: ssh: host key fingerprint mismatch
#
# Do NOT reintroduce a Go-based SSH action into .github/workflows/
# preview-deploy.yml without re-measuring the negotiated host key first.
set -euo pipefail

WORKDIR="${1:-}"
if [ -z "$WORKDIR" ]; then
  printf '::error::usage: ssh-prepare.sh <workdir>\n' >&2
  exit 2
fi

err() { printf '::error::%s\n' "$1" >&2; }
note() { printf '%s\n' "$1" >&2; }

: "${PREVIEW_VPS_SSH_KEY:?PREVIEW_VPS_SSH_KEY is required}"
: "${PREVIEW_VPS_USER:?PREVIEW_VPS_USER is required}"
: "${PREVIEW_VPS_HOST:?PREVIEW_VPS_HOST is required}"
: "${PREVIEW_VPS_HOST_FINGERPRINT:?PREVIEW_VPS_HOST_FINGERPRINT is required}"
PORT="${PREVIEW_VPS_SSH_PORT:-22}"

mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"
KEY_FILE="$WORKDIR/id_preview"
KNOWN_HOSTS="$WORKDIR/known_hosts"

# ── 1. Materialise the key ───────────────────────────────────────────────────
printf '%s' "$PREVIEW_VPS_SSH_KEY" > "$KEY_FILE"
# Convert literal \n escapes to real newlines: some secret entry paths store
# the key as a single escaped line.
sed -i 's/\\n/\n/g' "$KEY_FILE"
# A trailing newline on the LAST line is mandatory. OpenSSH rejects a private
# key whose final line is not newline-terminated with
#   Load key "/tmp/tmp.XXXX": error in libcrypto
# and then silently falls through to password auth and reports
#   Received disconnect ... Too many authentication failures
# Two errors that both point away from the real cause. GitHub strips trailing
# newlines from secret values, so restore it here:
#   ssh-keygen -y -f <443-byte key>  -> error in libcrypto
#   ssh-keygen -y -f <444-byte key>  -> ok
if [ -n "$(tail -c1 "$KEY_FILE")" ]; then
  printf '\n' >> "$KEY_FILE"
fi
chmod 600 "$KEY_FILE"
# Fail loudly and specifically if the materialised key is unusable, rather than
# three steps later with an unrelated-sounding error.
if ! ssh-keygen -y -f "$KEY_FILE" >/dev/null 2>&1; then
  err "PREVIEW_VPS_SSH_KEY did not materialise into a loadable OpenSSH private key. Expected an unencrypted private key (-----BEGIN OPENSSH PRIVATE KEY-----) with a trailing newline; got $(wc -c < "$KEY_FILE") bytes."
  exit 1
fi

# ── 2. Pin the host key (ed25519) ────────────────────────────────────────────
# awk, not `head -n 1`: ssh-keyscan prints a comment banner
# ("# 23.182.128.51:22 SSH-2.0-OpenSSH_10.0p2 Debian-7+deb13u4") as its first
# line, and a pinned fingerprint read from that line is empty — which used to
# surface as a bogus "host key fingerprint mismatch". Take the first real key
# line (>= 3 fields, not a comment). For a non-default port ssh-keyscan emits
# the known_hosts form "[host]:port" itself, so the file is directly usable.
# `|| true` is load-bearing: ssh-keyscan exits non-zero when it cannot reach the
# host, and under `set -euo pipefail` that would abort this assignment before the
# message below ever runs — a silent failure with no explanation at all.
SCAN="$(ssh-keyscan -T 10 -p "$PORT" -t ed25519 "$PREVIEW_VPS_HOST" 2>/dev/null \
  | awk 'NF >= 3 && $1 !~ /^#/ { print; exit }' || true)"
if [ -z "$SCAN" ]; then
  # Distinguish "could not reach the host" from "the host presented a different
  # key": an unreachable host and a changed key are different incidents.
  err "Could not read an ed25519 host key from $PREVIEW_VPS_HOST:$PORT (ssh-keyscan returned nothing). The host is unreachable, or its sshd does not offer an ed25519 key. This is NOT a fingerprint mismatch."
  exit 1
fi
printf '%s\n' "$SCAN" > "$KNOWN_HOSTS"
chmod 644 "$KNOWN_HOSTS"

ACTUAL_FP="$(printf '%s\n' "$SCAN" | ssh-keygen -lf - | awk '{print $2}')"
if [ "$ACTUAL_FP" != "$PREVIEW_VPS_HOST_FINGERPRINT" ]; then
  err "Host key fingerprint mismatch for $PREVIEW_VPS_HOST:$PORT — pinned $PREVIEW_VPS_HOST_FINGERPRINT (secret PREVIEW_VPS_HOST_FINGERPRINT), host presents $ACTUAL_FP (ed25519). Re-check with: ssh-keyscan -t ed25519 $PREVIEW_VPS_HOST | ssh-keygen -lf -"
  exit 1
fi
note "Host key pin verified: $PREVIEW_VPS_HOST:$PORT ed25519 $ACTUAL_FP"

printf 'PREVIEW_KEY_FILE=%s\n' "$KEY_FILE"
printf 'PREVIEW_KNOWN_HOSTS=%s\n' "$KNOWN_HOSTS"
printf 'PREVIEW_SSH_PORT=%s\n' "$PORT"
printf 'PREVIEW_SSH_TARGET=%s@%s\n' "$PREVIEW_VPS_USER" "$PREVIEW_VPS_HOST"
