#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--plan|--create] NEW_NETWORK_DIRECTORY" >&2
  exit 64
}

mode=--plan
if [[ ${1:-} == --plan || ${1:-} == --create ]]; then
  mode=$1
  shift
fi
[[ $# -eq 1 ]] || usage

target=$(realpath -m -- "$1")
case "$target" in
  /|/home|/home/maximoto|/home/maximoto/Documents|/home/maximoto/Documents/Codex)
    echo "refusing broad seed target: $target" >&2
    exit 65
    ;;
esac
if [[ -e $target ]]; then
  echo "refusing to overwrite existing path: $target" >&2
  exit 66
fi

binary=${PLEBEIAN_POC_BINARY:-"$(cd -- "$(dirname -- "$0")/.." && pwd)/bin/plebeian-auctions-poc"}
echo "new Friday fixture directory: $target"
echo "generator: $binary init --home $target"
echo "contents: fresh test-only committee, node and validator identities; never production credentials"

if [[ $mode == --plan ]]; then
  echo "PLAN ONLY: no directory or key was created"
  exit 0
fi
if [[ ${FRIDAY_SEED_EXECUTION_APPROVED:-} != "$target" ]]; then
  echo "creation is gated; set FRIDAY_SEED_EXECUTION_APPROVED to the exact target after action-time approval" >&2
  exit 67
fi
[[ -x $binary ]] || { echo "POC binary is not executable: $binary" >&2; exit 68; }
"$binary" init --home "$target"
echo "created fresh test-only fixture at $target; keep all generated private files out of chat and logs"
