#!/usr/bin/env bash
# TypeScript diagnostic ratchet, modelled on check-instance-literals.sh.
#
# `tsc --noEmit` is not clean on this tree and never has been, so a gate that
# required a clean run would be red on the day it landed. This guard fails when
# a diagnostic appears that the committed baseline does not already carry: it
# blocks NEW type errors while the existing set is paid down, and it is what
# would have caught the raw-event-into-a-parsed-bids reader (#1402) as a
# compile error instead of a silent empty map.
#
# The baseline key is `file|TSxxxx` with line and column stripped, so moving code
# or reformatting it does not rewrite the baseline, and a diagnostic that stays
# fixed keeps its count. Diagnostics whose FILE PATH is inside `node_modules` are
# excluded: those trees are pinned dependencies, not ours to fix.
#
# The gate fails closed. A missing or empty ledger, a `tsconfig.json` that lost
# its `target`, and a checker that did not complete are each an error rather than
# a silent pass: an empty ledger means zero new diagnostics allowed, never
# unlimited.
#
# When a change removes diagnostics, lower scripts/typecheck-baseline.txt in the
# same PR so the guard ratchets downward.
#
# Test seams (see src/lib/__tests__/typecheck-baseline-guard.test.ts):
#   TYPECHECK_BASELINE_FILE      read this ledger instead of the committed one
#   TYPECHECK_DIAGNOSTICS_FILE   parse this checker output instead of running tsc
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="${TYPECHECK_BASELINE_FILE:-$ROOT/scripts/typecheck-baseline.txt}"
TS_CONFIG="$ROOT/tsconfig.json"
TSC="$ROOT/node_modules/typescript/bin/tsc"
BASELINE_CLEAN="$(mktemp)"
CURRENT="$(mktemp)"
RAW="$(mktemp)"
trap 'rm -f "$CURRENT" "$RAW" "$BASELINE_CLEAN"' EXIT

fail() {
	printf '::error::%s\n' "$1"
	exit 1
}

# --- 1. the ledger must exist and carry entries -------------------------------
if [[ ! -f "$BASELINE" ]]; then
	fail "no TypeScript diagnostic baseline at $BASELINE. A missing ledger would allow every new diagnostic, so it is an error rather than an empty pass."
fi
grep -v '^#' "$BASELINE" | grep -v '^[[:space:]]*$' >"$BASELINE_CLEAN" || true
if [[ ! -s "$BASELINE_CLEAN" ]]; then
	fail "$BASELINE has no data lines. An empty ledger means zero new diagnostics allowed, never unlimited: restore it or regenerate it from a clean install."
fi

# --- 2. the config reason this gate exists must still hold --------------------
# Without `target`, TypeScript falls back to ES5 and the downlevel class returns
# as ~62 diagnostics. They would arrive as "new" and the failure text below would
# point at the ledger rather than at the removed setting.
if ! grep -qE '"target"[[:space:]]*:' "$TS_CONFIG"; then
	fail "tsconfig.json no longer sets \"target\". Without it the checker falls back to ES5 and reports the downlevel class (TS1378 top-level await, TS2802 iteration) as new diagnostics: restore the setting instead of baselining them."
fi

# --- 3. run the checker, and know whether it ran ------------------------------
if [[ -n "${TYPECHECK_DIAGNOSTICS_FILE:-}" ]]; then
	cp "$TYPECHECK_DIAGNOSTICS_FILE" "$RAW"
else
	if [[ ! -f "$TSC" ]]; then
		fail "no type checker at $TSC. 'typescript' is not a declared dependency of this repo: declare it instead of relying on a hoisted transitive install, and never let a missing checker read as a clean run."
	fi
	cd "$ROOT"
	status=0
	NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
		node "$TSC" --noEmit --pretty false >"$RAW" 2>&1 || status=$?
	# 0 = clean, 2 = diagnostics reported. Anything else is a crash (an OOM kill
	# lands here), and a partial diagnostic set can sit below the baseline.
	if [[ "$status" -ne 0 && "$status" -ne 2 ]]; then
		fail "the type checker did not complete (exit $status). A partial diagnostic set can sit below the baseline and pass, so a crashed run is a failure."
	fi
fi

# --- 4. normalize -------------------------------------------------------------
# The grep is wrapped so that the no-match case falls through under
# `set -e`/`pipefail` instead of aborting the script with no message.
{
	grep -F 'error TS' "$RAW" || true
} |
	sed -E 's/\(([0-9]+),([0-9]+)\)//' |
	awk -F': error ' '$1 ~ /(^|\/)node_modules\// { next } { split($2, code, ":"); print $1 "|" code[1] }' |
	sort | uniq -c | awk '{ print $2 "|" $1 }' | sort >"$CURRENT"

CURRENT_TOTAL="$(cut -d'|' -f3 "$CURRENT" | awk '{ sum += $1 } END { print sum + 0 }')"
BASELINE_TOTAL="$(cut -d'|' -f3 "$BASELINE_CLEAN" | awk '{ sum += $1 } END { print sum + 0 }')"

echo "TypeScript diagnostics: $CURRENT_TOTAL occurrence(s) (baseline: $BASELINE_TOTAL)"

# --- 5. compare, keyed on the file name so an empty ledger cannot pass --------
FAILED="$(awk -F'|' -v base="$BASELINE_CLEAN" '
	FILENAME == base { allowed[$1 "|" $2] = $3; next }
	{
		key = $1 "|" $2
		limit = (key in allowed) ? allowed[key] : 0
		if ($3 > limit) print key "|" limit "|" $3
	}
' "$BASELINE_CLEAN" "$CURRENT")"

if [[ -n "$FAILED" ]]; then
	echo ""
	echo "::error::TypeScript diagnostics increased beyond the committed baseline."
	echo "New or worsened diagnostics (file|code|baseline|current):"
	echo "$FAILED" | sed 's/^/  /'
	echo ""
	echo "Fix the diagnostic, or add it to scripts/typecheck-baseline.txt with a"
	echo "comment explaining why it is tolerated temporarily. A raw event passed"
	echo "where a parsed one is required is exactly the class this guard exists for."
	echo ""
	echo "Keys added or removed (file|TSxxxx):"
	diff -u <(cut -d'|' -f1,2 "$BASELINE_CLEAN" | sort -u) <(cut -d'|' -f1,2 "$CURRENT" | sort -u) || true
	exit 1
fi

if [[ "$CURRENT_TOTAL" -lt "$BASELINE_TOTAL" ]]; then
	echo "::notice::TypeScript diagnostics decreased. Lower"
	echo "scripts/typecheck-baseline.txt within this PR so the guard ratchets downward."
fi

echo "OK"
