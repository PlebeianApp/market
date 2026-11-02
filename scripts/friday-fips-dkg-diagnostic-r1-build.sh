#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bun_bin=/home/maximoto/.bun/bin/bun
expected_bun_sha256=6d5bb405b1d037a2a466b92757de7e47e4369930fa94bd42f8ff44ba49de6c57
output_dir="$repo_root/lab-bin-dkg-diagnostic-r1"

[[ -x "$bun_bin" ]] || { printf 'pinned Bun is unavailable\n' >&2; exit 127; }
[[ "$(sha256sum "$bun_bin" | awk '{print $1}')" == "$expected_bun_sha256" ]] \
  || { printf 'pinned Bun differs\n' >&2; exit 1; }
install -d -m 0755 "$output_dir"

cd "$repo_root"
/usr/bin/python3 -m py_compile \
  scripts/friday-fips-dkg-diagnostic-r1.py \
  scripts/friday-fips-dkg-diagnostic-r1.test.py
/usr/bin/python3 -I -B scripts/friday-fips-dkg-diagnostic-r1.test.py

cd "$repo_root/cashu-wrapper/ts"
"$bun_bin" run typecheck:friday
"$bun_bin" test demo-fips-dkg-phase-journal.test.ts
"$bun_bin" build ./demo-fips-dkg-cli.ts --compile --target=bun-linux-x64-modern \
  --outfile="$output_dir/plebeian-friday-frost-dkg"

cd "$repo_root"
chmod 0755 "$output_dir/plebeian-friday-frost-dkg"
sha256sum \
  "$output_dir/plebeian-friday-frost-dkg" \
  lab-bin/coco-demo-frost-participant-3of4 \
  lab-bin/coco-demo-frost-public-inspect \
  scripts/friday-fips-dkg-diagnostic-r1.py
