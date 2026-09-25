#!/usr/bin/env bash
# Bun 1.3.x module mocks are process-wide even with `--isolate`. Run the same
# unit-test file set in separate processes so one file cannot replace modules
# observed by another file. This changes isolation only; it does not skip or
# weaken any assertion.
set -euo pipefail

BUN_BIN="${BUN_BIN:-bun}"

while IFS= read -r test_file; do
	"$BUN_BIN" test --isolate "$test_file"
done < <(
	find contextvm src -type f -name '*.test.ts' \
		! -name '*.integration.test.ts' \
		! -path 'src/ws.test.ts' \
		! -path 'src/lib/tests/newProduct.test.ts' \
		| sort
)
