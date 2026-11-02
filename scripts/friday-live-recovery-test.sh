#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mint_port=${FRIDAY_LIVE_PORT:-3439}
proxy_port=${FRIDAY_FAULT_PROXY_PORT:-3440}
mint_root=$(mktemp -d /tmp/plebeian-friday-recovery.XXXXXX)
mint_pid=
proxy_pid=
evidence_path=
readiness_attempts=${FRIDAY_LIVE_READINESS_ATTEMPTS:-480}
[[ "$readiness_attempts" =~ ^[0-9]+$ ]] && (( readiness_attempts >= 40 && readiness_attempts <= 480 )) || { printf 'readiness attempts must be 40..480\n' >&2; exit 2; }

cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	if [[ -n "$proxy_pid" ]] && kill -0 "$proxy_pid" 2>/dev/null; then
		kill -TERM "$proxy_pid" 2>/dev/null || true
		wait "$proxy_pid" 2>/dev/null || true
	fi
	if [[ -n "$mint_pid" ]] && kill -0 "$mint_pid" 2>/dev/null; then
		kill -TERM "$mint_pid" 2>/dev/null || true
		for _ in {1..50}; do
			kill -0 "$mint_pid" 2>/dev/null || break
			sleep 0.1
		done
		if kill -0 "$mint_pid" 2>/dev/null; then
			kill -KILL "$mint_pid" 2>/dev/null || true
		fi
		wait "$mint_pid" 2>/dev/null || true
	fi
	if (( exit_code != 0 )) && [[ -f "$mint_root/mint.log" ]]; then
		printf '%s\n' 'friday-live-recovery-test: sanitized mint diagnostics:' >&2
		rg -n 'ERROR|Traceback|Permission|Operation not permitted|Started server process|Uvicorn running|Shutting down' "$mint_root/mint.log" >&2 || true
	fi
	rm -rf -- "$mint_root"
	printf 'friday-live-recovery-test: cleanup complete (root %s, exit %d)\n' "$mint_root" "$exit_code"
	if [[ -n "$evidence_path" && -f "$evidence_path" ]]; then sha256sum "$evidence_path"; fi
	exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP

for port in "$mint_port" "$proxy_port"; do
	if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then printf 'recovery ports must be unprivileged TCP ports\n' >&2; exit 2; fi
	if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then printf 'refusing occupied loopback port %s\n' "$port" >&2; exit 2; fi
done

mint_seed=$(openssl rand -hex 32)
(
	cd "$repo_root"
	export MINT_PRIVATE_KEY="$mint_seed"
	export MINT_BACKEND_BOLT11_SAT=FakeWallet
	export MINT_DATABASE="$mint_root/mint"
	export MINT_AUTH_DATABASE="$mint_root/auth"
	export MINT_INPUT_FEE_PPK=0
	export MINT_INFO_NAME='Plebeian Friday Throwaway Recovery Mint'
	exec .venv/bin/mint --host 127.0.0.1 --port "$mint_port"
) >"$mint_root/mint.log" 2>&1 &
mint_pid=$!

ready=false
readiness_started=$(date +%s)
for (( attempt=0; attempt<readiness_attempts; attempt++ )); do
	if curl --fail --silent --max-time 1 "http://127.0.0.1:${mint_port}/v1/info" >/dev/null 2>&1; then
		ready=true
		break
	fi
	if ! kill -0 "$mint_pid" 2>/dev/null; then
		printf 'throwaway mint exited before readiness\n' >&2
		exit 1
	fi
	sleep 0.25
done
if [[ "$ready" != true ]]; then
	printf 'throwaway mint readiness timed out after %ss\n' "$(( $(date +%s)-readiness_started ))" >&2
	exit 1
fi

python3 "$repo_root/scripts/friday-fault-proxy.py" --listen-port "$proxy_port" --upstream-port "$mint_port" \
	>"$mint_root/proxy.log" 2>&1 &
proxy_pid=$!
proxy_ready=false
for _ in {1..40}; do
	if curl --fail --silent --max-time 1 "http://127.0.0.1:${proxy_port}/v1/info" >/dev/null 2>&1; then proxy_ready=true; break; fi
	if ! kill -0 "$proxy_pid" 2>/dev/null; then printf 'fault proxy exited before readiness\n' >&2; exit 1; fi
	sleep 0.1
done
[[ "$proxy_ready" == true ]] || { printf 'fault proxy readiness timed out\n' >&2; exit 1; }

cd "$repo_root/cashu-wrapper/ts"
mkdir -p "$repo_root/evidence"
evidence_path="$repo_root/evidence/friday-fault-matrix-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
FRIDAY_LIVE_MINT="http://127.0.0.1:${mint_port}" \
	FRIDAY_FAULT_MINT="http://127.0.0.1:${proxy_port}" FRIDAY_FAULT_EVIDENCE="$evidence_path" \
	timeout --signal=TERM --kill-after=10s 3m bun test friday-sqlite.live.test.ts
