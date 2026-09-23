#!/usr/bin/env bash
# ADR-018 instance-literal footprint guard, modelled on check-ndk-footprint.sh.
#
# Fails when the count of Plebeian-specific literals under src/ increases
# beyond the committed baseline. Existing occurrences are a ratcheting
# migration baseline, not an endorsement — some are legitimate (frozen
# software identity, shipped tier-3 defaults, tests), but new ones should be
# instance-config reads, not new hardcoded literals.
#
# When a change removes literals, lower scripts/instance-literals-baseline.txt
# in the same PR so the guard ratchets downward.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$ROOT/scripts/instance-literals-baseline.txt"
CURRENT="$(mktemp)"
trap 'rm -f "$CURRENT"' EXIT

# Instance identity literals named in ADR-018 (docs/adr/ADR-018-instance-configuration-and-self-hosting.md).
TOKENS=('plebeian.market' 'Plebeian Market' 'plebeian-market' 'plebian2beta')

for token in "${TOKENS[@]}"; do
	while IFS= read -r file; do
		count="$({ grep -oF "$token" "$ROOT/$file" 2>/dev/null || true; } | wc -l | tr -d ' ')"
		if [[ "$count" -gt 0 ]]; then
			printf '%s|%s|%s\n' "$file" "$token" "$count"
		fi
	done < <(find "$ROOT/src" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.html' \) -print | sed "s#^$ROOT/##" | sort)
done | sort > "$CURRENT"

CURRENT_TOTAL="$(awk -F'|' '{sum += $3} END {print sum + 0}' "$CURRENT")"
BASELINE_TOTAL="$(awk -F'|' '{sum += $3} END {print sum + 0}' "$BASELINE" 2>/dev/null || echo 0)"

echo "Instance-literal footprint: $CURRENT_TOTAL occurrence(s) (baseline: $BASELINE_TOTAL)"

if [[ "$CURRENT_TOTAL" -gt "$BASELINE_TOTAL" ]]; then
	echo ""
	echo "::error::ADR-018 instance-literal footprint increased from $BASELINE_TOTAL to $CURRENT_TOTAL."
	echo "New Plebeian-specific literals under src/ are blocked. Read the value from"
	echo "the resolved instance config (src/lib/instance-config.ts) instead. New"
	echo "frozen software-identity literals (see ADR-018) belong in the baseline with"
	echo "an inline comment explaining why they're frozen."
	echo ""
	diff -u "$BASELINE" "$CURRENT" || true
	exit 1
fi

if [[ "$CURRENT_TOTAL" -lt "$BASELINE_TOTAL" ]]; then
	echo "::notice::Instance-literal footprint decreased. Lower"
	echo "scripts/instance-literals-baseline.txt within this PR so the guard ratchets downward."
fi

echo "OK"
