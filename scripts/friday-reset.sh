#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--plan|--archive] STATE_DIRECTORY QUARANTINE_PARENT" >&2
  exit 64
}

mode=--plan
if [[ ${1:-} == --plan || ${1:-} == --archive ]]; then
  mode=$1
  shift
fi
[[ $# -eq 2 ]] || usage

state=$(realpath -m -- "$1")
quarantine_parent=$(realpath -m -- "$2")
case "$state" in
  /|/home|/home/maximoto|/home/maximoto/Documents|/home/maximoto/Documents/Codex)
    echo "refusing broad state target: $state" >&2
    exit 65
    ;;
esac
[[ -d $state ]] || { echo "state directory is absent: $state" >&2; exit 66; }
[[ $quarantine_parent != "$state" && $quarantine_parent != "$state"/* ]] || {
  echo "quarantine parent must be outside the state directory" >&2
  exit 67
}

archive="$quarantine_parent/$(basename -- "$state").friday-quarantine.$(date -u +%Y%m%dT%H%M%SZ)"
echo "source: $state"
echo "recoverable archive destination: $archive"
find "$state" -xdev -maxdepth 3 -printf '%M %u:%g %s %p\n'

if [[ $mode == --plan ]]; then
  echo "PLAN ONLY: nothing moved or deleted"
  exit 0
fi
if [[ ${FRIDAY_RESET_EXECUTION_APPROVED:-} != "$state" ]]; then
  echo "archive is gated; set FRIDAY_RESET_EXECUTION_APPROVED to the exact source after action-time approval" >&2
  exit 68
fi
[[ ! -e $archive ]] || { echo "archive destination already exists: $archive" >&2; exit 69; }
mkdir -p -m 0700 -- "$quarantine_parent"
mv -- "$state" "$archive"
echo "state archived, not deleted: $archive"
echo "a fresh replacement must be created separately with friday-seed.sh"
