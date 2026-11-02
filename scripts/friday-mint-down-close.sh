#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# Consensus deliberately pins the fake Cashu mint origin to 3338. In stalled
# mode a loopback proxy owns that port and the throwaway mint moves behind it.
fault_mode=${FRIDAY_MINT_DOWN_MODE:-stopped}
[[ "$fault_mode" == stopped || "$fault_mode" == stalled ]] || { printf 'FRIDAY_MINT_DOWN_MODE must be stopped or stalled\n' >&2; exit 2; }
mint_port=3338
upstream_mint_port=${FRIDAY_MINT_DOWN_UPSTREAM_PORT:-3437}
site_port=${FRIDAY_MINT_DOWN_SITE_PORT:-18081}
coordinator_port=${FRIDAY_MINT_DOWN_COORDINATOR_PORT:-13341}
run_root=$(mktemp -d /tmp/plebeian-friday-mint-down.XXXXXX)
mint_pid= proxy_pid= site_pid= coordinator_pid= client_pid=
validator_pids=()
evidence_path="$repo_root/evidence/friday-mint-${fault_mode}-close-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
audit_evidence_path="${evidence_path%.json}-operation-audit.json"
mint_seed=$(openssl rand -hex 32)

stop_owned_pid() {
	local label=$1 pid=$2
	[[ -n "$pid" ]] || return 0
	if kill -0 "$pid" 2>/dev/null; then
		kill -TERM "$pid" 2>/dev/null || true
		for _ in {1..100}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
		if kill -0 "$pid" 2>/dev/null; then printf 'forcing cleanup of owned %s PID %s\n' "$label" "$pid" >&2; kill -KILL "$pid" 2>/dev/null || true; fi
		wait "$pid" 2>/dev/null || true
	fi
}
cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	if [[ -n "$site_pid" ]] && kill -0 "$site_pid" 2>/dev/null; then mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true); fi
	stop_owned_pid client "$client_pid"; stop_owned_pid coordinator "$coordinator_pid"; stop_owned_pid local-demo "$site_pid"
	for pid in "${validator_pids[@]}"; do stop_owned_pid validator "$pid"; done
	stop_owned_pid fault-proxy "$proxy_pid"
	stop_owned_pid mint "$mint_pid"
	if (( exit_code != 0 )); then
		for log in "$run_root"/*.log; do [[ -f "$log" ]] || continue; printf 'mint-down sanitized diagnostics from %s\n' "$(basename "$log")" >&2; rg -n 'ERROR|FAILED|panic|fatal|Traceback|friday_worker_blocked|Uvicorn running|Shutting down' "$log" >&2 || true; done
	fi
	rm -rf -- "$run_root"
	printf 'friday-mint-down-close: cleanup complete (root %s, exit %d)\n' "$run_root" "$exit_code"
	if [[ -f "$evidence_path" ]]; then sha256sum "$evidence_path"; fi
	if [[ -f "$audit_evidence_path" ]]; then sha256sum "$audit_evidence_path"; fi
	exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP

ports=("$mint_port" "$site_port" "$coordinator_port")
[[ "$fault_mode" == stalled ]] && ports+=("$upstream_mint_port")
for port in "${ports[@]}"; do
	[[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 )) || { printf 'ports must be unprivileged\n' >&2; exit 2; }
	ss -ltn | awk '{print $4}' | grep -Eq "(^|:)${port}$" && { printf 'refusing occupied loopback port %s\n' "$port" >&2; exit 2; } || true
done
mkdir -p "$run_root/bin" "$run_root/coordinator" "$run_root/markers" "$repo_root/evidence"
chmod 0700 "$run_root" "$run_root/coordinator" "$run_root/markers"
( cd "$repo_root"; GOCACHE=/tmp/plebeian-friday-go-build go build -mod=readonly -o "$run_root/bin/plebeian-auctions-poc" . )

start_mint() {
	local listen_port=$mint_port
	[[ "$fault_mode" == stalled ]] && listen_port=$upstream_mint_port
	(
		cd "$repo_root"
		export MINT_PRIVATE_KEY="$mint_seed" MINT_BACKEND_BOLT11_SAT=FakeWallet MINT_DATABASE="$run_root/mint" MINT_AUTH_DATABASE="$run_root/mint-auth" MINT_INPUT_FEE_PPK=0 MINT_INFO_NAME='Plebeian Friday Mint-Down Test'
		exec .venv/bin/mint --host 127.0.0.1 --port "$listen_port"
	) >>"$run_root/mint.log" 2>&1 &
	mint_pid=$!
	local ready=false
	for _ in {1..200}; do
		if curl --fail --silent --max-time 1 "http://127.0.0.1:${listen_port}/v1/info" >/dev/null 2>&1; then ready=true; break; fi
		kill -0 "$mint_pid" 2>/dev/null || { printf 'mint exited before readiness\n' >&2; return 1; }
		sleep 0.25
	done
	[[ "$ready" == true ]] || { printf 'mint readiness timed out\n' >&2; return 1; }
}
start_mint

if [[ "$fault_mode" == stalled ]]; then
	python3 "$repo_root/scripts/friday-fault-proxy.py" --listen-port "$mint_port" --upstream-port "$upstream_mint_port" --control-dir "$run_root/markers" >"$run_root/proxy.log" 2>&1 &
	proxy_pid=$!
	for _ in {1..80}; do curl --fail --silent --max-time 1 "http://127.0.0.1:${mint_port}/v1/info" >/dev/null 2>&1 && break; kill -0 "$proxy_pid" 2>/dev/null || exit 1; sleep 0.1; done
	curl --fail --silent --max-time 1 "http://127.0.0.1:${mint_port}/v1/info" >/dev/null
fi

POC_CASHU_COORDINATOR_URL="http://127.0.0.1:${coordinator_port}" "$run_root/bin/plebeian-auctions-poc" local-demo --home "$run_root/network" --listen "127.0.0.1:${site_port}" >"$run_root/site.log" 2>&1 &
site_pid=$!
for _ in {1..160}; do curl --fail --silent --max-time 1 "http://127.0.0.1:${site_port}/api/validators" >/dev/null 2>&1 && break; kill -0 "$site_pid" 2>/dev/null || exit 1; sleep 0.25; done
curl --fail --silent --max-time 1 "http://127.0.0.1:${site_port}/api/validators" >/dev/null
mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true)

(
	cd "$repo_root/cashu-wrapper/ts"
	export POC_COORDINATOR_HOST=127.0.0.1 POC_COORDINATOR_PORT="$coordinator_port" POC_CONSENSUS_URL="http://127.0.0.1:${site_port}" MINT_URL="http://127.0.0.1:${mint_port}" COMMITTEE_KEY_PATH="$run_root/network/cashu-committee.key" POC_COORDINATOR_STATE="$run_root/coordinator/state.enc.json" POC_WALLET_DB_DIR="$run_root/coordinator/wallets"
	# Keep a stable, bounded observation window after the worker records an
	# unknown outcome. The default remains 2s outside this isolated harness.
	export POC_MINT_REQUEST_TIMEOUT_MS=1500 POC_FRIDAY_WORKER_INTERVAL_MS=10000
	exec bun poc-coordinator.ts
) >"$run_root/coordinator.log" 2>&1 &
coordinator_pid=$!
for _ in {1..160}; do curl --fail --silent --max-time 1 "http://127.0.0.1:${coordinator_port}/health" >/dev/null 2>&1 && break; kill -0 "$coordinator_pid" 2>/dev/null || exit 1; sleep 0.25; done
curl --fail --silent --max-time 1 "http://127.0.0.1:${coordinator_port}/health" >/dev/null

( cd "$repo_root/cashu-wrapper/ts"; exec timeout --signal=TERM --kill-after=15s 6m bun friday-mint-down-live.ts "--base=http://127.0.0.1:${site_port}" "--markers=$run_root/markers" "--evidence=$evidence_path" "--fault=$fault_mode" ) >"$run_root/client.log" 2>&1 &
client_pid=$!
for _ in {1..300}; do [[ -e "$run_root/markers/ready-to-stop-mint" ]] && break; kill -0 "$client_pid" 2>/dev/null || { wait "$client_pid" || true; exit 1; }; sleep 0.1; done
[[ -e "$run_root/markers/ready-to-stop-mint" ]] || { printf 'client did not reach mint-stop boundary\n' >&2; exit 1; }
if [[ "$fault_mode" == stopped ]]; then
	stop_owned_pid mint "$mint_pid"; mint_pid=
else
	: >"$run_root/markers/stall-next-swap"
fi
: >"$run_root/markers/mint-stopped"
for _ in {1..2300}; do [[ -e "$run_root/markers/closed-with-mint-down" ]] && break; kill -0 "$client_pid" 2>/dev/null || { wait "$client_pid" || true; exit 1; }; sleep 0.1; done
[[ -e "$run_root/markers/closed-with-mint-down" ]] || { printf 'client did not prove close while mint down\n' >&2; exit 1; }
if [[ "$fault_mode" == stopped ]]; then start_mint; else
	[[ -f "$run_root/markers/swap-completed" ]] || { printf 'stalled-mint proxy never completed the upstream swap\n' >&2; exit 1; }
	: >"$run_root/markers/release-swap"
fi
: >"$run_root/markers/mint-restarted"
wait "$client_pid"; client_pid=
seller=$(bun -e 'const v=await Bun.file(process.argv[1]).json(); console.log(v.actors.seller)' "$evidence_path")
bidder=$(bun -e 'const v=await Bun.file(process.argv[1]).json(); console.log(v.actors.bidder)' "$evidence_path")
send_id=$(bun -e 'const v=await Bun.file(process.argv[1]).json(); console.log(v.operation_ids.send)' "$evidence_path")
receive_id=$(bun -e 'const v=await Bun.file(process.argv[1]).json(); console.log(v.operation_ids.receive)' "$evidence_path")
( cd "$repo_root/cashu-wrapper/ts"; bun friday-operation-audit.ts \
	--sender-db="$run_root/coordinator/wallets/${bidder}.sqlite" --recipient-db="$run_root/coordinator/wallets/${seller}.sqlite" \
	--send-id="$send_id" --receive-id="$receive_id" --mint="http://127.0.0.1:${mint_port}" --amount=2500 --evidence="$audit_evidence_path" )
cat "$run_root/client.log"
