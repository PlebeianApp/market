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
# fixed keeps its count. Diagnostics inside `node_modules` are excluded: those
# trees are pinned dependencies, not ours to fix.
#
# When a change removes diagnostics, lower scripts/typecheck-baseline.txt in the
# same PR so the guard ratchets downward.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$ROOT/scripts/typecheck-baseline.txt"
BASELINE_CLEAN="$(mktemp)"
CURRENT="$(mktemp)"
RAW="$(mktemp)"
trap 'rm -f "$CURRENT" "$RAW" "$BASELINE_CLEAN"' EXIT

# The baseline carries explanatory comments; the comparison reads data lines only.
if [[ -f "$BASELINE" ]]; then
	grep -v '^#' "$BASELINE" | grep -v '^[[:space:]]*$' >"$BASELINE_CLEAN" || true
else
	: >"$BASELINE_CLEAN"
fi

cd "$ROOT"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
	node node_modules/typescript/bin/tsc --noEmit >"$RAW" 2>&1 || true

grep -F 'error TS' "$RAW" 2>/dev/null |
	grep -v 'node_modules' |
	sed -E 's/\(([0-9]+),([0-9]+)\)//' |
	awk -F': error ' '{ split($2, code, ":"); print $1 "|" code[1] }' |
	sort | uniq -c | awk '{ print $2 "|" $1 }' | sort >"$CURRENT"

CURRENT_TOTAL="$(cut -d'|' -f3 "$CURRENT" | awk '{ sum += $1 } END { print sum + 0 }')"
BASELINE_TOTAL="$(cut -d'|' -f3 "$BASELINE_CLEAN" | awk '{ sum += $1 } END { print sum + 0 }')"

echo "TypeScript diagnostics: $CURRENT_TOTAL occurrence(s) (baseline: $BASELINE_TOTAL)"

FAILED="$(awk -F'|' '
	NR == FNR { baseline[$1 "|" $2] = $3; next }
	{
		key = $1 "|" $2
		allowed = (key in baseline) ? baseline[key] : 0
		if ($3 > allowed) print key "|" allowed "|" $3
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
