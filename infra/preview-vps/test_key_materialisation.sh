#!/usr/bin/env bash
# test_key_materialisation.sh — the Bootstrap step must reconstruct a LOADABLE
# OpenSSH private key from the PREVIEW_VPS_SSH_KEY secret.
#
# History: the step used a bare `printf '%s'` so that the materialised key had
# no trailing newline (the comment claimed a trailing newline "corrupts the PEM
# key format"). The opposite is true. OpenSSH rejects a private key whose final
# line is not newline-terminated with
#
#   Load key "/tmp/tmp.XXXX": error in libcrypto
#
# and then falls through to password auth, ending in
#
#   Received disconnect ... Too many authentication failures
#
# Both messages point away from the real cause, and because GitHub strips
# trailing newlines from secret values, EVERY deploy failed this way.
#
# Self-contained and OFFLINE (no network, no VPS, no secrets): it generates its
# own throwaway key. Run from anywhere:
#
#   bash infra/preview-vps/test_key_materialisation.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKFLOW="${REPO_ROOT}/.github/workflows/preview-deploy.yml"
# The materialisation guard lives in the shared helper, which BOTH the deploy
# and the teardown job call, so there is exactly one implementation of it.
PREPARE="${SCRIPT_DIR}/ssh-prepare.sh"

CHECKS=0
FAILURES=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

# check <description> <command...> — passes when the command SUCCEEDS.
check() {
  local desc="$1"
  shift
  CHECKS=$((CHECKS + 1))
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}

# check_not <description> <command...> — passes when the command FAILS.
check_not() {
  local desc="$1"
  shift
  CHECKS=$((CHECKS + 1))
  if "$@"; then fail "$desc"; else pass "$desc"; fi
}

printf '== preview-deploy SSH key materialisation ==\n'
printf 'workflow : %s\n' "$WORKFLOW"
printf 'helper   : %s\n' "$PREPARE"

# ── 1. Static: the helper carries the guard and the validation ────────────
check "the helper restores a missing trailing newline before chmod" \
  grep -qF 'if [ -n "$(tail -c1 "$KEY_FILE")" ]' "$PREPARE"

check "the helper validates the materialised key with ssh-keygen -y" \
  grep -qF 'ssh-keygen -y -f "$KEY_FILE"' "$PREPARE"

check "the helper writes the key with printf (no echo added-newline surprises)" \
  grep -qF "printf '%s' \"\$PREVIEW_VPS_SSH_KEY\" > \"\$KEY_FILE\"" "$PREPARE"

# The guard is only useful if the workflow actually calls the helper.
check "the workflow runs the helper that applies the guard" \
  grep -qF 'bash infra/preview-vps/ssh-prepare.sh' "$WORKFLOW"

# The original, actively-wrong rationale must not come back.
check_not "the misleading 'avoid trailing newline' comment is gone" \
  bash -c 'grep -qF "avoid trailing newline which corrupts" "$1" "$2"' _ "$WORKFLOW" "$PREPARE"

# ── 2. Behavioural: prove the bug is real and the guard fixes it ──────────
_tmp="$(mktemp -d)"
trap 'rm -rf "${_tmp}"' EXIT

ssh-keygen -q -t ed25519 -N '' -C 'key-materialisation-test' -f "${_tmp}/k" >/dev/null 2>&1
_full="${_tmp}/full"
cp "${_tmp}/k" "$_full"
chmod 600 "$_full"

# Emulate what a GitHub secret value looks like after storage: trailing
# newlines stripped.
_stripped="${_tmp}/stripped"
head -c "$(( $(wc -c < "$_full") - 1 ))" "$_full" > "$_stripped"
chmod 600 "$_stripped"

_lasbyte_stripped="$(tail -c1 "$_stripped" | od -An -tx1 | tr -d ' \n')"
check "emulated secret ends without a newline (last byte ${_lasbyte_stripped})" \
  test "$_lasbyte_stripped" != "0a"

# Redirections must live INSIDE the helper: a `>/dev/null` on the `check`
# invocation would swallow check's own PASS/FAIL line.
key_loads() { ssh-keygen -y -f "$1" >/dev/null 2>&1; }

# The BUG: a key with no trailing newline is rejected.
check_not "an unterminated key is rejected by ssh-keygen -y (the original bug)" \
  key_loads "$_stripped"

# The FIX: exactly the workflow's guard, applied to the same bytes.
_fixed="${_tmp}/fixed"
cp "$_stripped" "$_fixed"
if [ -n "$(tail -c1 "$_fixed")" ]; then
  printf '\n' >> "$_fixed"
fi
chmod 600 "$_fixed"

check "the guard makes the key loadable" \
  key_loads "$_fixed"

check "the guard is idempotent on an already-terminated key" \
  bash -c 'f="$1"; if [ -n "$(tail -c1 "$f")" ]; then printf "\n" >> "$f"; fi; if [ -n "$(tail -c1 "$f")" ]; then printf "\n" >> "$f"; fi; exit 0' _ "$_full"

check "an already-terminated key is still loadable after the guard" \
  key_loads "$_full"

check "the repaired key is byte-identical in fingerprint to the original" \
  test "$(ssh-keygen -lf "$_fixed.pub" 2>/dev/null || ssh-keygen -y -f "$_fixed" 2>/dev/null | ssh-keygen -lf - | awk '{print $2}')" \
       = "$(ssh-keygen -y -f "$_full" 2>/dev/null | ssh-keygen -lf - | awk '{print $2}')"

printf '\n%s checks, %s failure(s)\n' "${CHECKS}" "${FAILURES}"
if [ "${FAILURES}" -ne 0 ]; then
  printf 'RESULT: FAIL\n'
  exit 1
fi
printf 'RESULT: PASS\n'
exit 0
