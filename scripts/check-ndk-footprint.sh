#!/usr/bin/env bash
# NDK footprint guard for the NDK -> applesauce migration.
# (see docs/ndk-to-applesauce-migration-plan.md)
#
# Fails if the number of source files importing @nostr-dev-kit has INCREASED
# beyond the committed baseline. This blocks new files with NDK imports while
# the migration is underway, but it does not detect additional NDK usage inside
# an already-counted file. New relay I/O must route through the library-agnostic
# seam at src/lib/nostr/io.ts instead.
#
# When a wave REDUCES the footprint, that wave's PR should also lower the
# baseline in scripts/ndk-baseline.txt so the guard ratchets downward.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_FILE="$ROOT/scripts/ndk-baseline.txt"
BASELINE="$(head -n1 "$BASELINE_FILE" | tr -dc '0-9')"

CURRENT="$(grep -rl "@nostr-dev-kit" --include="*.ts" --include="*.tsx" "$ROOT/src" "$ROOT/contextvm" 2>/dev/null | wc -l | tr -d ' ')"

echo "NDK footprint: $CURRENT file(s) import @nostr-dev-kit (baseline: $BASELINE)"

if [ "$CURRENT" -gt "$BASELINE" ]; then
	echo ""
	echo "::error::NDK footprint increased from $BASELINE to $CURRENT."
	echo "New files importing @nostr-dev-kit are blocked during the migration."
	echo "Route subscribe/fetch/publish through src/lib/nostr/io.ts"
	echo "(the strangler-fig seam) instead. See"
	echo "docs/ndk-to-applesauce-migration-plan.md for the pattern."
	exit 1
fi

if [ "$CURRENT" -lt "$BASELINE" ]; then
	echo "::notice::NDK footprint decreased. Lower the baseline in"
	echo "scripts/ndk-baseline.txt within this PR so the guard ratchets downward."
fi

echo "OK"
