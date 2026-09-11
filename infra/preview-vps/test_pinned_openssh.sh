#!/usr/bin/env bash
# test_pinned_openssh.sh — every VPS connection in preview-deploy.yml must go
# through the OpenSSH helpers, pinned to the ed25519 host key.
#
# History: the workflow reached the VPS with appleboy/ssh-action and
# appleboy/scp-action. Those are Go programs (drone-ssh on
# golang.org/x/crypto/ssh) and their DEFAULT HostKeyAlgorithms negotiate a
# DIFFERENT host key than OpenSSH against this VPS. Measured 2026-09-11 against
# 23.182.128.51:22 with an unmodified Go ssh client:
#
#   OpenSSH -> ssh-ed25519         SHA256:rjbvoYsKckQMv/L9Y4LQNCx86z95pqonoNGmXdUS41M
#   Go      -> ecdsa-sha2-nistp256 SHA256:UTl0gzMwYlKNuORtrA8jxS7gmj9U1x8taGQh5vxaXQo
#
# One PREVIEW_VPS_HOST_FINGERPRINT secret cannot satisfy two SSH stacks that
# disagree about which host key to negotiate, so every appleboy step died with
#
#   ssh: handshake failed: ssh: host key fingerprint mismatch
#
# This test is what stops a Go-based SSH action from creeping back in and
# re-breaking the deploy. It is OFFLINE: the only socket it opens is to a closed
# port on 127.0.0.1, never the VPS.
#
#   bash infra/preview-vps/test_pinned_openssh.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKFLOW="${REPO_ROOT}/.github/workflows/preview-deploy.yml"
PREPARE="${SCRIPT_DIR}/ssh-prepare.sh"
SSH_HELPER="${SCRIPT_DIR}/remote-ssh.sh"
SCP_HELPER="${SCRIPT_DIR}/remote-scp.sh"

CHECKS=0
FAILURES=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

check() {
  local desc="$1"
  shift
  CHECKS=$((CHECKS + 1))
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}

check_not() {
  local desc="$1"
  shift
  CHECKS=$((CHECKS + 1))
  if "$@"; then fail "$desc"; else pass "$desc"; fi
}

printf '== preview-deploy uses pinned OpenSSH only ==\n'
printf 'workflow : %s\n' "$WORKFLOW"

# ── 1. No Go-based SSH action may be used ───────────────────────────────────
check_not "no appleboy (Go/drone-ssh) action is used in the workflow" \
  grep -qE '^[[:space:]]*uses:[[:space:]]*appleboy/' "$WORKFLOW"

# The negotiated host key lives in the helpers, never inline in the workflow.
# (Match the OPTION, not the bare word: the workflow explains the Go/ECDSA
# finding in comments and must stay free to name it.)
check_not "the workflow does not pin HostKeyAlgorithms inline (helpers own it)" \
  grep -qE '(-o[[:space:]]+)?HostKeyAlgorithms=' "$WORKFLOW"

check_not "the workflow does not call ssh/scp directly (helpers only)" \
  grep -qE '^[[:space:]]*(ssh|scp)[[:space:]]' "$WORKFLOW"

check "the workflow routes through remote-ssh.sh" \
  grep -qF 'infra/preview-vps/remote-ssh.sh' "$WORKFLOW"

check "the workflow routes through remote-scp.sh" \
  grep -qF 'infra/preview-vps/remote-scp.sh' "$WORKFLOW"

# Both jobs need the pinned key + known_hosts. Before, only the deploy job had
# any secrets handling at all, and the teardown job ran unguarded.
check "both jobs prepare the SSH key + host pin (exactly 2 call sites)" \
  test "$(grep -cF 'bash infra/preview-vps/ssh-prepare.sh' "$WORKFLOW")" = "2"

# ── 2. The helpers fail closed on host key mismatch ─────────────────────────
check "remote-ssh.sh requires a private known_hosts" \
  grep -qF 'UserKnownHostsFile="$PREVIEW_KNOWN_HOSTS"' "$SSH_HELPER"

check "remote-ssh.sh refuses to trust an unknown host key" \
  grep -qF 'StrictHostKeyChecking=yes' "$SSH_HELPER"

check "remote-ssh.sh pins the negotiated algorithm to ed25519" \
  grep -qF 'HostKeyAlgorithms=ssh-ed25519' "$SSH_HELPER"

check "remote-ssh.sh never prompts (BatchMode, IdentitiesOnly)" \
  bash -c 'grep -qF "BatchMode=yes" "$1" && grep -qF "IdentitiesOnly=yes" "$1"' _ "$SSH_HELPER"

check "remote-scp.sh pins the negotiated algorithm to ed25519" \
  grep -qF 'HostKeyAlgorithms=ssh-ed25519' "$SCP_HELPER"

check "remote-scp.sh refuses to trust an unknown host key" \
  grep -qF 'StrictHostKeyChecking=yes' "$SCP_HELPER"

# scp takes -P (port); ssh takes -p. Mixing them silently copies on port 22.
check "remote-scp.sh uses the uppercase scp port flag (-P)" \
  grep -qE '^[[:space:]]+-P[[:space:]]' "$SCP_HELPER"

check_not "remote-scp.sh does not use ssh's lowercase -p port flag" \
  grep -qE '^[[:space:]]+-p[[:space:]]' "$SCP_HELPER"

# ── 3. The preparation script verifies the pin it is given ──────────────────
check "ssh-prepare.sh pins the ed25519 key type when scanning" \
  grep -qF -- '-t ed25519' "$PREPARE"

check "ssh-prepare.sh skips ssh-keyscan's comment banner line" \
  grep -qF "awk 'NF >= 3 && \$1 !~ /^#/ { print; exit }'" "$PREPARE"

check "ssh-prepare.sh compares against PREVIEW_VPS_HOST_FINGERPRINT" \
  grep -qF 'if [ "$ACTUAL_FP" != "$PREVIEW_VPS_HOST_FINGERPRINT" ]; then' "$PREPARE"

# An unreachable host and a changed host key are different incidents and must
# not share a message — the old code reported a bogus "fingerprint mismatch"
# whenever ssh-keyscan produced nothing.
check "ssh-prepare.sh separates 'unreachable' from 'mismatch'" \
  grep -qF 'This is NOT a fingerprint mismatch' "$PREPARE"

# ── 4. Behaviour: the guards actually fire ─────────────────────────────────
_tmp="$(mktemp -d)"
trap 'rm -rf "${_tmp}"' EXIT

# A key that cannot be materialised must fail BEFORE any network traffic, with
# a message naming the secret, a non-zero status, and EMPTY stdout (stdout is
# appended straight to $GITHUB_ENV, so junk there corrupts the job env).
_out="${_tmp}/out1"
_err="${_tmp}/err1"
_env() { env -u PREVIEW_VPS_SSH_PORT "$@"; }

set +e
_env PREVIEW_VPS_SSH_KEY='not-a-private-key' \
  PREVIEW_VPS_USER='debian' \
  PREVIEW_VPS_HOST='127.0.0.1' \
  PREVIEW_VPS_HOST_FINGERPRINT='SHA256:doesnotmatter' \
  PREVIEW_VPS_SSH_PORT='9' \
  bash "$PREPARE" "${_tmp}/bad" >"$_out" 2>"$_err"
_rc_bad=$?
set -e 2>/dev/null || true

check "an unusable key exits non-zero" test "$_rc_bad" -ne 0
check "an unusable key names the offending secret" \
  grep -qF 'PREVIEW_VPS_SSH_KEY did not materialise' "$_err"
check "an unusable key leaves stdout empty (no junk into \$GITHUB_ENV)" \
  test ! -s "$_out"

# A KEY WITH NO TRAILING NEWLINE is exactly what GitHub hands the runner: it
# strips trailing newlines from secret values. The guard must repair it, so the
# script has to get PAST key validation and fail later, at the host-key stage.
# If this ever regresses to "did not materialise", the deploy is broken again.
ssh-keygen -q -t ed25519 -N '' -C 'pinned-openssh-test' -f "${_tmp}/k" >/dev/null 2>&1
_full="$(cat "${_tmp}/k")"
_stripped="$(head -c "$(( $(wc -c < "${_tmp}/k") - 1 ))" "${_tmp}/k")"

_out="${_tmp}/out2"
_err="${_tmp}/err2"
set +e
_env PREVIEW_VPS_SSH_KEY="$_stripped" \
  PREVIEW_VPS_USER='debian' \
  PREVIEW_VPS_HOST='127.0.0.1' \
  PREVIEW_VPS_HOST_FINGERPRINT='SHA256:doesnotmatter' \
  PREVIEW_VPS_SSH_PORT='9' \
  bash "$PREPARE" "${_tmp}/newline" >"$_out" 2>"$_err"
_rc_nl=$?
set -e 2>/dev/null || true

check "a newline-stripped key (GitHub's exact form) gets past key validation" \
  grep -qF 'Could not read an ed25519 host key' "$_err"
check "a newline-stripped key is not reported as a materialisation failure" \
  bash -c '! grep -qF "did not materialise" "$1"' _ "$_err"

# Unreachable host: distinct wording, and never "mismatch".
check "an unreachable host is reported as unreachable" \
  bash -c 'grep -qF "Could not read an ed25519 host key" "$1"' _ "$_err"
# Match the MISMATCH MESSAGE, not the bare phrase: the unreachable-host message
# deliberately contains the words "This is NOT a fingerprint mismatch".
check "an unreachable host is NOT reported as a fingerprint mismatch" \
  bash -c '! grep -qF "Host key fingerprint mismatch for" "$1"' _ "$_err"
check "a failed run exits non-zero" test "$_rc_nl" -ne 0
check "a failed run leaves stdout empty" test ! -s "$_out"

# THE decisive assertion: the helper got past key validation AND left a key on
# disk that OpenSSH accepts, even though the secret arrived exactly as GitHub
# stores it — trailing newline stripped. If the trailing-newline guard ever
# regresses, this file is unloadable and this check fails.
key_loads() { ssh-keygen -y -f "$1" >/dev/null 2>&1; }

check "the newline-stripped secret produced a loadable key on disk" \
  key_loads "${_tmp}/newline/id_preview"

# And the guard is idempotent: the same key WITH its trailing newline must be
# accepted identically, not double-terminated.
_with_nl="$(cat "${_tmp}/k")"$'\n'
_err3="${_tmp}/err3"
set +e
_env PREVIEW_VPS_SSH_KEY="$_with_nl" \
  PREVIEW_VPS_USER='debian' \
  PREVIEW_VPS_HOST='127.0.0.1' \
  PREVIEW_VPS_HOST_FINGERPRINT='SHA256:doesnotmatter' \
  PREVIEW_VPS_SSH_PORT='9' \
  bash "$PREPARE" "${_tmp}/withnl" >/dev/null 2>"$_err3"
set -e 2>/dev/null || true

check "an already-terminated secret is handled identically (idempotent guard)" \
  key_loads "${_tmp}/withnl/id_preview"

check "both secret forms reach the same conclusion (byte-identical stderr)" \
  bash -c 'cmp -s "$1" "$2"' _ "$_err" "$_err3"

printf '\n%s checks, %s failure(s)\n' "${CHECKS}" "${FAILURES}"
if [ "${FAILURES}" -ne 0 ]; then
  printf 'RESULT: FAIL\n'
  exit 1
fi
printf 'RESULT: PASS\n'
exit 0
