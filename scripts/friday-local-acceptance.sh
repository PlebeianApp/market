#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mint_port=${FRIDAY_ACCEPTANCE_MINT_PORT:-3338}
site_port=${FRIDAY_ACCEPTANCE_SITE_PORT:-18080}
coordinator_port=${FRIDAY_ACCEPTANCE_COORDINATOR_PORT:-13339}
driver=${FRIDAY_ACCEPTANCE_DRIVER:-friday-site-live.ts}
case "$driver" in
	friday-site-live.ts) evidence_slug=site-local ;;
	friday-concurrency-live.ts) evidence_slug=concurrency-local ;;
	*) printf 'refusing unrecognized Friday acceptance driver %s\n' "$driver" >&2; exit 2 ;;
esac
run_root=$(mktemp -d /tmp/plebeian-friday-acceptance.XXXXXX)
mint_pid=
site_pid=
coordinator_pid=
validator_pids=()
evidence_path=

stop_owned_pid() {
	local label=$1 pid=$2
	[[ -n "$pid" ]] || return 0
	if kill -0 "$pid" 2>/dev/null; then
		kill -TERM "$pid" 2>/dev/null || true
		for _ in {1..100}; do
			kill -0 "$pid" 2>/dev/null || break
			sleep 0.1
		done
		if kill -0 "$pid" 2>/dev/null; then
			printf 'forcing cleanup of owned %s PID %s\n' "$label" "$pid" >&2
			kill -KILL "$pid" 2>/dev/null || true
		fi
		wait "$pid" 2>/dev/null || true
	fi
}

cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	if [[ -n "$site_pid" ]] && kill -0 "$site_pid" 2>/dev/null; then
		mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true)
	fi
	stop_owned_pid coordinator "$coordinator_pid"
	stop_owned_pid local-demo "$site_pid"
	for pid in "${validator_pids[@]}"; do stop_owned_pid validator "$pid"; done
	stop_owned_pid mint "$mint_pid"
	if (( exit_code != 0 )); then
		for log in "$run_root"/*.log; do
			[[ -f "$log" ]] || continue
			printf 'friday-local-acceptance: sanitized diagnostics from %s\n' "$(basename "$log")" >&2
			rg -n 'ERROR|FAILED|panic|fatal|Traceback|Permission|Operation not permitted|Started server process|Uvicorn running|Shutting down|POC_READY|cashu_coordinator_ready|friday_worker_blocked' "$log" >&2 || true
		done
	fi
	rm -rf -- "$run_root"
	printf 'friday-local-acceptance: cleanup complete (root %s, exit %d)\n' "$run_root" "$exit_code"
	if [[ -n "$evidence_path" && -f "$evidence_path" ]]; then
		sha256sum "$evidence_path"
	fi
	exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP

for port in "$mint_port" "$site_port" "$coordinator_port"; do
	if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
		printf 'acceptance ports must be unprivileged TCP ports\n' >&2
		exit 2
	fi
	if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then
		printf 'refusing occupied loopback port %s\n' "$port" >&2
		exit 2
	fi
done

mkdir -p "$run_root/bin" "$run_root/coordinator" "$repo_root/evidence"
chmod 0700 "$run_root" "$run_root/coordinator"
(
	cd "$repo_root"
	GOCACHE=/tmp/plebeian-friday-go-build go build -mod=readonly -o "$run_root/bin/plebeian-auctions-poc" .
)

mint_seed=$(openssl rand -hex 32)
(
	cd "$repo_root"
	export MINT_PRIVATE_KEY="$mint_seed"
	export MINT_BACKEND_BOLT11_SAT=FakeWallet
	export MINT_DATABASE="$run_root/mint"
	export MINT_AUTH_DATABASE="$run_root/mint-auth"
	export MINT_INPUT_FEE_PPK=0
	export MINT_INFO_NAME='Plebeian Friday Isolated Acceptance Mint'
	exec .venv/bin/mint --host 127.0.0.1 --port "$mint_port"
) >"$run_root/mint.log" 2>&1 &
mint_pid=$!

mint_ready=false
for _ in {1..120}; do
	if curl --fail --silent --max-time 1 "http://127.0.0.1:${mint_port}/v1/info" >/dev/null 2>&1; then mint_ready=true; break; fi
	if ! kill -0 "$mint_pid" 2>/dev/null; then printf 'mint exited before readiness\n' >&2; exit 1; fi
	sleep 0.25
done
[[ "$mint_ready" == true ]] || { printf 'mint readiness timed out\n' >&2; exit 1; }

POC_CASHU_COORDINATOR_URL="http://127.0.0.1:${coordinator_port}" \
	"$run_root/bin/plebeian-auctions-poc" local-demo --home "$run_root/network" --listen "127.0.0.1:${site_port}" \
	>"$run_root/site.log" 2>&1 &
site_pid=$!

site_ready=false
for _ in {1..160}; do
	if curl --fail --silent --max-time 1 "http://127.0.0.1:${site_port}/api/validators" >/dev/null 2>&1; then site_ready=true; break; fi
	if ! kill -0 "$site_pid" 2>/dev/null; then printf 'local demo exited before readiness\n' >&2; exit 1; fi
	sleep 0.25
done
[[ "$site_ready" == true ]] || { printf 'local demo readiness timed out\n' >&2; exit 1; }
mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true)

(
	cd "$repo_root/cashu-wrapper/ts"
	export POC_COORDINATOR_HOST=127.0.0.1
	export POC_COORDINATOR_PORT="$coordinator_port"
	export POC_CONSENSUS_URL="http://127.0.0.1:${site_port}"
	export MINT_URL="http://127.0.0.1:${mint_port}"
	export COMMITTEE_KEY_PATH="$run_root/network/cashu-committee.key"
	export POC_COORDINATOR_STATE="$run_root/coordinator/state.enc.json"
	export POC_WALLET_DB_DIR="$run_root/coordinator/wallets"
	exec bun poc-coordinator.ts
) >"$run_root/coordinator.log" 2>&1 &
coordinator_pid=$!

coordinator_ready=false
for _ in {1..120}; do
	if curl --fail --silent --max-time 1 "http://127.0.0.1:${coordinator_port}/health" >/dev/null 2>&1; then coordinator_ready=true; break; fi
	if ! kill -0 "$coordinator_pid" 2>/dev/null; then printf 'coordinator exited before readiness\n' >&2; exit 1; fi
	sleep 0.25
done
[[ "$coordinator_ready" == true ]] || { printf 'coordinator readiness timed out\n' >&2; exit 1; }

evidence_path="$repo_root/evidence/friday-${evidence_slug}-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
cd "$repo_root/cashu-wrapper/ts"
timeout --signal=TERM --kill-after=15s 6m bun "$driver" \
	"--base=http://127.0.0.1:${site_port}" "--evidence=$evidence_path"
