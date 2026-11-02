#!/usr/bin/env bash
set -euo pipefail

readonly LEGO_VERSION="5.3.1"
readonly LEGO_ARCHIVE="lego_v${LEGO_VERSION}_linux_amd64.tar.gz"
readonly LEGO_RELEASE="https://github.com/go-acme/lego/releases/download/v${LEGO_VERSION}"

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "unsupported architecture: $(uname -m)" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$work_dir/$LEGO_ARCHIVE" \
  "$LEGO_RELEASE/$LEGO_ARCHIVE"
curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$work_dir/lego_checksums.txt" \
  "$LEGO_RELEASE/lego_${LEGO_VERSION}_checksums.txt"

grep -E "^[0-9a-f]{64}  ${LEGO_ARCHIVE}$" \
  "$work_dir/lego_checksums.txt" >"$work_dir/selected_checksum.txt"
[[ "$(wc -l <"$work_dir/selected_checksum.txt")" -eq 1 ]]
(
  cd "$work_dir"
  sha256sum --check selected_checksum.txt
  tar -xzf "$LEGO_ARCHIVE" lego
)

install -o root -g root -m 0755 "$work_dir/lego" /usr/local/bin/lego
/usr/local/bin/lego --version

# Do not let package installation expose Ubuntu's default port-80 server.
systemctl mask nginx.service
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nginx
systemctl disable nginx.service >/dev/null 2>&1 || true
if systemctl is-active --quiet nginx.service; then
  echo "nginx unexpectedly active after masked installation" >&2
  exit 1
fi

dpkg-query -W nginx
systemctl is-active plebeian-poc-validator@1.service
