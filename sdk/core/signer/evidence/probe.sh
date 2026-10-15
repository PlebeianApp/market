#!/usr/bin/env bash
#
# signer/evidence/probe.sh — re-runs the red team's own probes against the repaired module.
#
# These probes are **not part of this module**. A2 wrote them from scratch against the
# public entry alone (its own storage port, its own WebCrypto crypto port, its own clock,
# its own in-process NIP-46 remote, its own injected extension) and they live outside the
# assembly. They are run here unmodified, and their output is captured beside this script,
# because "the block is cleared" is a claim about an independent consumer's verdict rather
# than about the module's own suite — and a module grading its own repair is worth nothing.
#
# If the probe directory is absent this writes that absence and stops: it does not pretend
# to have measured anything. The module's own suite is the standing check.
#
# Usage:  bash signer/evidence/probe.sh          (A2_PROBE=<dir> to point elsewhere)
#
set -euo pipefail

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="${A2_PROBE:-/home/admin_maxime/work/signer-a2-probe}"
OUT="$MODULE/evidence/03-a2-probe-after.txt"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

{
	echo "signer module — the red team's probes, re-run against the repaired module"
	echo "# command:   bash signer/evidence/probe.sh"
	echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)   bun: $("$BUN" --version)"
	echo "# probe dir: $PROBE"
	echo "# note: the probe files are A2's, are NOT part of this module, and are run unmodified."
	echo "#       Their own files were not edited by this pass: where a probe still asserts the"
	echo "#       pre-repair behaviour it now stops on the repair (see attacks.ts below)."
	echo ""

	if [ ! -d "$PROBE" ]; then
		echo "PROBE ABSENT: $PROBE does not exist — nothing was measured by this script."
		echo "The module's own suite (signer/ts) is the standing check; see record.md."
	else
		for file in consumer.ts leak-qr.ts envelope-cross.ts attacks.ts; do
			echo "======================================================================"
			echo "\$ cd $PROBE && bun run $file"
			echo ""
			code=0
			( cd "$PROBE" && timeout 600 "$BUN" run "$file" ) 2>&1 || code=$?
			echo "exit: $code"
			echo ""
		done
	fi
} >"$OUT" 2>&1

echo "wrote $OUT"
