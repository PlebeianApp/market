#!/usr/bin/env bash
set -euo pipefail

friday_repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
friday_cargo_bin=$(command -v cargo || true)
if [[ -z "$friday_cargo_bin" && -x /home/maximoto/.cargo/bin/cargo ]]; then
	friday_cargo_bin=/home/maximoto/.cargo/bin/cargo
fi
if [[ -z "$friday_cargo_bin" ]]; then
	printf 'friday-rust-gate: cargo 1.86+ is unavailable\n' >&2
	exit 127
fi

"$friday_cargo_bin" test --locked --manifest-path "$friday_repo_root/cashu-wrapper/frost-participant-3of4/Cargo.toml"
"$friday_cargo_bin" build --locked --manifest-path "$friday_repo_root/cashu-wrapper/frost-participant-3of4/Cargo.toml" --bin coco-demo-frost-participant-3of4-demo
"$friday_cargo_bin" test --locked --manifest-path "$friday_repo_root/cashu-wrapper/frost-public-inspect/Cargo.toml"
"$friday_cargo_bin" build --locked --manifest-path "$friday_repo_root/cashu-wrapper/frost-public-inspect/Cargo.toml" --bin coco-demo-frost-public-inspect
