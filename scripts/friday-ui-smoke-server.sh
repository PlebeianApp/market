#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
site_port=${FRIDAY_UI_PORT:-18081}
run_root=$(mktemp -d /tmp/plebeian-friday-ui.XXXXXX)
site_pid=
validator_pids=()

stop_pid() {
	local pid=$1
	[[ -n "$pid" ]] || return 0
	if kill -0 "$pid" 2>/dev/null; then
		kill -TERM "$pid" 2>/dev/null || true
		for _ in {1..100}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
		if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
		wait "$pid" 2>/dev/null || true
	fi
}

cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	if [[ -n "$site_pid" ]] && kill -0 "$site_pid" 2>/dev/null; then
		mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true)
	fi
	stop_pid "$site_pid"
	for pid in "${validator_pids[@]}"; do stop_pid "$pid"; done
	rm -rf -- "$run_root"
	printf 'friday-ui-smoke-server: cleanup complete (root %s, exit %d)\n' "$run_root" "$exit_code"
	exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP

mkdir -p "$run_root/bin"
(
	cd "$repo_root"
	GOCACHE=/tmp/plebeian-friday-go-build go build -mod=readonly -o "$run_root/bin/plebeian-auctions-poc" .
)
POC_CASHU_COORDINATOR_URL=http://127.0.0.1:13339 \
	"$run_root/bin/plebeian-auctions-poc" local-demo --home "$run_root/network" --listen "127.0.0.1:${site_port}" \
	>"$run_root/site.log" 2>&1 &
site_pid=$!

for _ in {1..160}; do
	if curl --fail --silent --max-time 1 "http://127.0.0.1:${site_port}/api/validators" >/dev/null 2>&1; then
		mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true)
		printf 'FRIDAY_UI_READY http://127.0.0.1:%s\n' "$site_port"
		wait "$site_pid"
		exit $?
	fi
	if ! kill -0 "$site_pid" 2>/dev/null; then
		printf 'UI smoke server exited before readiness\n' >&2
		exit 1
	fi
	sleep 0.25
done
printf 'UI smoke server readiness timed out\n' >&2
exit 1
