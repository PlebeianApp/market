#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
baseline=${FRIDAY_TYPECHECK_BASELINE:-bb9a7678dbf5dec46b7cca5851d02bb1e3dfe13b}
run_root=$(mktemp -d /tmp/plebeian-friday-typecheck.XXXXXX)
evidence_dir="$repo_root/evidence/friday-typecheck-$(date -u +%Y%m%dT%H%M%SZ)-$$"

cleanup() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	rm -rf -- "$run_root"
	printf 'friday-typecheck-delta: cleanup complete (root %s, exit %d)\n' "$run_root" "$exit_code"
	exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP

[[ -x "$repo_root/cashu-wrapper/ts/node_modules/.bin/tsc" ]] || { printf 'existing no-install TypeScript compiler is unavailable\n' >&2; exit 2; }
git -C "$repo_root" cat-file -e "${baseline}^{commit}"
mkdir -p "$run_root/baseline" "$evidence_dir"
git -C "$repo_root" archive "$baseline" | tar -x -C "$run_root/baseline"
ln -s "$repo_root/cashu-wrapper/ts/node_modules" "$run_root/baseline/cashu-wrapper/ts/node_modules"

run_tsc() {
	local directory=$1 output=$2; shift 2
	set +e
	( cd "$directory"; node_modules/.bin/tsc "$@" ) >"$output" 2>&1
	local status=$?
	set -e
	printf '%s' "$status"
}
baseline_status=$(run_tsc "$run_root/baseline/cashu-wrapper/ts" "$evidence_dir/baseline-broad.log" --noEmit --pretty false -p tsconfig.json)
candidate_status=$(run_tsc "$repo_root/cashu-wrapper/ts" "$evidence_dir/candidate-broad.log" --noEmit --pretty false -p tsconfig.json)
focused_status=$(run_tsc "$repo_root/cashu-wrapper/ts" "$evidence_dir/candidate-friday.log" --pretty false -p tsconfig.friday.json)

baseline_hash=$(sha256sum "$evidence_dir/baseline-broad.log" | awk '{print $1}')
candidate_hash=$(sha256sum "$evidence_dir/candidate-broad.log" | awk '{print $1}')
focused_hash=$(sha256sum "$evidence_dir/candidate-friday.log" | awk '{print $1}')
diff_hash=$(git -C "$repo_root" diff --binary "$baseline" -- | sha256sum | awk '{print $1}')
cat >"$evidence_dir/manifest.json" <<EOF
{
  "schema": "PlebeianFridayTypecheckDeltaV1",
  "baseline": "$baseline",
  "candidate": "working-tree-after-2803b48",
  "candidate_diff_sha256": "$diff_hash",
  "no_install": true,
  "commands": {
    "broad": "node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json",
    "focused": "node_modules/.bin/tsc --pretty false -p tsconfig.friday.json"
  },
  "results": {
    "baseline_broad": { "exit": $baseline_status, "sha256": "$baseline_hash" },
    "candidate_broad": { "exit": $candidate_status, "sha256": "$candidate_hash" },
    "candidate_friday": { "exit": $focused_status, "sha256": "$focused_hash" }
  }
}
EOF
chmod 0600 "$evidence_dir"/*.log "$evidence_dir/manifest.json"
sha256sum "$evidence_dir/manifest.json"
if [[ "$focused_status" != 0 ]]; then exit 1; fi
