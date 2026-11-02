#!/usr/bin/env bash
set -euo pipefail

friday_repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
friday_run_root=$(mktemp -d /tmp/plebeian-friday-integrated.XXXXXX)
friday_mint_pid=
friday_proxy_pid=
friday_test_group=
friday_evidence_path=

friday_stop_owned() {
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

friday_stop_group() {
	local label=$1 group=$2
	[[ -n "$group" ]] || return 0
	if kill -0 -- "-$group" 2>/dev/null; then
		kill -TERM -- "-$group" 2>/dev/null || true
		for _ in {1..100}; do
			kill -0 -- "-$group" 2>/dev/null || break
			sleep 0.1
		done
		if kill -0 -- "-$group" 2>/dev/null; then
			printf 'forcing cleanup of owned %s process group %s\n' "$label" "$group" >&2
			kill -KILL -- "-$group" 2>/dev/null || true
		fi
	fi
}

friday_cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	# The Bun test, local Comet supervisor, validators, and policy workers run in
	# one fresh session. This catches descendants even if timeout prevents the
	# test's TypeScript finally block from running.
	friday_stop_group integrated-test "$friday_test_group"
	friday_stop_owned fault-proxy "$friday_proxy_pid"
	friday_stop_owned mint "$friday_mint_pid"
	if (( exit_code != 0 )) && [[ -f "$friday_run_root/mint.log" ]]; then
		printf 'friday-integrated-frost-comet: sanitized mint diagnostics\n' >&2
		rg -n 'ERROR|FAILED|panic|fatal|Traceback|Permission|Operation not permitted|Started server process|Uvicorn running|Shutting down' \
			"$friday_run_root/mint.log" >&2 || true
	fi
	rm -rf -- "$friday_run_root"
	printf 'friday-integrated-frost-comet: cleanup complete (root %s, exit %d)\n' "$friday_run_root" "$exit_code"
	if [[ -n "$friday_evidence_path" && -f "$friday_evidence_path" ]]; then sha256sum "$friday_evidence_path"; fi
	exit "$exit_code"
}
trap friday_cleanup EXIT
trap 'exit 143' INT TERM HUP

for friday_port in 3338 3340 18080 28656 28657 28756 28757 28856 28857 28956 28957; do
	if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${friday_port}$"; then
		printf 'refusing occupied integrated-test port %s\n' "$friday_port" >&2
		exit 2
	fi
done

mkdir -p "$friday_run_root/bin" "$friday_repo_root/evidence"
chmod 0700 "$friday_run_root" "$friday_run_root/bin"
(
	cd "$friday_repo_root"
	GOCACHE=/tmp/plebeian-friday-go-build go build -mod=readonly -o "$friday_run_root/bin/plebeian-auctions-poc" .
)

friday_mint_seed=$(openssl rand -hex 32)
(
	cd "$friday_repo_root"
	export MINT_PRIVATE_KEY="$friday_mint_seed"
	export MINT_BACKEND_BOLT11_SAT=FakeWallet
	export MINT_DATABASE="$friday_run_root/mint"
	export MINT_AUTH_DATABASE="$friday_run_root/mint-auth"
	export MINT_INPUT_FEE_PPK=0
	export MINT_INFO_NAME='Plebeian Friday Integrated FROST Throwaway Mint'
	exec .venv/bin/mint --host 127.0.0.1 --port 3338
) >"$friday_run_root/mint.log" 2>&1 &
friday_mint_pid=$!

friday_ready=false
for _ in {1..240}; do
	if curl --fail --silent --max-time 1 http://127.0.0.1:3338/v1/info >/dev/null 2>&1; then friday_ready=true; break; fi
	if ! kill -0 "$friday_mint_pid" 2>/dev/null; then printf 'throwaway mint exited before readiness\n' >&2; exit 1; fi
	sleep 0.25
done
[[ "$friday_ready" == true ]] || { printf 'throwaway mint readiness timed out\n' >&2; exit 1; }

python3 "$friday_repo_root/scripts/friday-fault-proxy.py" --listen-port 3340 --upstream-port 3338 \
	>"$friday_run_root/fault-proxy.log" 2>&1 &
friday_proxy_pid=$!
friday_proxy_ready=false
for _ in {1..40}; do
	if curl --fail --silent --max-time 1 http://127.0.0.1:3340/v1/info >/dev/null 2>&1; then friday_proxy_ready=true; break; fi
	if ! kill -0 "$friday_proxy_pid" 2>/dev/null; then printf 'fault proxy exited before readiness\n' >&2; exit 1; fi
	sleep 0.1
done
[[ "$friday_proxy_ready" == true ]] || { printf 'fault proxy readiness timed out\n' >&2; exit 1; }

friday_evidence_path="$friday_repo_root/evidence/friday-integrated-frost-comet-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
friday_source_commit="$(git -C "$friday_repo_root" rev-parse HEAD)"
cd "$friday_repo_root/cashu-wrapper/ts"
FRIDAY_INTEGRATED_ROOT="$friday_run_root" \
	FRIDAY_POC_BINARY="$friday_run_root/bin/plebeian-auctions-poc" \
	FRIDAY_INTEGRATED_EVIDENCE="$friday_evidence_path" \
	FRIDAY_FAULT_MINT="http://127.0.0.1:3340" \
	FRIDAY_SOURCE_COMMIT="$friday_source_commit" \
	FRIDAY_FROST_PARTICIPANT_BINARY="$friday_repo_root/cashu-wrapper/frost-participant-3of4/target/debug/coco-demo-frost-participant-3of4-demo" \
	FRIDAY_FROST_INSPECTOR_BINARY="$friday_repo_root/cashu-wrapper/frost-public-inspect/target/debug/coco-demo-frost-public-inspect" \
	setsid timeout --signal=TERM --kill-after=15s 7m bun test demo-integrated-frost-comet.live.test.ts &
friday_test_group=$!
set +e
wait "$friday_test_group"
friday_test_exit=$?
set -e
exit "$friday_test_exit"
