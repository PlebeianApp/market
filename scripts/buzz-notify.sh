#!/usr/bin/env bash
# buzz-notify.sh — Send CI notifications to Plebeian Buzz relay (#ci channel)
# Called from GitHub Actions workflows.
#
# Publishes a Buzz channel message (NIP-29 kind 9 event with an ["h", channel]
# tag) via the relay's HTTP POST /events endpoint, authenticated with a NIP-98
# (kind 27235) HTTP-auth event — the exact wire protocol the `buzz` CLI uses.
#
# Requires `nak` (already installed in all workflows that call this script) and
# `curl` (pre-installed on ubuntu-latest runners).
#
# Usage:
#   ./scripts/buzz-notify.sh --status pass --pr 1175 --job "E2E Tests" --detail "12/12 pass"
#   ./scripts/buzz-notify.sh --status fail --pr 1175 --job "Coverage Gate" --detail "3 files uncovered" --url "https://..."
#   ./scripts/buzz-notify.sh --status info --pr 1175 --job "Preview Deploy" --detail "https://pr1175.test-market..." --url "https://pr1175.test-market..."
#
# Required env (set in GitHub Actions secrets):
#   CI_BUZZ_RELAY_URL   — relay HTTP/HTTPS base URL (e.g. https://buzz.example.com)
#   CI_BUZZ_PRIVATE_KEY — hex or nsec key for the CI bot identity
#
# Legacy aliases (still accepted): BUZZ_RELAY_URL / BUZZ_PRIVATE_KEY

set -euo pipefail

CI_CHANNEL="6e655a87-635f-4b4b-84cb-072f287983b6"

# Parse args
STATUS=""
PR=""
JOB=""
DETAIL=""
URL=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --status) STATUS="$2"; shift 2 ;;
        --pr) PR="$2"; shift 2 ;;
        --job) JOB="$2"; shift 2 ;;
        --detail) DETAIL="$2"; shift 2 ;;
        --url) URL="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# Resolve credentials
RELAY="${CI_BUZZ_RELAY_URL:-${BUZZ_RELAY_URL:-}}"
KEY="${CI_BUZZ_PRIVATE_KEY:-${BUZZ_PRIVATE_KEY:-}}"

if [ -z "$RELAY" ] || [ -z "$KEY" ]; then
    echo "buzz-notify: missing CI_BUZZ_RELAY_URL or CI_BUZZ_PRIVATE_KEY — skipping" >&2
    exit 0
fi

# Pass the key to nak via the NOSTR_SECRET_KEY env var (nak reads this
# natively) instead of the --sec CLI flag, so the private key never appears in
# process listings (ps / /proc/<pid>/cmdline). See `nak event --help`.
export NOSTR_SECRET_KEY="$KEY"

# Build emoji + prefix from status
case "$STATUS" in
    pass|success|passed) EMOJI="✅" ;;
    fail|failure|failed) EMOJI="🔴" ;;
    warn|warning) EMOJI="🟡" ;;
    info|deploy|ready) EMOJI="🔵" ;;
    merge-ready) EMOJI="🔔" ;;
    *) EMOJI="📋" ;;
esac

# Build message (real newlines for multi-line rendering in Buzz)
MSG="[CI] ${EMOJI} ${JOB}"
[ -n "$PR" ] && MSG="${MSG} on #${PR}"
[ -n "$DETAIL" ] && MSG="${MSG} — ${DETAIL}"
if [ -n "$URL" ]; then
    MSG="${MSG}"$'\n'"${URL}"
fi

# ── Locate nak ──────────────────────────────────────────────────────────────
# All workflows install nak via `go build` into GOPATH/bin. With actions/setup-go
# that dir is on PATH, but we check common fallbacks for robustness.
NAK_BIN=""
for candidate in "$(command -v nak 2>/dev/null || true)" \
                 "$(go env GOPATH 2>/dev/null || true)/bin/nak" \
                 "$HOME/go/bin/nak"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        NAK_BIN="$candidate"
        break
    fi
done
if [ -z "$NAK_BIN" ]; then
    echo "buzz-notify: nak not found — skipping" >&2
    exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "buzz-notify: curl not found — skipping" >&2
    exit 0
fi

# Normalize relay URL (strip trailing slash)
RELAY="${RELAY%/}"
EVENTS_URL="${RELAY}/events"

# ── 1. Build & sign the kind 9 channel message (NIP-29) ─────────────────────
# Buzz group chat: kind 9, single ["h", channel-uuid] tag.
MSG_EVENT=$("$NAK_BIN" event -q -k 9 -c "$MSG" \
    -t "h=$CI_CHANNEL" 2>/dev/null) || {
    echo "buzz-notify: failed to build message event — ${MSG_EVENT:-nak error}" >&2
    exit 0
}

# ── 2. Compute NIP-98 payload hash (sha256 of the event JSON body) ──────────
PAYLOAD_HASH=$(printf '%s' "$MSG_EVENT" | sha256sum | cut -d' ' -f1)

# ── 3. Build & sign the NIP-98 HTTP auth event (kind 27235) ─────────────────
NONCE=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || printf '%s' "$(date +%s%N)")
AUTH_EVENT=$("$NAK_BIN" event -q -k 27235 -c "" \
    -t "u=$EVENTS_URL" \
    -t "method=POST" \
    -t "nonce=$NONCE" \
    -t "payload=$PAYLOAD_HASH" 2>/dev/null) || {
    echo "buzz-notify: failed to build NIP-98 auth event — ${AUTH_EVENT:-nak error}" >&2
    exit 0
}

# ── 4. Base64-encode the auth event for the Authorization header ────────────
# GNU base64 supports -w0 (no line wrapping); BSD base64 (macOS) does not.
if base64 -w0 </dev/null >/dev/null 2>&1; then
    AUTH_B64=$(printf '%s' "$AUTH_EVENT" | base64 -w0)
else
    AUTH_B64=$(printf '%s' "$AUTH_EVENT" | base64 | tr -d '\n')
fi

# ── 5. POST the signed event to the relay ───────────────────────────────────
RESP_FILE=$(mktemp)
HTTP_CODE=$(curl -s -o "$RESP_FILE" -w '%{http_code}' \
    -X POST "$EVENTS_URL" \
    -H "Authorization: Nostr $AUTH_B64" \
    -H "Content-Type: application/json" \
    --data-binary "$MSG_EVENT" 2>&1) || {
    echo "buzz-notify: failed to send (curl error) — $HTTP_CODE" >&2
    rm -f "$RESP_FILE"
    exit 0
}
RESP_BODY=$(cat "$RESP_FILE" 2>/dev/null || true)
rm -f "$RESP_FILE"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "buzz-notify: sent to #ci"
else
    # Truncate response body to avoid log spam
    echo "buzz-notify: relay returned HTTP $HTTP_CODE — ${RESP_BODY:0:200}" >&2
    exit 0  # Non-blocking: CI notification failure should NOT fail the workflow
fi
