#!/usr/bin/env bash
# test_ssh_port.sh — static assertions that the preview-deploy SSH port is
# configurable through the OPTIONAL repository secret PREVIEW_VPS_SSH_PORT
# and that the default behaviour is unchanged (port 22) when it is unset.
#
# Self-contained and OFFLINE: grep/awk over the two files only, no network,
# no VPS access, no secrets required. Run from anywhere:
#
#   bash infra/preview-vps/test_ssh_port.sh
#
# Prints PASS/FAIL per assertion and exits non-zero if any assertion fails.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKFLOW="${REPO_ROOT}/.github/workflows/preview-deploy.yml"
PROVISION="${SCRIPT_DIR}/provision.sh"


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
  if "$@"; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

# check_not <description> <command...> — passes when the command FAILS.
check_not() {
  local desc="$1"
  shift
  CHECKS=$((CHECKS + 1))
  if "$@"; then
    fail "$desc"
  else
    pass "$desc"
  fi
}

printf '== preview-deploy SSH port configuration ==\n'
printf 'workflow : %s\n' "${WORKFLOW}"
printf 'provision: %s\n\n' "${PROVISION}"

# ── 0. Inputs exist ───────────────────────────────────────────────────────
check "workflow file exists" test -f "${WORKFLOW}"
check "provision.sh exists" test -f "${PROVISION}"

# ── 1. Workflow: the optional port reaches every job's SSH preparation ────
# The workflow no longer hands a `port:` input to appleboy actions — those are
# gone entirely (Go/drone-ssh negotiates a different host key than OpenSSH; see
# test_pinned_openssh.sh). The port now travels as the optional
# PREVIEW_VPS_SSH_PORT secret into ssh-prepare.sh, which publishes
# PREVIEW_SSH_PORT to $GITHUB_ENV for remote-ssh.sh / remote-scp.sh.
PREPARE_PORT_LINE='^[[:space:]]+PREVIEW_VPS_SSH_PORT: \$\{\{ secrets\.PREVIEW_VPS_SSH_PORT \}\}[[:space:]]*$'
PREPARE_COUNT="$(grep -cE 'bash infra/preview-vps/ssh-prepare\.sh' "${WORKFLOW}")"
PORT_ENV_COUNT="$(grep -cE "${PREPARE_PORT_LINE}" "${WORKFLOW}")"

printf -- '-- ssh-prepare.sh call sites: %s\n' "${PREPARE_COUNT}"
printf -- '-- optional-port env lines: %s\n' "${PORT_ENV_COUNT}"

check "the workflow prepares SSH at least once" test "${PREPARE_COUNT}" -ge 1
check "the optional port secret is in scope at every SSH preparation site" \
  test "${PORT_ENV_COUNT}" -ge "${PREPARE_COUNT}"

check_not "no appleboy ssh/scp action remains in the workflow" \
  grep -qE 'uses: appleboy/(ssh|scp)-action@' "${WORKFLOW}"

# Both jobs are covered: the deploy job AND the teardown job.
DEPLOY_JOB_REMOTE="$(awk '/^  deploy:/{f=1} /^  teardown:/{f=0} f' "${WORKFLOW}" \
  | grep -cE "${PREPARE_PORT_LINE}")"
TEARDOWN_JOB_REMOTE="$(awk '/^  teardown:/{f=1} f' "${WORKFLOW}" \
  | grep -cE "${PREPARE_PORT_LINE}")"
printf -- '-- optional-port env by job — deploy: %s, teardown: %s\n' "${DEPLOY_JOB_REMOTE}" "${TEARDOWN_JOB_REMOTE}"
check "deploy job's SSH preparation receives the optional port secret" \
  test "${DEPLOY_JOB_REMOTE}" -ge 1
check "teardown job's SSH preparation receives the optional port secret" \
  test "${TEARDOWN_JOB_REMOTE}" -ge 1

# Unset ⇒ 22 in both helpers, so leaving the secret unset keeps the historical
# behaviour exactly (the deploy ran on port 22 before the port was configurable).
check "remote-ssh.sh defaults the port to 22 when the secret is unset" \
  grep -qF '${PREVIEW_SSH_PORT:-22}' "${SCRIPT_DIR}/remote-ssh.sh"
check "remote-scp.sh defaults the port to 22 when the secret is unset" \
  grep -qF '${PREVIEW_SSH_PORT:-22}' "${SCRIPT_DIR}/remote-scp.sh"

# ── 2. Workflow: port secret plumbed into the provision step env ──────────
check "Bootstrap VPS step env exports the optional port secret" \
  grep -qE '^[[:space:]]+PREVIEW_VPS_SSH_PORT: \$\{\{ secrets\.PREVIEW_VPS_SSH_PORT \}\}[[:space:]]*$' "${WORKFLOW}"

check "Bootstrap VPS step still runs infra/preview-vps/provision.sh" \
  grep -qE 'bash infra/preview-vps/provision\.sh' "${WORKFLOW}"

# ── 3. Workflow: the secret guard must NOT require the optional port ──────
# Extract the guard step body (from its `- name:` to the next step) and
# assert the optional secret is not part of the required-secret test.
GUARD_BLOCK="$(awk '
  /^      - name: / { if (started) exit }
  /- name: Check preview VPS secrets/ { started = 1 }
  started { print }
' "${WORKFLOW}")"

check "found the 'Check preview VPS secrets' guard step" test -n "${GUARD_BLOCK}"

# Invoked indirectly through check/check_not.
# shellcheck disable=SC2329
guard_block_matches() { grep -qE -- "$1" <<<"${GUARD_BLOCK}"; }

check_not "secrets guard does not require the optional port secret" \
  guard_block_matches 'PREVIEW_VPS_SSH_PORT'
check "secrets guard still checks the required secrets" \
  guard_block_matches 'PREVIEW_VPS_HOST|PREVIEW_VPS_USER|PREVIEW_VPS_SSH_KEY'

check "secrets guard comment says the port is not checked there" \
  grep -qE 'PREVIEW_VPS_SSH_PORT is NOT checked here on purpose' "${WORKFLOW}"
check "secrets guard comment states the 22 default" \
  grep -qE 'and defaults to 22' "${WORKFLOW}"

check "workflow header comment documents the optional port secret" \
  grep -qE 'OPTIONAL repository secret' "${WORKFLOW}"

# ── 4. provision.sh: default is 22 (unset AND empty) ──────────────────────
check "provision.sh takes the port from the optional secret with a ::- 22 default" \
  grep -qE '\$\{PREVIEW_VPS_SSH_PORT:-22\}' "${PROVISION}"

# Single-quoted on purpose: these are regex literals, not shell expansions.
# shellcheck disable=SC2016
check "provision.sh treats an empty port as 22" \
  grep -qE '\[ -z "\$PORT" \] && PORT=22' "${PROVISION}"

check "provision.sh assigns PORT at top level" \
  grep -qE '^PORT=' "${PROVISION}"

# ── 5. provision.sh: the port is used by keyscan, ssh and scp ─────────────
check "provision.sh keyscan passes the port" \
  grep -qE 'ssh-keyscan -T 10 -p "\$\{PORT\}" -t ed25519 "\$\{HOST\}"' "${PROVISION}"

check "provision.sh SSH_BASE carries the port" \
  grep -qE '^SSH_BASE=\(ssh .*-p "\$\{PORT\}" .*\)' "${PROVISION}"

# scp takes the port as UPPERCASE -P; lowercase -p means "preserve mtime".
check "provision.sh SCP_BASE carries the port as uppercase -P" \
  grep -qE '^SCP_BASE=\(scp .*-P "\$\{PORT\}" .*\)' "${PROVISION}"

check_not "provision.sh SCP_BASE does not use lowercase -p (that is scp mtime preserve)" \
  grep -qE '^SCP_BASE=\(scp [^)]*[[:space:]]-p "\$\{PORT\}"' "${PROVISION}"

# ── 6. Regression guards: host-key pinning is unchanged ───────────────────
# Comment lines are excluded: the header text deliberately names the option
# it refuses to use ("no StrictHostKeyChecking=no").
NO_STRICT="$(grep -hE 'StrictHostKeyChecking=no' "${WORKFLOW}" "${PROVISION}" \
  | grep -vE '^[[:space:]]*#' || true)"
check "no active (non-comment) StrictHostKeyChecking=no in either file" test -z "${NO_STRICT}"

check "SSH_BASE still pins StrictHostKeyChecking=yes + ssh-ed25519" \
  grep -qE 'SSH_BASE=\(ssh .*-o StrictHostKeyChecking=yes .*-o HostKeyAlgorithms=ssh-ed25519' "${PROVISION}"

check "SCP_BASE still pins StrictHostKeyChecking=yes + ssh-ed25519" \
  grep -qE 'SCP_BASE=\(scp .*-o StrictHostKeyChecking=yes .*-o HostKeyAlgorithms=ssh-ed25519' "${PROVISION}"

check "provision.sh still compares the scanned fingerprint to the pinned secret" \
  grep -qE '\[ "\$\{ACTUAL_FP\}" != "\$\{FINGERPRINT\}" \]' "${PROVISION}"

# ── 7. Regression guard: the ssh-keyscan COMMENT line must be skipped ─────
# ssh-keyscan prints `# <host>:<port> SSH-2.0-<banner>` BEFORE the key line.
# Feeding that straight into `head -n 1` therefore captures the comment,
# ssh-keygen cannot parse it, ACTUAL_FP ends up empty, and provision.sh aborts
# with a bogus "FATAL: host key fingerprint mismatch" even when the pinned
# secret is exactly right -- every deploy fails and the error wrongly blames
# the secret. Guarded twice: statically here, behaviourally in section 8.
check_not "provision.sh never feeds ssh-keyscan straight into head -n 1" \
  grep -qE 'ssh-keyscan[^|]*\|[[:space:]]*head -n 1' "${PROVISION}"

check "provision.sh selects the first non-comment known_hosts record" \
  grep -qF "awk 'NF >= 3 && \$1 !~ /^#/ { print; exit }'" "${PROVISION}"

check "provision.sh aborts when no fingerprint can be parsed" \
  grep -qF 'could not read a SHA256 fingerprint from the scanned host key' "${PROVISION}"

# ── 8. Behavioural: same input, with and without the guard ────────────────
# Build a REAL ed25519 key, synthesise the exact two-line stdout ssh-keyscan
# produces, and run the selection provision.sh performs. Proves the bug is
# real (head -n 1 yields the comment) and that the guard returns the key.
_tmp="$(mktemp -d)"
trap 'rm -rf "${_tmp}"' EXIT
ssh-keygen -q -t ed25519 -N '' -C 'preview-port-test' -f "${_tmp}/k" >/dev/null 2>&1
_pub="$(cat "${_tmp}/k.pub")"
_scan="$(printf '# 203.0.113.9:22 SSH-2.0-OpenSSH_10.0p2 Debian-7+deb13u4\n%s\n' "${_pub}")"
_selected="$(printf '%s\n' "${_scan}" | awk 'NF >= 3 && $1 !~ /^#/ { print; exit }')"
_fp="$(printf '%s\n' "${_selected}" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}')"
_want="$(ssh-keygen -lf "${_tmp}/k.pub" | awk '{print $2}')"

check "head -n 1 captures the comment line on real ssh-keyscan output" \
  grep -q '^#' <<<"$(printf '%s\n' "${_scan}" | head -n 1)"
check "the guard selects the key line, not the comment" \
  test "${_selected}" = "${_pub}"
check "the selected key line yields a SHA256 fingerprint" \
  test -n "${_fp}"
check "that fingerprint matches the key it came from" \
  test "${_fp}" = "${_want}"

printf '\n%s checks, %s failure(s)\n' "${CHECKS}" "${FAILURES}"
if [ "${FAILURES}" -ne 0 ]; then
  printf 'RESULT: FAIL\n'
  exit 1
fi
printf 'RESULT: PASS\n'
exit 0
