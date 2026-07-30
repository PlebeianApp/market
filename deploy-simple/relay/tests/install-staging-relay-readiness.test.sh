#!/usr/bin/env bash

set -euo pipefail

readonly TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly INSTALLER="${TEST_DIR}/../install-staging-relay.sh"

export RELAY_READINESS_SECONDS=10
# shellcheck source=../install-staging-relay.sh
source "$INSTALLER"

TESTS_RUN=0
OUTPUT=""
STATUS=0

reset_state() {
	FAKE_NOW=0
	HEALTH_CALLS=0
	HEALTH_SUCCEEDS_AT=2
	HEALTH_ADVANCE_SECONDS=0
	PID_VALUE=200
	INVOCATION_VALUE="invocation-a"
	EXPECTED_SHA="expected-sha"
	BOOT_VALUE="boot-a"
	PRE_BOOT_ID="$BOOT_VALUE"
	PRE_BINARY_SHA="$EXPECTED_SHA"
	PRE_UNIT_SHA="unit-sha"
	PID_DRIFT_AT=999999
	INVOCATION_DRIFT_AT=999999
	HASH_MISMATCH_AT=999999
	RESTARTS_NONZERO_AT=999999
	BOOT_DRIFT_AT=999999
	RAW_BASE=1000
	SEARCH_BASE=2000
	FREE_BASE=$((MIN_FREE + MAX_FREE_LOSS + 1024))
	RAW_GROWTH_AT=999999
	RAW_GROWTH=0
	SEARCH_GROWTH_AT=999999
	SEARCH_GROWTH=0
	FREE_DROP_AT=999999
	FREE_DROP=0
	SERVICE_STOPPED=0
	STOP_FAIL=0
	INSTALL_FAIL=0
	RESTART_FAIL=0
	SERVICE_JOURNAL=""
	KERNEL_JOURNAL=""
	SERVICE_JOURNAL_FAIL=0
	KERNEL_JOURNAL_FAIL=0
}

boot_id() {
	((FAKE_NOW >= BOOT_DRIFT_AT)) && printf '%s\n' "boot-b" || printf '%s\n' "$BOOT_VALUE"
}

readiness_now() {
	printf '%s\n' "$FAKE_NOW"
}

readiness_sleep() {
	FAKE_NOW=$((FAKE_NOW + $1))
}

property() {
	case "$1" in
		ActiveState) ((SERVICE_STOPPED == 1)) && printf '%s\n' "inactive" || printf '%s\n' "active" ;;
		SubState) ((SERVICE_STOPPED == 1)) && printf '%s\n' "dead" || printf '%s\n' "running" ;;
		MainPID) ((FAKE_NOW >= PID_DRIFT_AT)) && printf '%s\n' "$((PID_VALUE + 1))" || printf '%s\n' "$PID_VALUE" ;;
		InvocationID) ((FAKE_NOW >= INVOCATION_DRIFT_AT)) && printf '%s\n' "invocation-b" || printf '%s\n' "$INVOCATION_VALUE" ;;
		NRestarts) ((FAKE_NOW >= RESTARTS_NONZERO_AT)) && printf '%s\n' "1" || printf '%s\n' "0" ;;
		FragmentPath) printf '%s\n' "$REMOTE_SERVICE" ;;
		NeedDaemonReload) printf '%s\n' "no" ;;
		DropInPaths) printf '%s' "" ;;
		*) echo "Unexpected property in test: $1" >&2; return 1 ;;
	esac
}

hash_file() {
	if [[ "$1" == "$REMOTE_SERVICE" ]]; then
		printf '%s\n' "$PRE_UNIT_SHA"
	elif ((FAKE_NOW >= HASH_MISMATCH_AT)); then
		printf '%s\n' "wrong-sha"
	else
		printf '%s\n' "$EXPECTED_SHA"
	fi
}

allocated() {
	case "$1" in
		"$RAW_DIR")
			((FAKE_NOW >= RAW_GROWTH_AT)) && printf '%s\n' "$((RAW_BASE + RAW_GROWTH))" || printf '%s\n' "$RAW_BASE"
			;;
		"$SEARCH_DIR")
			((FAKE_NOW >= SEARCH_GROWTH_AT)) && printf '%s\n' "$((SEARCH_BASE + SEARCH_GROWTH))" || printf '%s\n' "$SEARCH_BASE"
			;;
		*) echo "Unexpected allocation path in test: $1" >&2; return 1 ;;
	esac
}

free_bytes() {
	((FAKE_NOW >= FREE_DROP_AT)) && printf '%s\n' "$((FREE_BASE - FREE_DROP))" || printf '%s\n' "$FREE_BASE"
}

local_health() {
	HEALTH_CALLS=$((HEALTH_CALLS + 1))
	FAKE_NOW=$((FAKE_NOW + HEALTH_ADVANCE_SECONDS))
	((HEALTH_CALLS >= HEALTH_SUCCEEDS_AT))
}

sudo() {
	case "$1:$2" in
		systemctl:stop) ((STOP_FAIL == 0)) || return 1; SERVICE_STOPPED=1 ;;
		systemctl:restart) ((RESTART_FAIL == 0)) || return 1; SERVICE_STOPPED=0 ;;
		systemctl:daemon-reload|systemctl:status) ;;
		journalctl:-u)
			((SERVICE_JOURNAL_FAIL == 0)) || return 1
			printf '%s' "$SERVICE_JOURNAL"
			;;
		journalctl:-k)
			((KERNEL_JOURNAL_FAIL == 0)) || return 1
			printf '%s' "$KERNEL_JOURNAL"
			;;
		install:*) ((INSTALL_FAIL == 0)) || return 1 ;;
		*) echo "Unexpected sudo command in test: $*" >&2; return 1 ;;
	esac
}

capture() {
	set +e
	OUTPUT="$("$@" 2>&1)"
	STATUS=$?
	set -e
}

assert_result() {
	local expected_status="$1" expected_output="$2"
	[[ "$STATUS" == "$expected_status" ]] || {
		printf 'Expected status %s, got %s\nOutput:\n%s\n' "$expected_status" "$STATUS" "$OUTPUT" >&2
		return 1
	}
	[[ -z "$expected_output" || "$OUTPUT" == *"$expected_output"* ]] || {
		printf 'Expected output containing: %s\nActual output:\n%s\n' "$expected_output" "$OUTPUT" >&2
		return 1
	}
}

run_test() {
	local name="$1"
	shift
	TESTS_RUN=$((TESTS_RUN + 1))
	if "$@"; then
		printf 'ok %s - %s\n' "$TESTS_RUN" "$name"
	else
		printf 'not ok %s - %s\n' "$TESTS_RUN" "$name" >&2
		return 1
	fi
}

run_wait() {
	wait_for_readiness "Test" "$PID_VALUE" "$INVOCATION_VALUE" "$EXPECTED_SHA" \
		"$RAW_BASE" "$SEARCH_BASE" "$FREE_BASE"
}

readiness_case() {
	local setup="$1" expected_status="$2" expected_output="$3"
	reset_state
	"$setup"
	capture run_wait
	assert_result "$expected_status" "$expected_output"
}

setup_delayed_success() { HEALTH_SUCCEEDS_AT=2; }
setup_timeout() { HEALTH_SUCCEEDS_AT=999999; }
setup_pid_drift() { setup_timeout; PID_DRIFT_AT=5; }
setup_invocation_drift() { setup_timeout; INVOCATION_DRIFT_AT=5; }
setup_hash_mismatch() { setup_timeout; HASH_MISMATCH_AT=5; }
setup_restart_drift() { setup_timeout; RESTARTS_NONZERO_AT=5; }
setup_boot_drift() { setup_timeout; BOOT_DRIFT_AT=5; }
setup_growth_failure() { setup_timeout; RAW_GROWTH_AT=5; RAW_GROWTH=$((MAX_RAW_GROWTH + 1)); }
setup_search_growth_failure() { setup_timeout; SEARCH_GROWTH_AT=5; SEARCH_GROWTH=$((MAX_SEARCH_GROWTH + 1)); }
setup_free_loss_failure() { setup_timeout; FREE_DROP_AT=5; FREE_DROP=$((MAX_FREE_LOSS + 1)); }
setup_free_failure() { setup_timeout; FREE_BASE=$((MIN_FREE + 1)); FREE_DROP_AT=5; FREE_DROP=2; }
setup_late_health_success() { HEALTH_SUCCEEDS_AT=1; HEALTH_ADVANCE_SECONDS=11; }
setup_post_health_pid_drift() { HEALTH_SUCCEEDS_AT=1; HEALTH_ADVANCE_SECONDS=5; PID_DRIFT_AT=5; }
setup_post_health_growth() { HEALTH_SUCCEEDS_AT=1; HEALTH_ADVANCE_SECONDS=5; RAW_GROWTH_AT=5; RAW_GROWTH=$((MAX_RAW_GROWTH + 1)); }

rollback_case() {
	local setup="$1" expected_status="$2" expected_output="$3"
	reset_state
	"$setup"
	capture rollback
	assert_result "$expected_status" "$expected_output"
}

setup_rollback_success() { HEALTH_SUCCEEDS_AT=2; }
setup_rollback_timeout() { HEALTH_SUCCEEDS_AT=999999; }
setup_rollback_structural_failure() { STOP_FAIL=1; }
setup_rollback_restart_evidence() { setup_rollback_success; SERVICE_JOURNAL="automatic restarting"; }
setup_rollback_oom_evidence() { setup_rollback_success; KERNEL_JOURNAL="oom-kill"; }
setup_rollback_journal_failure() { setup_rollback_success; SERVICE_JOURNAL_FAIL=1; }
setup_rollback_timeout_with_restart_evidence() { setup_rollback_timeout; SERVICE_JOURNAL="restart counter is at 1"; }

journal_case() {
	local setup="$1" expected_status="$2" expected_output="$3"
	reset_state
	"$setup"
	capture check_journal_window "Test journal" 123
	assert_result "$expected_status" "$expected_output"
}

setup_clean_journal() { :; }
setup_restart_journal() { SERVICE_JOURNAL="Scheduled restart job, restart counter is at 1"; }
setup_oom_journal() { KERNEL_JOURNAL="Out of memory: Killed process 123"; }
setup_service_journal_failure() { SERVICE_JOURNAL_FAIL=1; }
setup_kernel_journal_failure() { KERNEL_JOURNAL_FAIL=1; }

test_readiness_configuration_validation() {
	capture env RELAY_READINESS_SECONDS=invalid bash "$INSTALLER" /nonexistent
	assert_result 1 "readiness deadline must be a positive integer"
}

test_readiness_wiring() {
	local activation_epoch_line activation_restart_line activation_readiness_line
	local observe_baseline_line observe_line rollback_epoch_line rollback_restart_line
	local rollback_readiness_line rollback_journal_line

	! grep -Eq '^[[:space:]]*sleep[[:space:]]+5([[:space:]]|$)' "$INSTALLER" || {
		echo "installer still contains a fixed five-second readiness sleep" >&2
		return 1
	}
	grep -Fq 'if wait_for_readiness "Rollback"' "$INSTALLER" || {
		echo "rollback does not use the shared readiness gate" >&2
		return 1
	}

	activation_epoch_line="$(grep -nF 'activation_epoch="$(date +%s)"' "$INSTALLER" | cut -d: -f1)"
	activation_restart_line="$(grep -nF 'sudo systemctl restart "$SERVICE_NAME"' "$INSTALLER" | tail -n 1 | cut -d: -f1)"
	activation_readiness_line="$(grep -nF 'wait_for_readiness "Activation"' "$INSTALLER" | cut -d: -f1)"
	observe_baseline_line="$(grep -nF 'observe_raw_before="$(allocated "$RAW_DIR")"' "$INSTALLER" | cut -d: -f1)"
	observe_line="$(grep -nF 'observe "$activation_epoch"' "$INSTALLER" | cut -d: -f1)"
	uint "$activation_epoch_line" && uint "$activation_restart_line" && uint "$activation_readiness_line" && \
		uint "$observe_baseline_line" && uint "$observe_line" && \
		((activation_epoch_line < activation_restart_line && \
			activation_restart_line < activation_readiness_line && \
			activation_readiness_line < observe_baseline_line && \
			observe_baseline_line < observe_line)) || {
		echo "activation journal epoch, readiness, storage reset, and observation ordering is invalid" >&2
		return 1
	}

	rollback_epoch_line="$(grep -nF 'rollback_epoch="$(date +%s)"' "$INSTALLER" | cut -d: -f1)"
	rollback_restart_line="$(grep -nF 'sudo systemctl restart "$SERVICE_NAME"' "$INSTALLER" | head -n 1 | cut -d: -f1)"
	rollback_readiness_line="$(grep -nF 'if wait_for_readiness "Rollback"' "$INSTALLER" | cut -d: -f1)"
	rollback_journal_line="$(grep -nF 'check_journal_window "Rollback" "$rollback_epoch"' "$INSTALLER" | cut -d: -f1)"
	uint "$rollback_epoch_line" && uint "$rollback_restart_line" && uint "$rollback_readiness_line" && \
		uint "$rollback_journal_line" && \
		((rollback_epoch_line < rollback_restart_line && \
			rollback_restart_line < rollback_readiness_line && \
			rollback_readiness_line < rollback_journal_line)) || {
		echo "rollback journal epoch, restart, readiness, and journal ordering is invalid" >&2
		return 1
	}
}

test_rollback_status_not_negated() {
	! grep -Fq 'if ! rollback' "$INSTALLER" || {
		echo "rollback status is destroyed by logical negation" >&2
		return 1
	}
}

invoke_failed_exit() {
	return "$ORIGINAL_STATUS"
}

invoke_failed_exit_and_handle() {
	invoke_failed_exit
	on_exit
}

install_rollback_stub() {
	rollback() { return "$ROLLBACK_STUB_STATUS"; }
}

on_exit_case() {
	local original_status="$1" rollback_status="$2" expected_status="$3" retain="$4" expected_output="$5"
	reset_state
	install_rollback_stub
	ORIGINAL_STATUS="$original_status"
	ROLLBACK_STUB_STATUS="$rollback_status"
	BACKUP_DIR="$(mktemp -d)"
	FILES_CHANGED=1
	DEPLOY_COMPLETE=0
	capture invoke_failed_exit_and_handle
	assert_result "$expected_status" "$expected_output" || return 1
	if ((retain == 1)); then
		[[ -d "$BACKUP_DIR" ]] || { echo "expected rollback backup retention" >&2; return 1; }
		rm -rf "$BACKUP_DIR"
	else
		[[ ! -e "$BACKUP_DIR" ]] || { echo "expected rollback backup cleanup" >&2; return 1; }
	fi
}

run_test "delayed readiness then success" readiness_case setup_delayed_success 0 "readiness confirmed"
run_test "permanent readiness timeout" readiness_case setup_timeout "$READINESS_TIMEOUT_STATUS" "not confirmed within 10 seconds"
run_test "PID drift" readiness_case setup_pid_drift 1 "MainPID changed"
run_test "InvocationID drift" readiness_case setup_invocation_drift 1 "InvocationID changed"
run_test "executable hash mismatch" readiness_case setup_hash_mismatch 1 "running binary hash does not match expected"
run_test "NRestarts becoming nonzero" readiness_case setup_restart_drift 1 "NRestarts is nonzero"
run_test "boot ID drift" readiness_case setup_boot_drift 1 "boot ID changed"
run_test "raw storage-growth failure" readiness_case setup_growth_failure 1 "raw allocation exceeded the emergency growth gate"
run_test "search storage-growth failure" readiness_case setup_search_growth_failure 1 "search allocation exceeded the emergency growth gate"
run_test "free-space-loss failure above minimum" readiness_case setup_free_loss_failure 1 "free-space loss exceeded the emergency growth gate"
run_test "minimum free-space failure" readiness_case setup_free_failure 1 "fell below the minimum free-space gate"
run_test "health success after deadline" readiness_case setup_late_health_success "$READINESS_TIMEOUT_STATUS" "not confirmed within 10 seconds"
run_test "post-health identity recheck" readiness_case setup_post_health_pid_drift 1 "MainPID changed"
run_test "post-health storage recheck" readiness_case setup_post_health_growth 1 "raw allocation exceeded the emergency growth gate"
run_test "clean journal window" journal_case setup_clean_journal 0 ""
run_test "startup restart evidence" journal_case setup_restart_journal 1 "automatic relay restart evidence found"
run_test "startup kernel OOM evidence" journal_case setup_oom_journal 1 "kernel OOM evidence found"
run_test "service journal failure is closed" journal_case setup_service_journal_failure 1 "unable to read relay service journal"
run_test "kernel journal failure is closed" journal_case setup_kernel_journal_failure 1 "unable to read kernel journal"
run_test "successful rollback readiness" rollback_case setup_rollback_success 0 "restoration and readiness succeeded"
run_test "restored process with rollback-readiness timeout" rollback_case setup_rollback_timeout "$READINESS_TIMEOUT_STATUS" "files and process were restored"
run_test "structural rollback failure" rollback_case setup_rollback_structural_failure 1 "Unable to stop failed staging relay"
run_test "rollback restart evidence is structural" rollback_case setup_rollback_restart_evidence 1 "automatic relay restart evidence found"
run_test "rollback OOM evidence is structural" rollback_case setup_rollback_oom_evidence 1 "kernel OOM evidence found"
run_test "rollback journal failure is structural" rollback_case setup_rollback_journal_failure 1 "unable to read relay service journal"
run_test "rollback timeout with restart evidence is structural" rollback_case setup_rollback_timeout_with_restart_evidence 1 "automatic relay restart evidence found"
run_test "readiness configuration validation" test_readiness_configuration_validation
run_test "readiness and journal wiring" test_readiness_wiring
run_test "rollback status is preserved" test_rollback_status_not_negated
run_test "successful rollback cleanup classification" on_exit_case 1 0 1 0 ""
run_test "successful rollback preserves arbitrary original status" on_exit_case 42 0 42 0 ""
run_test "rollback timeout retention classification" on_exit_case 1 "$READINESS_TIMEOUT_STATUS" "$READINESS_TIMEOUT_STATUS" 1 "health was not confirmed"
run_test "structural rollback retention classification" on_exit_case 1 1 70 1 "structurally failed"

printf '1..%s\n' "$TESTS_RUN"
