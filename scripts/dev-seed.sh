#!/bin/bash
set -e
# Use system bun, not the empty stub from node_modules/.bin
BUN=$(which -a bun | grep -v node_modules | head -1)
if [ -z "$BUN" ]; then
    echo "Error: bun not found in PATH"
    exit 1
fi
$BUN scripts/startup.ts
$BUN scripts/seed.ts
exec $BUN --hot src/index.tsx --host 0.0.0.0
