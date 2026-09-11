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

# The exact expression every appleboy step must pass as its `port:` input.
PORT_LINE_RE='^[[:space:]]*port: \$\{\{ secrets\.PREVIEW_VPS_SSH_PORT \|\| 22 \}\}[[:space:]]*$'

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

# ── 1. Workflow: every appleboy ssh/scp step gets a port: input ───────────
APPLEBOY_COUNT="$(grep -cE 'uses: appleboy/(ssh|scp)-action@' "${WORKFLOW}")"
PORT_COUNT="$(grep -cE "${PORT_LINE_RE}" "${WORKFLOW}")"

printf -- '-- appleboy ssh-action + scp-action uses: %s\n' "${APPLEBOY_COUNT}"
printf -- '-- port inputs of the form "<optional secret> || 22": %s\n' "${PORT_COUNT}"

check "workflow uses at least one appleboy ssh/scp action" test "${APPLEBOY_COUNT}" -gt 0
check "port-input count equals appleboy action use count" test "${APPLEBOY_COUNT}" -eq "${PORT_COUNT}"

# Every appleboy block must contain the port line before the next step
# boundary (the next `uses:` or `- name:`).
MISSING_BLOCKS="$(
  awk '
    /uses: appleboy\/(ssh|scp)-action@/ {
      if (needport && !have) { print "line " start_line }
      needport = 1; have = 0; start_line = NR; next
    }
    /^[[:space:]]*(- name:|uses: )/ {
      if (needport && !have) { print "line " start_line }
      needport = 0
    }
    /^[[:space:]]*port: \$\{\{ secrets\.PREVIEW_VPS_SSH_PORT \|\| 22 \}\}[[:space:]]*$/ {
      if (needport) have = 1
    }
    END { if (needport && !have) print "line " start_line }
  ' "${WORKFLOW}"
)"
printf -- '-- appleboy steps missing a port input: %s\n' "${MISSING_BLOCKS:-none}"
check "every appleboy ssh/scp step passes a port input" test -z "${MISSING_BLOCKS}"

# Both jobs are covered: the deploy job AND the teardown job.
DEPLOY_JOB_REMOTE="$(awk '/^  deploy:/{f=1} /^  teardown:/{f=0} f' "${WORKFLOW}" \
  | grep -cE 'port: \$\{\{ secrets\.PREVIEW_VPS_SSH_PORT \|\| 22 \}\}')"
TEARDOWN_JOB_REMOTE="$(awk '/^  teardown:/{f=1} f' "${WORKFLOW}" \
  | grep -cE 'port: \$\{\{ secrets\.PREVIEW_VPS_SSH_PORT \|\| 22 \}\}')"
printf -- '-- port inputs by job — deploy: %s, teardown: %s\n' "${DEPLOY_JOB_REMOTE}" "${TEARDOWN_JOB_REMOTE}"
check "deploy job remote steps pass a port input" test "${DEPLOY_JOB_REMOTE}" -ge 1
check "teardown job remote steps pass a port input" test "${TEARDOWN_JOB_REMOTE}" -ge 1

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

printf '\n%s checks, %s failure(s)\n' "${CHECKS}" "${FAILURES}"
if [ "${FAILURES}" -ne 0 ]; then
  printf 'RESULT: FAIL\n'
  exit 1
fi
printf 'RESULT: PASS\n'
exit 0
