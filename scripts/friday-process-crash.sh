#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mint_port=${FRIDAY_CRASH_UPSTREAM_MINT_PORT:-3438}
proxy_port=3338 # Consensus pins this isolated fake-mint origin.
site_port=${FRIDAY_CRASH_SITE_PORT:-18082}
coordinator_port=${FRIDAY_CRASH_COORDINATOR_PORT:-13342}
run_root=$(mktemp -d /tmp/plebeian-friday-crash.XXXXXX)
# The coordinator deliberately accepts failpoints only when this exact dedicated
# /tmp root is supplied. Keeping markers at that root also makes the process
# boundary self-contained for the trap's exact cleanup.
markers="$run_root"
pid_manifest="$run_root/pids.jsonl"
mint_pid= proxy_pid= site_pid= coordinator_pid= client_pid=
validator_pids=()
owned_pids=()
crash_evidence="$repo_root/evidence/friday-process-crash-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
audit_evidence="$repo_root/evidence/friday-operation-audit-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
process_evidence="$repo_root/evidence/friday-process-manifest-$(date -u +%Y%m%dT%H%M%SZ)-$$.jsonl"
conservation_evidence="$repo_root/evidence/friday-process-conservation-$(date -u +%Y%m%dT%H%M%SZ)-$$.jsonl"
prepared_audit_evidence="$repo_root/evidence/friday-prepared-operation-audit-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
conservation_snapshots="$markers/conservation.jsonl"

record_pid() {
	local action=$1 label=$2 pid=$3 result=${4:-}
	if [[ "$action" == start ]]; then owned_pids+=("$pid"); fi
	printf '{"at":"%s","action":"%s","label":"%s","pid":%s,"result":"%s"}\n' \
		"$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$label" "$pid" "$result" >>"$pid_manifest"
}
stop_owned_pid() {
	local label=$1 pid=$2 signal=${3:-TERM}
	[[ -n "$pid" ]] || return 0
	if kill -0 "$pid" 2>/dev/null; then
		kill -"$signal" "$pid" 2>/dev/null || true
		if [[ "$signal" == TERM ]]; then
			for _ in {1..100}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
			if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; signal=KILL; fi
		fi
		set +e
		wait "$pid" 2>/dev/null
		local waited=$?
		set -e
		record_pid stop "$label" "$pid" "signal-${signal}-wait-${waited}"
	else
		set +e; wait "$pid" 2>/dev/null; local waited=$?; set -e
		record_pid reap "$label" "$pid" "already-exited-wait-${waited}"
	fi
}
snapshot_owned_absence() {
	local found=false pid
	for pid in "${owned_pids[@]}"; do
		[[ -n "$pid" ]] || continue
		if kill -0 "$pid" 2>/dev/null; then found=true; record_pid post_scan owned "$pid" still-present; fi
	done
	if [[ "$found" == false ]]; then printf '{"at":"%s","action":"post_scan","result":"all-recorded-owned-pids-absent"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$pid_manifest"; fi
}
cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	if [[ -n "$site_pid" ]] && kill -0 "$site_pid" 2>/dev/null; then mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true); fi
	stop_owned_pid client "$client_pid"; client_pid=
	stop_owned_pid coordinator "$coordinator_pid"; coordinator_pid=
	stop_owned_pid local-demo "$site_pid"; site_pid=
	for pid in "${validator_pids[@]}"; do stop_owned_pid validator "$pid"; done
	stop_owned_pid fault-proxy "$proxy_pid"; proxy_pid=
	stop_owned_pid mint "$mint_pid"; mint_pid=
	snapshot_owned_absence
	if [[ -f "$pid_manifest" ]]; then install -m 0600 "$pid_manifest" "$process_evidence"; fi
	if (( exit_code != 0 )); then
		for log in "$run_root"/*.log; do [[ -f "$log" ]] || continue; printf 'process-crash sanitized diagnostics from %s\n' "$(basename "$log")" >&2; rg -n 'ERROR|FAILED|panic|fatal|Traceback|friday_worker_blocked|Uvicorn running|Shutting down' "$log" >&2 || true; done
	fi
	rm -rf -- "$run_root"
	printf 'friday-process-crash: cleanup complete (owned root %s, exit %d)\n' "$run_root" "$exit_code"
	for item in "$crash_evidence" "$audit_evidence" "$prepared_audit_evidence" "$process_evidence" "$conservation_evidence"; do [[ -f "$item" ]] && sha256sum "$item"; done
	exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP

for port in "$mint_port" "$proxy_port" "$site_port" "$coordinator_port"; do
	[[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 )) || { printf 'ports must be unprivileged\n' >&2; exit 2; }
	ss -ltn | awk '{print $4}' | grep -Eq "(^|:)${port}$" && { printf 'refusing occupied loopback port %s\n' "$port" >&2; exit 2; } || true
done
mkdir -p "$run_root/bin" "$run_root/coordinator" "$markers" "$repo_root/evidence"
chmod 0700 "$run_root" "$run_root/coordinator" "$markers"
: >"$pid_manifest"; chmod 0600 "$pid_manifest"
( cd "$repo_root"; GOCACHE=/tmp/plebeian-friday-go-build go build -mod=readonly -o "$run_root/bin/plebeian-auctions-poc" . )

mint_seed=$(openssl rand -hex 32)
(
	cd "$repo_root"
	export MINT_PRIVATE_KEY="$mint_seed" MINT_BACKEND_BOLT11_SAT=FakeWallet MINT_DATABASE="$run_root/mint" MINT_AUTH_DATABASE="$run_root/mint-auth" MINT_INPUT_FEE_PPK=0 MINT_INFO_NAME='Plebeian Friday Process-Crash Mint'
	exec .venv/bin/mint --host 127.0.0.1 --port "$mint_port"
) >"$run_root/mint.log" 2>&1 & mint_pid=$!; record_pid start mint "$mint_pid"
mint_ready=false
for _ in {1..960}; do
	if curl --fail --silent --max-time 1 "http://127.0.0.1:${mint_port}/v1/info" >/dev/null 2>&1; then mint_ready=true; break; fi
	kill -0 "$mint_pid" 2>/dev/null || { printf 'throwaway mint exited before readiness\n' >&2; exit 1; }
	sleep 0.25
done
if [[ "$mint_ready" != true ]]; then
	printf 'throwaway mint did not become ready within the bounded startup window\n' >&2
	rg -n 'ERROR|FAILED|panic|fatal|Traceback|Started server|Waiting for application|Mint started|startup complete' "$run_root/mint.log" >&2 || true
	exit 1
fi

python3 "$repo_root/scripts/friday-fault-proxy.py" --listen-port "$proxy_port" --upstream-port "$mint_port" --control-dir "$markers" >"$run_root/proxy.log" 2>&1 &
proxy_pid=$!; record_pid start fault-proxy "$proxy_pid"
for _ in {1..80}; do curl --fail --silent --max-time 1 "http://127.0.0.1:${proxy_port}/v1/info" >/dev/null 2>&1 && break; kill -0 "$proxy_pid" 2>/dev/null || exit 1; sleep 0.1; done
curl --fail --silent --max-time 1 "http://127.0.0.1:${proxy_port}/v1/info" >/dev/null

POC_CASHU_COORDINATOR_URL="http://127.0.0.1:${coordinator_port}" "$run_root/bin/plebeian-auctions-poc" local-demo --home "$run_root/network" --listen "127.0.0.1:${site_port}" >"$run_root/site.log" 2>&1 &
site_pid=$!; record_pid start local-demo "$site_pid"
for _ in {1..160}; do curl --fail --silent --max-time 1 "http://127.0.0.1:${site_port}/api/validators" >/dev/null 2>&1 && break; kill -0 "$site_pid" 2>/dev/null || exit 1; sleep 0.25; done
curl --fail --silent --max-time 1 "http://127.0.0.1:${site_port}/api/validators" >/dev/null
mapfile -t validator_pids < <(pgrep -P "$site_pid" 2>/dev/null || true)
for pid in "${validator_pids[@]}"; do record_pid start validator "$pid"; done

start_coordinator() {
	local failpoint=${1:-} paused=${2:-false}
	(
		cd "$repo_root/cashu-wrapper/ts"
		export POC_COORDINATOR_HOST=127.0.0.1 POC_COORDINATOR_PORT="$coordinator_port" POC_CONSENSUS_URL="http://127.0.0.1:${site_port}" MINT_URL="http://127.0.0.1:${proxy_port}"
		export COMMITTEE_KEY_PATH="$run_root/network/cashu-committee.key" POC_COORDINATOR_STATE="$run_root/coordinator/state.enc.json" POC_WALLET_DB_DIR="$run_root/coordinator/wallets"
		export POC_MINT_REQUEST_TIMEOUT_MS=5000 POC_FRIDAY_FAILPOINT="$failpoint" POC_FRIDAY_FAILPOINT_DIR="$markers" POC_FRIDAY_WORKER_PAUSED="$paused"
		exec bun poc-coordinator.ts
	) >>"$run_root/coordinator.log" 2>&1 &
	coordinator_pid=$!; record_pid start "coordinator:${failpoint:-normal}" "$coordinator_pid"
	for _ in {1..160}; do curl --fail --silent --max-time 1 "http://127.0.0.1:${coordinator_port}/health" >/dev/null 2>&1 && return 0; kill -0 "$coordinator_pid" 2>/dev/null || return 1; sleep 0.1; done
	return 1
}
snapshot_conservation() {
	local label=$1 expected_bucket=$2 expected_amount=$3
	local snapshot="$run_root/conservation-${label}.json"
	curl --fail --silent --max-time 15 "http://127.0.0.1:${coordinator_port}/api/cashu/conservation" >"$snapshot"
	bun -e '
		const [path,label,bucket,amountText,out]=process.argv.slice(1); const value=await Bun.file(path).json(); const amount=Number(amountText);
		const safe={schema:"PlebeianFridayCrashConservationV1",observed_at:new Date().toISOString(),label,
			issued:value.issued,walletBacking:value.walletBacking,walletSpendable:value.walletSpendable,operationLocked:value.operationLocked,
			spendable:value.spendable,reserved:value.reserved,inFlight:value.inFlight,
			unknown:value.unknown,incomingPending:value.incomingPending,fundingPending:value.fundingPending,accountedTotal:value.accountedTotal,
			observationsExact:value.observationsExact,conserved:value.conserved,input_fee_ppk:value.fees.input_fee_ppk};
		await Bun.write(out,JSON.stringify(safe)+"\n");
	' "$snapshot" "$label" "$expected_bucket" "$expected_amount" "$run_root/conservation-line.json"
	cat "$run_root/conservation-line.json" >>"$conservation_snapshots"
	install -m 0600 "$conservation_snapshots" "$conservation_evidence"
	bun -e '
		const [path,label,bucket,amountText]=process.argv.slice(1); const value=await Bun.file(path).json(); const amount=Number(amountText);
		if (value.conserved!==true || value.observationsExact!==true || value.accountedTotal!==value.issued || value.fees?.input_fee_ppk!==0) throw new Error(`${label}: conservation is not exact and zero-fee`);
		if (value[bucket]!==amount) throw new Error(`${label}: ${bucket}=${value[bucket]}, expected ${amount}`);
	' "$snapshot" "$label" "$expected_bucket" "$expected_amount"
}
pause_snapshot_resume() {
	local label=$1 expected_bucket=$2 expected_amount=$3 next_failpoint=${4:-}
	start_coordinator "" true
	snapshot_conservation "$label" "$expected_bucket" "$expected_amount"
	stop_owned_pid "coordinator:snapshot:${label}" "$coordinator_pid" TERM; coordinator_pid=
	start_coordinator "$next_failpoint"
}
wait_file() {
	local path=$1 attempts=$2 label=$3
	for (( index=0; index<attempts; index++ )); do [[ -f "$path" ]] && return 0; sleep 0.1; done
	printf 'timed out waiting for %s\n' "$label" >&2; return 1
}
wait_file_while_client_alive() {
	local path=$1 attempts=$2 label=$3
	for (( index=0; index<attempts; index++ )); do
		[[ -f "$path" ]] && return 0
		if [[ -n "$client_pid" ]] && ! kill -0 "$client_pid" 2>/dev/null; then
			printf 'client exited before %s\n' "$label" >&2
			return 1
		fi
		sleep 0.1
	done
	printf 'timed out waiting for %s\n' "$label" >&2
	return 1
}
kill_at_failpoint() {
	local point=$1 attempts=${2:-600}
	wait_file "$markers/${point}.json" "$attempts" "$point"
	rg -q "\"pid\":${coordinator_pid}([,}])" "$markers/${point}.json" || { printf 'failpoint %s belongs to a different PID\n' "$point" >&2; exit 1; }
	stop_owned_pid "coordinator:${point}" "$coordinator_pid" KILL; coordinator_pid=
}

start_coordinator faucet_after_mint_before_persist
(
	cd "$repo_root/cashu-wrapper/ts"
	exec timeout --signal=TERM --kill-after=15s 8m bun friday-process-crash-live.ts --base="http://127.0.0.1:${site_port}" --markers="$markers" --evidence="$crash_evidence"
) >"$run_root/client.log" 2>&1 & client_pid=$!; record_pid start client "$client_pid"
kill_at_failpoint faucet_after_mint_before_persist 1200
wait_file "$markers/faucet-request-returned" 300 client-faucet-return
pause_snapshot_resume faucet-after-mint fundingPending 10000
: >"$markers/coordinator-restarted-faucet"
wait_file_while_client_alive "$markers/payment-scenario-ready" 1200 payment-scenario-ready
scenario=$(<"$markers/payment-scenario-ready")
seller=$(bun -e 'const v=JSON.parse(process.argv[1]); console.log(v.seller)' "$scenario")
bidder=$(bun -e 'const v=JSON.parse(process.argv[1]); console.log(v.bidder)' "$scenario")
send_id=$(bun -e 'const v=JSON.parse(process.argv[1]); console.log(v.send_id)' "$scenario")
receive_id=$(bun -e 'const v=JSON.parse(process.argv[1]); console.log(v.receive_id)' "$scenario")

stop_owned_pid coordinator "$coordinator_pid" TERM; coordinator_pid=
start_coordinator payment_after_intent
kill_at_failpoint payment_after_intent 2600
pause_snapshot_resume payment-after-intent inFlight 2500 payment_after_send_prepare
kill_at_failpoint payment_after_send_prepare 600
( cd "$repo_root/cashu-wrapper/ts"; bun friday-prepared-operation-audit.ts --sender-db="$run_root/coordinator/wallets/${bidder}.sqlite" \
	--send-id="$send_id" --mint="http://127.0.0.1:${proxy_port}" --amount=2500 --issued=10000 --evidence="$prepared_audit_evidence" )
start_coordinator "" true
snapshot_conservation payment-after-send-prepare inFlight 2500
stop_owned_pid coordinator:snapshot:payment-after-send-prepare "$coordinator_pid" TERM; coordinator_pid=
: >"$markers/stall-next-swap"
start_coordinator
wait_file "$markers/swap-completed" 600 upstream-swap-completed
stop_owned_pid coordinator:mint-response-unknown "$coordinator_pid" KILL; coordinator_pid=
: >"$markers/release-swap"
pause_snapshot_resume mint-complete-response-lost inFlight 2500 payment_after_send_result
kill_at_failpoint payment_after_send_result 900
pause_snapshot_resume payment-after-send-result inFlight 2500 payment_after_receive_result
kill_at_failpoint payment_after_receive_result 900
pause_snapshot_resume payment-after-receive-result incomingPending 2500
: >"$markers/crash-sequence-complete"

wait "$client_pid"; record_pid stop client "$client_pid" wait-0; client_pid=
( cd "$repo_root/cashu-wrapper/ts"; bun friday-operation-audit.ts --sender-db="$run_root/coordinator/wallets/${bidder}.sqlite" \
	--recipient-db="$run_root/coordinator/wallets/${seller}.sqlite" --send-id="$send_id" --receive-id="$receive_id" \
	--mint="http://127.0.0.1:${proxy_port}" --amount=2500 --evidence="$audit_evidence" )
cat "$run_root/client.log"
install -m 0600 "$conservation_snapshots" "$conservation_evidence"
