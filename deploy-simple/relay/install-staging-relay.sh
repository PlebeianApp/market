#!/usr/bin/env bash

set -euo pipefail
umask 077

PAYLOAD_DIR="${1:-$HOME/relay-deploy}"

readonly SERVICE_NAME="market-relay.service"
readonly REMOTE_BIN="/usr/local/bin/market-relay"
readonly REMOTE_ENV="/etc/market-relay.env"
readonly REMOTE_SERVICE="/etc/systemd/system/market-relay.service"

# Staging contract. The live environment file is separately managed and is
# never read, copied, printed, hashed, or replaced by this script.
readonly SERVICE_USER="deployer"
readonly SERVICE_GROUP="deployer"
readonly DATA_DIR="/var/lib/market-relay"
readonly RAW_DIR="/var/lib/market-relay/raw"
readonly SEARCH_DIR="/var/lib/market-relay/search"
readonly LISTEN_ADDR="127.0.0.1:10549"

# Emergency one-minute gates, not long-term storage limits.
readonly MIN_FREE=$((2 * 1024 * 1024 * 1024))
readonly OBSERVE_SECONDS=60
readonly SAMPLE_SECONDS=5
readonly MAX_RAW_GROWTH=$((16 * 1024 * 1024))
readonly MAX_SEARCH_GROWTH=$((64 * 1024 * 1024))
readonly MAX_FREE_LOSS=$((96 * 1024 * 1024))

readonly SOURCE_BIN="${PAYLOAD_DIR}/market-relay"
readonly SOURCE_UNIT="${PAYLOAD_DIR}/market-relay.service"

BACKUP_DIR=""
FILES_CHANGED=0
DEPLOY_COMPLETE=0
PRE_PID=""
PRE_INVOCATION=""
PRE_BOOT_ID=""
PRE_BINARY_SHA=""
PRE_RUNNING_SHA=""
PRE_UNIT_SHA=""

for path in "$SOURCE_BIN" "$SOURCE_UNIT"; do
	[[ -f "$path" && ! -L "$path" ]] || {
		echo "Missing or unsafe deploy artifact: $path"
		exit 1
	}
done

grep -Fxq "User=${SERVICE_USER}" "$SOURCE_UNIT" &&
	grep -Fxq "Group=${SERVICE_GROUP}" "$SOURCE_UNIT" &&
	grep -Fxq "EnvironmentFile=${REMOTE_ENV}" "$SOURCE_UNIT" &&
	grep -Fxq "ExecStart=${REMOTE_BIN}" "$SOURCE_UNIT" || {
	echo "Staged systemd unit does not match the staging deployment contract"
	exit 1
}

uint() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
}

property() {
	sudo systemctl show "$SERVICE_NAME" --property="$1" --value
}

hash_file() {
	sudo sha256sum -- "$1" | awk '{print $1}'
}

allocated() {
	sudo du -sx -B1 -- "$1" | awk '{print $1}'
}

free_bytes() {
	df --output=avail -B1 -- "$DATA_DIR" |
		awk 'NR == 2 {gsub(/[[:space:]]/, "", $1); print $1}'
}

positive_delta() {
	local delta=$(( $1 - $2 ))
	((delta < 0)) && delta=0
	printf '%s\n' "$delta"
}

local_health() {
	curl --connect-timeout 3 --max-time 5 -fsS \
		-H 'Accept: application/nostr+json' \
		"http://${LISTEN_ADDR}/" >/dev/null
}

require_directory() {
	local path="$1"
	sudo test -d "$path" || {
		echo "Required staging relay data directory is missing: $path"
		return 1
	}
	sudo test ! -L "$path" || {
		echo "Staging relay data directory must not be a symlink: $path"
		return 1
	}
	[[ "$(sudo stat -c '%U:%G' -- "$path")" == "${SERVICE_USER}:${SERVICE_GROUP}" ]] || {
		echo "Unexpected owner for staging relay data directory: $path"
		return 1
	}
}

preflight() {
	local active substate enabled user group restarts raw search free env_mode env_mode_value
	local fragment_path need_daemon_reload drop_in_paths

	active="$(property ActiveState)"
	substate="$(property SubState)"
	enabled="$(property UnitFileState)"
	user="$(property User)"
	group="$(property Group)"
	PRE_PID="$(property MainPID)"
	restarts="$(property NRestarts)"
	PRE_INVOCATION="$(property InvocationID)"
	PRE_BOOT_ID="$(cat /proc/sys/kernel/random/boot_id)"

	[[ "$active" == "active" && "$substate" == "running" ]] || {
		echo "Staging relay must be active/running before activation"
		return 1
	}
	[[ "$enabled" == "enabled" ]] || {
		echo "Staging relay unit must already be enabled"
		return 1
	}
	[[ "$user" == "$SERVICE_USER" && "$group" == "$SERVICE_GROUP" ]] || {
		echo "Unexpected staging relay service user/group"
		return 1
	}
	uint "$PRE_PID" && ((PRE_PID > 0)) || {
		echo "Staging relay has no valid MainPID before activation"
		return 1
	}
	uint "$restarts" && ((restarts == 0)) || {
		echo "Staging relay NRestarts is not zero before activation"
		return 1
	}
	[[ -n "$PRE_INVOCATION" ]] || {
		echo "Staging relay has no InvocationID before activation"
		return 1
	}
	fragment_path="$(property FragmentPath)"
	need_daemon_reload="$(property NeedDaemonReload)"
	drop_in_paths="$(property DropInPaths)"
	[[ "$fragment_path" == "$REMOTE_SERVICE" ]] || {
		echo "Loaded staging relay unit does not originate from ${REMOTE_SERVICE}"
		return 1
	}
	[[ "$need_daemon_reload" == "no" ]] || {
		echo "Staging relay unit has pending on-disk changes"
		return 1
	}
	[[ -z "$drop_in_paths" ]] || {
		echo "Staging relay unit has unsupported systemd drop-ins: $drop_in_paths"
		return 1
	}

	for path in "$REMOTE_BIN" "$REMOTE_SERVICE" "$REMOTE_ENV"; do
		sudo test -f "$path" || {
			echo "Required staging relay file is missing: $path"
			return 1
		}
		sudo test ! -L "$path" || {
			echo "Staging relay file must not be a symlink: $path"
			return 1
		}
	done
	[[ "$(sudo stat -c '%U:%G' -- "$REMOTE_BIN")" == "root:root" ]] || {
		echo "Unexpected owner for existing staging relay binary"
		return 1
	}
	[[ "$(sudo stat -c '%a' -- "$REMOTE_BIN")" == "755" ]] || {
		echo "Unexpected mode for existing staging relay binary"
		return 1
	}
	[[ "$(sudo stat -c '%U:%G' -- "$REMOTE_SERVICE")" == "root:root" ]] || {
		echo "Unexpected owner for existing staging relay unit"
		return 1
	}
	[[ "$(sudo stat -c '%a' -- "$REMOTE_SERVICE")" == "644" ]] || {
		echo "Unexpected mode for existing staging relay unit"
		return 1
	}
	[[ "$(sudo stat -c '%U:%G' -- "$REMOTE_ENV")" == "root:root" ]] || {
		echo "Unexpected owner for existing staging environment file"
		return 1
	}
	sudo grep -Fxq "User=${SERVICE_USER}" "$REMOTE_SERVICE" &&
		sudo grep -Fxq "Group=${SERVICE_GROUP}" "$REMOTE_SERVICE" &&
		sudo grep -Fxq "EnvironmentFile=${REMOTE_ENV}" "$REMOTE_SERVICE" &&
		sudo grep -Fxq "ExecStart=${REMOTE_BIN}" "$REMOTE_SERVICE" || {
		echo "Existing staging unit does not match the loaded service contract"
		return 1
	}
	env_mode="$(sudo stat -c '%a' -- "$REMOTE_ENV")"
	uint "$env_mode" || {
		echo "Unable to read staging environment file mode"
		return 1
	}
	env_mode_value=$((8#$env_mode))
	(( (env_mode_value & 8#022) == 0 )) || {
		echo "Staging environment file must not be group/world writable"
		return 1
	}

	require_directory "$DATA_DIR"
	require_directory "$RAW_DIR"
	require_directory "$SEARCH_DIR"
	local_health

	raw="$(allocated "$RAW_DIR")"
	search="$(allocated "$SEARCH_DIR")"
	free="$(free_bytes)"
	uint "$raw" && uint "$search" && uint "$free" || {
		echo "Unable to read numeric staging storage metrics"
		return 1
	}
	((free >= MIN_FREE)) || {
		echo "Staging relay data filesystem is below the minimum free-space gate"
		return 1
	}

	PRE_BINARY_SHA="$(hash_file "$REMOTE_BIN")"
	PRE_RUNNING_SHA="$(hash_file "/proc/${PRE_PID}/exe")"
	PRE_UNIT_SHA="$(hash_file "$REMOTE_SERVICE")"
	[[ "$PRE_RUNNING_SHA" == "$PRE_BINARY_SHA" ]] || {
		echo "Running staging relay does not match the on-disk rollback binary"
		return 1
	}

	printf 'pre_boot_id=%s\n' "$PRE_BOOT_ID"
	printf 'pre_active_state=%s\n' "$active"
	printf 'pre_sub_state=%s\n' "$substate"
	printf 'pre_main_pid=%s\n' "$PRE_PID"
	printf 'pre_invocation_id=%s\n' "$PRE_INVOCATION"
	printf 'pre_nrestarts=%s\n' "$restarts"
	printf 'pre_binary_sha256=%s\n' "$PRE_BINARY_SHA"
	printf 'pre_running_binary_sha256=%s\n' "$PRE_RUNNING_SHA"
	printf 'pre_unit_sha256=%s\n' "$PRE_UNIT_SHA"
	printf 'pre_fragment_path=%s\n' "$fragment_path"
	printf 'pre_need_daemon_reload=%s\n' "$need_daemon_reload"
	printf 'pre_drop_in_paths=%s\n' "${drop_in_paths:-none}"
	printf 'pre_raw_allocated_bytes=%s\n' "$raw"
	printf 'pre_search_allocated_bytes=%s\n' "$search"
	printf 'pre_available_bytes=%s\n' "$free"
	printf 'pre_environment_owner=%s\n' "$(sudo stat -c '%U:%G' -- "$REMOTE_ENV")"
	printf 'pre_environment_mode=%s\n' "$env_mode"
}

make_backup() {
	local uid gid
	uid="$(id -u)"
	gid="$(id -g)"
	BACKUP_DIR="$(mktemp -d "$HOME/relay-rollback.XXXXXX")"
	sudo install -o "$uid" -g "$gid" -m 0700 \
		"$REMOTE_BIN" "$BACKUP_DIR/market-relay"
	sudo install -o "$uid" -g "$gid" -m 0600 \
		"$REMOTE_SERVICE" "$BACKUP_DIR/market-relay.service"
	[[ "$(sha256sum "$BACKUP_DIR/market-relay" | awk '{print $1}')" == "$PRE_BINARY_SHA" ]] || { echo "Backup binary hash does not match pre-activation hash"; return 1; }
	[[ "$(sha256sum "$BACKUP_DIR/market-relay.service" | awk '{print $1}')" == "$PRE_UNIT_SHA" ]] || { echo "Backup unit hash does not match pre-activation hash"; return 1; }
}

rollback() {
	local pid invocation restarts active substate

	sudo systemctl stop "$SERVICE_NAME" || {
		echo "Unable to stop failed staging relay"
		return 1
	}
	active="$(property ActiveState)" || return 1
	[[ "$active" == "inactive" || "$active" == "failed" ]] || {
		echo "Staging relay did not reach a stopped state; refusing rollback file replacement"
		return 1
	}

	sudo install -o root -g root -m 0755 "$BACKUP_DIR/market-relay" "$REMOTE_BIN" || return 1
	sudo install -o root -g root -m 0644 "$BACKUP_DIR/market-relay.service" "$REMOTE_SERVICE" || return 1
	[[ "$(hash_file "$REMOTE_BIN")" == "$PRE_BINARY_SHA" ]] || {
		echo "Rollback binary verification failed"
		return 1
	}
	[[ "$(hash_file "$REMOTE_SERVICE")" == "$PRE_UNIT_SHA" ]] || {
		echo "Rollback unit verification failed"
		return 1
	}

	sudo systemctl daemon-reload || return 1
	[[ "$(property FragmentPath)" == "$REMOTE_SERVICE" ]] || {
		echo "Rollback unit fragment path verification failed"
		return 1
	}
	[[ "$(property NeedDaemonReload)" == "no" ]] || {
		echo "Rollback unit still requires daemon-reload"
		return 1
	}
	[[ -z "$(property DropInPaths)" ]] || {
		echo "Rollback unit has unexpected systemd drop-ins"
		return 1
	}
	sudo systemctl restart "$SERVICE_NAME" || return 1
	sleep 5
	active="$(property ActiveState)" || return 1
	substate="$(property SubState)" || return 1
	[[ "$active" == "active" && "$substate" == "running" ]] || {
		echo "Previous staging relay did not return to active/running"
		return 1
	}
	pid="$(property MainPID)" || return 1
	invocation="$(property InvocationID)" || return 1
	restarts="$(property NRestarts)" || return 1
	uint "$pid" && ((pid > 0)) || {
		echo "Rollback relay has no live MainPID"
		return 1
	}
	uint "$restarts" && ((restarts == 0)) || {
		echo "Rollback relay NRestarts is nonzero"
		return 1
	}
	[[ -n "$invocation" ]] || {
		echo "Rollback relay has no InvocationID"
		return 1
	}
	[[ "$(hash_file "/proc/${pid}/exe")" == "$PRE_BINARY_SHA" ]] || {
		echo "Rollback running process does not match the previous binary"
		return 1
	}
	local_health || {
		echo "Rollback relay local NIP-11 check failed"
		return 1
	}

	printf 'rollback_main_pid=%s\n' "$pid"
	printf 'rollback_invocation_id=%s\n' "$invocation"
	printf 'rollback_nrestarts=%s\n' "$restarts"
	echo "Previous staging relay binary and unit restored"
}

on_exit() {
	local status=$?
	local rollback_ok=1

	trap - EXIT
	set +e
	if ((status != 0 && FILES_CHANGED == 1 && DEPLOY_COMPLETE == 0)); then
		echo "Staging relay deployment failed; beginning guarded rollback"
		sudo systemctl status "$SERVICE_NAME" --no-pager || true
		sudo journalctl -u "$SERVICE_NAME" -n 100 --no-pager || true
		if ! rollback; then
			rollback_ok=0
			status=70
			echo "Guarded rollback failed; manual intervention is required"
		fi
	fi
	if [[ -n "$BACKUP_DIR" ]]; then
		if ((rollback_ok == 1)); then
			rm -rf "$BACKUP_DIR"
		else
			echo "Rollback backup retained at $BACKUP_DIR"
		fi
	fi
	exit "$status"
}

check_growth() {
	local raw_before="$1" search_before="$2" free_before="$3"
	local raw_now search_now free_now raw_growth search_growth free_loss

	raw_now="$(allocated "$RAW_DIR")"
	search_now="$(allocated "$SEARCH_DIR")"
	free_now="$(free_bytes)"
	uint "$raw_now" && uint "$search_now" && uint "$free_now" || {
		echo "Unable to read numeric observation storage metrics"
		return 1
	}

	raw_growth="$(positive_delta "$raw_now" "$raw_before")"
	search_growth="$(positive_delta "$search_now" "$search_before")"
	free_loss="$(positive_delta "$free_before" "$free_now")"

	((raw_growth <= MAX_RAW_GROWTH)) || {
		echo "Staging raw allocation exceeded the observation gate"
		return 1
	}
	((search_growth <= MAX_SEARCH_GROWTH)) || {
		echo "Staging search allocation exceeded the observation gate"
		return 1
	}
	((free_loss <= MAX_FREE_LOSS)) || {
		echo "Staging filesystem free-space loss exceeded the observation gate"
		return 1
	}
	((free_now >= MIN_FREE)) || {
		echo "Staging relay data filesystem fell below the minimum free-space gate"
		return 1
	}

	printf 'sample_raw_growth_bytes=%s\n' "$raw_growth"
	printf 'sample_search_growth_bytes=%s\n' "$search_growth"
	printf 'sample_free_loss_bytes=%s\n' "$free_loss"
	printf 'sample_available_bytes=%s\n' "$free_now"
}

check_runtime_sample() {
	local pid="$1" invocation="$2" binary_sha="$3"
	local raw_before="$4" search_before="$5" free_before="$6"

	[[ "$(cat /proc/sys/kernel/random/boot_id)" == "$PRE_BOOT_ID" ]] || { echo "Runtime sample failed: boot_id changed during observation"; return 1; }
	[[ "$(property ActiveState)" == "active" && "$(property SubState)" == "running" ]] || { echo "Runtime sample failed: service is not active/running"; return 1; }
	[[ "$(property MainPID)" == "$pid" ]] || { echo "Runtime sample failed: MainPID changed during observation"; return 1; }
	[[ "$(property InvocationID)" == "$invocation" ]] || { echo "Runtime sample failed: InvocationID changed during observation"; return 1; }
	[[ "$(property NRestarts)" == "0" ]] || { echo "Runtime sample failed: NRestarts is nonzero during observation"; return 1; }
	[[ "$(hash_file "/proc/${pid}/exe")" == "$binary_sha" ]] || { echo "Runtime sample failed: running binary hash does not match expected"; return 1; }
	check_growth "$raw_before" "$search_before" "$free_before"
}

observe() {
	local epoch="$1" pid="$2" invocation="$3" binary_sha="$4"
	local raw_before="$5" search_before="$6" free_before="$7"
	local deadline service_journal kernel_journal grep_status
	local health_failures=0

	deadline=$((SECONDS + OBSERVE_SECONDS))
	while ((SECONDS < deadline)); do
		sleep "$SAMPLE_SECONDS"
		check_runtime_sample "$pid" "$invocation" "$binary_sha" \
			"$raw_before" "$search_before" "$free_before"

		if local_health; then
			health_failures=0
		else
			health_failures=$((health_failures + 1))
			printf 'Local NIP-11 sample failed (%s/2)\n' "$health_failures"
			if ((health_failures >= 2)); then
				echo "Local NIP-11 failed on two consecutive samples"
				return 1
			fi
		fi
	done

	# Do not finish with an unresolved single failure. Retry one complete
	# process/storage/health sample after a full interval so the deployment
	# cannot pass if runtime identity or growth drifts during the health retry.
	if ((health_failures == 1)); then
		sleep "$SAMPLE_SECONDS"
		check_runtime_sample "$pid" "$invocation" "$binary_sha" \
			"$raw_before" "$search_before" "$free_before"
		if local_health; then
			health_failures=0
		else
			health_failures=2
			printf 'Local NIP-11 sample failed (%s/2)\n' "$health_failures"
			echo "Local NIP-11 failed on two consecutive samples"
			return 1
		fi
	fi

	service_journal="$(sudo journalctl -u "$SERVICE_NAME" -n 1000 --since "@${epoch}" --no-pager 2>&1)"
	kernel_journal="$(sudo journalctl -k -n 1000 --since "@${epoch}" --no-pager 2>&1)"
	if grep -Eiq \
		'scheduled restart job|automatic restarting|restart counter is at' \
		<<<"$service_journal"; then
		echo "Automatic relay restart evidence found during observation"
		return 1
	else
		grep_status=$?
		if ((grep_status != 1)); then
			echo "Unable to inspect relay restart evidence"
			return 1
		fi
	fi

	if grep -Eiq \
		'out of memory|oom-kill|killed process' \
		<<<"$kernel_journal"; then
		echo "Kernel OOM evidence found during observation"
		return 1
	else
		grep_status=$?
		if ((grep_status != 1)); then
			echo "Unable to inspect kernel OOM evidence"
			return 1
		fi
	fi

	# Reconfirm the terminal runtime/storage state after journal collection.
	check_runtime_sample "$pid" "$invocation" "$binary_sha" \
		"$raw_before" "$search_before" "$free_before"

	printf 'post_main_pid=%s\n' "$pid"
	printf 'post_invocation_id=%s\n' "$invocation"
	printf 'post_nrestarts=%s\n' "$(property NRestarts)"
	printf 'post_automatic_restart_message_count=0\n'
	printf 'post_kernel_oom_message_count=0\n'
}

main() {
	local expected_bin expected_unit installed_bin installed_unit running_bin
	local raw_before search_before free_before epoch pid invocation restarts

	preflight
	trap on_exit EXIT
	make_backup

	expected_bin="$(sha256sum "$SOURCE_BIN" | awk '{print $1}')"
	expected_unit="$(sha256sum "$SOURCE_UNIT" | awk '{print $1}')"

	FILES_CHANGED=1
	sudo install -o root -g root -m 0755 "$SOURCE_BIN" "$REMOTE_BIN"
	echo "Preserving existing staging environment file"
	sudo install -o root -g root -m 0644 "$SOURCE_UNIT" "$REMOTE_SERVICE"

	installed_bin="$(hash_file "$REMOTE_BIN")"
	installed_unit="$(hash_file "$REMOTE_SERVICE")"
	printf 'artifact_binary_sha256=%s\n' "$expected_bin"
	printf 'installed_binary_sha256=%s\n' "$installed_bin"
	printf 'artifact_unit_sha256=%s\n' "$expected_unit"
	printf 'installed_unit_sha256=%s\n' "$installed_unit"
	[[ "$installed_bin" == "$expected_bin" ]] || { echo "Installed binary hash does not match artifact hash"; return 1; }
	[[ "$installed_unit" == "$expected_unit" ]] || { echo "Installed unit hash does not match artifact hash"; return 1; }

	raw_before="$(allocated "$RAW_DIR")"
	search_before="$(allocated "$SEARCH_DIR")"
	free_before="$(free_bytes)"
	uint "$raw_before" && uint "$search_before" && uint "$free_before" || {
		echo "Unable to read numeric pre-activation storage metrics"
		return 1
	}
	((free_before >= MIN_FREE)) || {
		echo "Staging relay data filesystem is below the pre-activation free-space gate"
		return 1
	}

	epoch="$(date +%s)"
	sudo systemctl daemon-reload
	[[ "$(property FragmentPath)" == "$REMOTE_SERVICE" ]] || { echo "Post-install unit fragment path is not from expected location"; return 1; }
	[[ "$(property NeedDaemonReload)" == "no" ]] || { echo "Post-install unit still requires daemon-reload"; return 1; }
	[[ -z "$(property DropInPaths)" ]] || { echo "Post-install unit has unexpected systemd drop-ins"; return 1; }
	sudo systemctl restart "$SERVICE_NAME"
	sleep 5

	[[ "$(property ActiveState)" == "active" && "$(property SubState)" == "running" ]] || { echo "Staging relay is not active/running after activation"; return 1; }
	pid="$(property MainPID)"
	invocation="$(property InvocationID)"
	restarts="$(property NRestarts)"
	uint "$pid" && ((pid > 0)) || {
		echo "Staging relay has no valid MainPID after activation"
		return 1
	}
	uint "$restarts" && ((restarts == 0)) || {
		echo "Staging relay NRestarts is not zero after activation"
		return 1
	}
	[[ -n "$invocation" ]] || { echo "Staging relay has no InvocationID after activation"; return 1; }
	[[ "$pid" != "$PRE_PID" ]] || { echo "Staging relay MainPID unchanged after restart"; return 1; }
	[[ "$invocation" != "$PRE_INVOCATION" ]] || { echo "Staging relay InvocationID unchanged after restart"; return 1; }

	running_bin="$(hash_file "/proc/${pid}/exe")"
	printf 'running_binary_sha256=%s\n' "$running_bin"
	[[ "$running_bin" == "$expected_bin" ]] || { echo "Running binary hash does not match expected artifact hash"; return 1; }
	local_health
	check_growth "$raw_before" "$search_before" "$free_before"
	observe "$epoch" "$pid" "$invocation" "$expected_bin" \
		"$raw_before" "$search_before" "$free_before"

	DEPLOY_COMPLETE=1
	echo "Staging relay deployed successfully"
}

main "$@"
