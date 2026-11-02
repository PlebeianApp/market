#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cargo_bin=/home/maximoto/.rustup/toolchains/1.86.0-x86_64-unknown-linux-gnu/bin/cargo
export PATH=/home/maximoto/.rustup/toolchains/1.86.0-x86_64-unknown-linux-gnu/bin:/home/maximoto/.bun/bin:/usr/bin:/bin
export CARGO_HOME=/home/maximoto/.cargo
export RUSTUP_HOME=/home/maximoto/.rustup
export GOCACHE=/tmp/plebeian-friday-fips-go-build
export GOPROXY=off
export CARGO_NET_OFFLINE=true

[[ -x "$cargo_bin" ]] || { printf 'pinned Rust 1.86 cargo is unavailable\n' >&2; exit 127; }
mkdir -p "$repo_root/lab-bin"

cd "$repo_root"
go test ./...
go build -trimpath -o lab-bin/plebeian-auctions-poc .

"$cargo_bin" test --locked --offline --manifest-path cashu-wrapper/frost-participant-3of4/Cargo.toml
"$cargo_bin" build --locked --offline --release --manifest-path cashu-wrapper/frost-participant-3of4/Cargo.toml --bin coco-demo-frost-participant-3of4-demo
cp cashu-wrapper/frost-participant-3of4/target/release/coco-demo-frost-participant-3of4-demo lab-bin/coco-demo-frost-participant-3of4
"$cargo_bin" test --locked --offline --manifest-path cashu-wrapper/frost-public-inspect/Cargo.toml
"$cargo_bin" build --locked --offline --release --manifest-path cashu-wrapper/frost-public-inspect/Cargo.toml --bin coco-demo-frost-public-inspect
cp cashu-wrapper/frost-public-inspect/target/release/coco-demo-frost-public-inspect lab-bin/coco-demo-frost-public-inspect

cd "$repo_root/cashu-wrapper/ts"
bun run typecheck:friday
bun build ./demo-fips-dkg-cli.ts --compile --target=bun-linux-x64-modern --outfile ../../lab-bin/plebeian-friday-frost-dkg
bun build ./demo-fips-signer-cli.ts --compile --target=bun-linux-x64-modern --outfile ../../lab-bin/plebeian-friday-signer
bun build ./demo-fips-integrated-driver.ts --compile --target=bun-linux-x64-modern --outfile ../../lab-bin/plebeian-friday-integrated-driver

cd "$repo_root"
chmod 0755 lab-bin/plebeian-auctions-poc lab-bin/coco-demo-frost-participant-3of4 \
  lab-bin/coco-demo-frost-public-inspect lab-bin/plebeian-friday-frost-dkg \
  lab-bin/plebeian-friday-signer lab-bin/plebeian-friday-integrated-driver
/usr/bin/python3.12 -m py_compile scripts/friday-fips-lab-r2.py scripts/friday-fips-mint-bootstrap.py
sha256sum lab-bin/plebeian-auctions-poc lab-bin/coco-demo-frost-participant-3of4 \
  lab-bin/coco-demo-frost-public-inspect lab-bin/plebeian-friday-frost-dkg \
  lab-bin/plebeian-friday-signer lab-bin/plebeian-friday-integrated-driver \
  scripts/friday-fips-lab-r2.py scripts/friday-fips-mint-bootstrap.py
