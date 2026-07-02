#!/usr/bin/env bash
#
# e2e-benchmark.sh — repeatable e2e benchmarking & A/B Nostr backend comparison.
#
# Runs Playwright specs N times across one or both Nostr backends, capturing a
# JSON report per (spec x backend x repeat) plus a human-readable progress log to
# stdout. Results land in ./e2e-benchmark-results/<timestamp>/.
#
# The benchmark selects the Nostr I/O adapter by exporting NOSTR_BACKEND on
# every Playwright run:
#   - "ndk"        => NDK adapter (the historical default)
#   - "applesauce" => applesauce RelayPool adapter (the migration target)
# For backend selection to actually change app behaviour, the app must read
# NOSTR_BACKEND at boot (e.g. via src/lib/nostr/io.ts). NOTE: on plain `master`
# the app is NDK-only and NOSTR_BACKEND is currently a no-op, so "applesauce"
# runs are NDK-equivalent until the adapter switch lands on the branch under
# test. The tooling itself is backend-agnostic — A/B deltas only become
# meaningful once the app honours NOSTR_BACKEND.
#
# Usage:
#   scripts/e2e-benchmark.sh --specs all --repeat 3 --backend both
#   scripts/e2e-benchmark.sh --specs auth,cart --repeat 10 --backend ndk
#   scripts/e2e-benchmark.sh --specs pii-exposure --backend applesauce
#
# Options:
#   --specs LIST       comma-separated spec names (e2e/tests/ basenames minus
#                       .spec.ts), prefix-matched, or "all" (default: all)
#   --repeat N         repetitions per spec x backend (default: 3)
#   --backend B        ndk | applesauce | both (default: both)
#   --results-dir DIR  output root (default: ./e2e-benchmark-results)
#   --grep PATTERN     optional --grep filter forwarded to playwright
#   --no-strict        always exit 0 (default: exit 1 if any run failed)
#   --playwright-bin C playwright invocation (default: npx playwright)
#   -h, --help         show this help
#
# Output layout (per run):
#   <results-dir>/<timestamp>/<spec>__<backend>__run-<n>.json   playwright JSON
#   <results-dir>/<timestamp>/manifest.json                     run index
#   <results-dir>/<timestamp>/benchmark.log                     concatenated stdout
#   <results-dir>/latest -> <timestamp>                         newest-run symlink
#
# See docs/e2e-benchmarking.md for the full guide.

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SPECS="all"
REPEAT=3
BACKEND="both"
RESULTS_DIR=""
GREP=""
STRICT=1
PLAYWRIGHT_BIN="${PLAYWRIGHT_BIN:-npx playwright}"

usage() {
	sed -n '3,42p' "$0" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
	case "$1" in
		--specs) SPECS="$2"; shift 2 ;;
		--repeat) REPEAT="$2"; shift 2 ;;
		--backend) BACKEND="$2"; shift 2 ;;
		--results-dir) RESULTS_DIR="$2"; shift 2 ;;
		--grep) GREP="$2"; shift 2 ;;
		--no-strict) STRICT=0; shift ;;
		--playwright-bin) PLAYWRIGHT_BIN="$2"; shift 2 ;;
		PLAYWRIGHT_BIN=*) PLAYWRIGHT_BIN="${1#PLAYWRIGHT_BIN=}"; shift ;;
		-h|--help) usage 0 ;;
		*) echo "e2e-benchmark: unknown option: $1" >&2; usage 1 ;;
	esac
done

case "$BACKEND" in
	ndk|applesauce|both) ;;
	*) echo "e2e-benchmark: --backend must be ndk|applesauce|both (got: $BACKEND)" >&2; exit 1 ;;
esac

if ! [[ "$REPEAT" =~ ^[1-9][0-9]*$ ]]; then
	echo "e2e-benchmark: --repeat must be a positive integer (got: $REPEAT)" >&2
	exit 1
fi

# ---------------------------------------------------------------------------
# Locate repo root (parent of this script's directory) and results dir
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPECS_DIR="$REPO_ROOT/e2e/tests"

if [[ ! -d "$SPECS_DIR" ]]; then
	echo "e2e-benchmark: e2e specs directory not found: $SPECS_DIR" >&2
	echo "  (run from the repo root, or check --specs)" >&2
	exit 1
fi

[[ -n "$RESULTS_DIR" ]] || RESULTS_DIR="$REPO_ROOT/e2e-benchmark-results"
mkdir -p "$RESULTS_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$RESULTS_DIR/$STAMP"
mkdir -p "$RUN_DIR"
# latest/ symlink (relative so it survives being moved/archived)
ln -sfn "$STAMP" "$RESULTS_DIR/latest"

LOG="$RUN_DIR/benchmark.log"
: > "$LOG"

# ---------------------------------------------------------------------------
# Colour helpers (disabled when not a tty or NO_COLOR is set)
# ---------------------------------------------------------------------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
	C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
	C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'
else
	C_RESET=""; C_BOLD=""; C_GREEN=""; C_RED=""; C_DIM=""
fi

log()      { printf '%s\n' "$*" | tee -a "$LOG" >&2; }
log_head() { printf '\n%s\n' "$*" | tee -a "$LOG" >&2; }

# ---------------------------------------------------------------------------
# Spec resolution: map requested names -> e2e/tests/*.spec.ts paths
# A requested name matches if the spec file stem equals it OR starts with it
# (so "pii-exposure" resolves to "pii-exposure-remediation.spec.ts").
# ---------------------------------------------------------------------------
declare -a SPEC_PATHS=()

resolve_specs() {
	local requested="$1"
	local -a found=()
	local name file stem

	if [[ "$requested" == "all" ]]; then
		while IFS= read -r file; do
			found+=("$file")
		done < <(find "$SPECS_DIR" -maxdepth 1 -name '*.spec.ts' | sort)
	else
		# Save/restore IFS to split on comma
		local _ifs="$IFS"; IFS=','
		read -ra _names <<< "$requested"
		IFS="$_ifs"
		for name in "${_names[@]}"; do
			name="${name// /}"           # trim spaces
			[[ -z "$name" ]] && continue
			local hits=()
			while IFS= read -r file; do
				stem="$(basename "$file" .spec.ts)"
				if [[ "$stem" == "$name" || "$stem" == "$name"-* || "$stem" == "$name"_* ]]; then
					hits+=("$file")
				fi
			done < <(find "$SPECS_DIR" -maxdepth 1 -name '*.spec.ts')
			if [[ ${#hits[@]} -eq 0 ]]; then
				echo "e2e-benchmark: no spec matched '$name' in $SPECS_DIR" >&2
				exit 1
			fi
			for file in "${hits[@]}"; do
				# de-dup
				local dup=0 f
				for f in "${found[@]:-}"; do [[ "$f" == "$file" ]] && dup=1 && break; done
				[[ "$dup" == 0 ]] && found+=("$file")
			done
		done
	fi

	if [[ ${#found[@]} -eq 0 ]]; then
		echo "e2e-benchmark: no specs resolved from '$requested' in $SPECS_DIR" >&2
		exit 1
	fi
	# emit newline-delimited for caller
	printf '%s\n' "${found[@]}"
}

# Resolve once into SPEC_PATHS
while IFS= read -r _p; do SPEC_PATHS+=("$_p"); done < <(resolve_specs "$SPECS")

# Backends to iterate
declare -a BACKENDS=()
case "$BACKEND" in
	both)       BACKENDS=(ndk applesauce) ;;
	ndk|applesauce) BACKENDS=("$BACKEND") ;;
esac

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
log_head "${C_BOLD}═══ e2e benchmark ═══${C_RESET}"
log "${C_DIM}repo        :${C_RESET} $REPO_ROOT"
log "${C_DIM}specs       :${C_RESET} ${#SPEC_PATHS[@]} ($SPECS)"
log "${C_DIM}backends    :${C_RESET} ${BACKENDS[*]}"
log "${C_DIM}repeat      :${C_RESET} $REPEAT"
log "${C_DIM}grep        :${C_RESET} ${GREP:-(none)}"
log "${C_DIM}playwright  :${C_RESET} $PLAYWRIGHT_BIN"
log "${C_DIM}run dir     :${C_RESET} $RUN_DIR"
log "${C_DIM}total runs  :${C_RESET} $(( ${#SPEC_PATHS[@]} * ${#BACKENDS[@]} * REPEAT ))"

# ---------------------------------------------------------------------------
# Run loop
# ---------------------------------------------------------------------------
TOTAL_FAIL=0
TOTAL_RUNS=0
declare -a MANIFEST=()

run_one() {
	local spec_file="$1" backend="$2" repeat="$3"
	local stem; stem="$(basename "$spec_file" .spec.ts)"
	local out_name="${stem}__${backend}__run-${repeat}.json"
	local out_json="$RUN_DIR/$out_name"

	# Playwright's JSON reporter does path.join(PLAYWRIGHT_JSON_OUTPUT_DIR,
	# PLAYWRIGHT_JSON_OUTPUT_NAME) — so the name must be a bare filename, not
	# a full path, or the output path doubles up.
	local cmd=(
		env NODE_OPTIONS='--dns-result-order=ipv4first' \
			NOSTR_BACKEND="$backend" \
			PLAYWRIGHT_JSON_OUTPUT_NAME="$out_name" \
			PLAYWRIGHT_JSON_OUTPUT_DIR="$RUN_DIR" \
			$PLAYWRIGHT_BIN test --config=e2e/playwright.config.ts --reporter=json
	)
	if [[ -n "$GREP" ]]; then cmd+=(--grep "$GREP"); fi
	cmd+=("$spec_file")

	local t0 t1 dur status_label
	t0="$(date +%s)"
	# Run, capture combined output to a per-run log; do not let set -e abort the loop.
	local run_log="$RUN_DIR/${stem}__${backend}__run-${repeat}.log"
	set +e
	( cd "$REPO_ROOT" && "${cmd[@]}" ) >"$run_log" 2>&1
	local rc=$?
	set -e
	t1="$(date +%s)"
	dur=$(( t1 - t0 ))
	TOTAL_RUNS=$(( TOTAL_RUNS + 1 ))
	cat "$run_log" >> "$LOG"

	if [[ $rc -eq 0 ]]; then
		status_label="${C_GREEN}PASS${C_RESET}"
	else
		status_label="${C_RED}FAIL${C_RESET}"
		TOTAL_FAIL=$(( TOTAL_FAIL + 1 ))
	fi

	local rel_json; rel_json="$(realpath --relative-to="$RUN_DIR" "$out_json" 2>/dev/null || echo "$out_json")"
	printf '%s' \
		"{" \
		"\"spec\":\"$stem\"," \
		"\"backend\":\"$backend\"," \
		"\"repeat\":$repeat," \
		"\"passed\":$([[ $rc -eq 0 ]] && echo true || echo false)," \
		"\"exit\":$rc," \
		"\"duration_s\":$dur," \
		"\"json\":\"$rel_json\"" \
		"}" >> "$RUN_DIR/.manifest.frag"
	printf '\n' >> "$RUN_DIR/.manifest.frag"

	printf '  [%3d/%d] %-28s %-11s run %d/%d  %s  %ds\n' \
		"$TOTAL_RUNS" "$(( ${#SPEC_PATHS[@]} * ${#BACKENDS[@]} * REPEAT ))" \
		"$stem" "[$backend]" "$repeat" "$REPEAT" "$status_label" "$dur" | tee -a "$LOG" >&2
}

for backend in "${BACKENDS[@]}"; do
	for spec_file in "${SPEC_PATHS[@]}"; do
		for (( r=1; r<=REPEAT; r++ )); do
			run_one "$spec_file" "$backend" "$r"
		done
	done
done

# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------
{
	printf '{"generated_at":"%s","specs":[%s],"backends":["%s"],"repeat":%d,"total_runs":%d,"total_fail":%d,"runs":[\n' \
		"$STAMP" \
		"$(printf '"%s",' "${SPEC_PATHS[@]}" | sed 's/,$//')" \
		"$(printf '%s","' "${BACKENDS[@]}" | sed 's/,"$//')" \
		"$REPEAT" "$TOTAL_RUNS" "$TOTAL_FAIL"
	# append per-run fragments, strip trailing comma/newline
	if [[ -s "$RUN_DIR/.manifest.frag" ]]; then
		paste -sd, "$RUN_DIR/.manifest.frag"
	fi
	printf '\n]}\n'
} > "$RUN_DIR/manifest.json"
rm -f "$RUN_DIR/.manifest.frag"

# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------
log_head "${C_BOLD}═══ summary ═══${C_RESET}"
if [[ "$TOTAL_FAIL" -eq 0 ]]; then
	log "${C_GREEN}all runs passed${C_RESET} ($TOTAL_RUNS/$TOTAL_RUNS)"
else
	log "${C_RED}$TOTAL_FAIL/$TOTAL_RUNS runs failed${C_RESET}"
fi
log "${C_DIM}results     :${C_RESET} $RUN_DIR"
log "${C_DIM}report      :${C_RESET} make e2e-benchmark-report   ${C_DIM}(or: python3 scripts/e2e-benchmark-report.py)${C_RESET}"

if [[ "$STRICT" == "1" && "$TOTAL_FAIL" -gt 0 ]]; then
	exit 1
fi
exit 0
