#!/usr/bin/env bash
set -euo pipefail

umask 077

if [[ $# -ne 1 ]]; then
  echo "usage: $0 OUTPUT_HTPASSWD" >&2
  exit 64
fi

output=$1
if [[ -e "$output" || -L "$output" ]]; then
  echo "refusing to replace existing output: $output" >&2
  exit 73
fi

output_dir=$(dirname -- "$output")
if [[ ! -d "$output_dir" ]]; then
  echo "output directory does not exist: $output_dir" >&2
  exit 73
fi

temporary=$(mktemp --tmpdir="$output_dir" .plebeian-basic-auth.XXXXXX)
cleanup() {
  unset first second || true
  if [[ -e "$temporary" ]]; then
    rm -f -- "$temporary"
  fi
}
trap cleanup EXIT HUP INT TERM

for account in demo-1 demo-2 demo-3 demo-4 demo-5; do
  while true; do
    IFS= read -r -s -p "Password for $account (20+ characters): " first
    echo >&2
    IFS= read -r -s -p "Confirm password for $account: " second
    echo >&2
    if [[ ${#first} -lt 20 ]]; then
      echo "password is too short" >&2
    elif [[ "$first" == *:* || "$first" == *$'\n'* || "$first" == *$'\r'* ]]; then
      echo "password contains a forbidden character" >&2
    elif [[ "$first" != "$second" ]]; then
      echo "passwords do not match" >&2
    else
      break
    fi
    unset first second
  done

  digest=$(printf '%s\n' "$first" | openssl passwd -6 -stdin)
  if [[ "$digest" != \$6\$* || "$digest" == *:* || "$digest" == *$'\n'* ]]; then
    echo "openssl returned an invalid SHA-512 crypt digest" >&2
    exit 70
  fi
  printf '%s:%s\n' "$account" "$digest" >>"$temporary"
  unset first second digest
done

chmod 0600 "$temporary"
ln -- "$temporary" "$output"
rm -f -- "$temporary"
trap - EXIT HUP INT TERM
echo "Wrote five password hashes to $output; no plaintext password was stored." >&2

