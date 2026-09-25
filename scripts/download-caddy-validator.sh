#!/usr/bin/env bash
# Fetch the build-only Caddy syntax validator from the official release. This
# binary is never included in the AuctionsDev release package.
set -euo pipefail

OUTPUT="${1:?output path is required}"
VERSION='2.10.2'

case "$(uname -m)" in
	x86_64)
		ARCH='amd64'
		EXPECTED_SHA256='5c218bc34c9197369263da7e9317a83acdbd80ef45d94dca5eff76e727c67cdd'
		;;
	aarch64 | arm64)
		ARCH='arm64'
		EXPECTED_SHA256='501e955fa634c5aab63247458c3ac655cfdd6cbf1e0436528f41248451c190ac'
		;;
	*)
		echo "Unsupported architecture for pinned Caddy validator: $(uname -m)" >&2
		exit 1
		;;
esac

mkdir -p "$(dirname "$OUTPUT")"
DOWNLOAD_DIR="$(mktemp -d "$(dirname "$OUTPUT")/.caddy-download.XXXXXX")"
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT
ARCHIVE="$DOWNLOAD_DIR/caddy.tar.gz"

curl --fail --location --silent --show-error \
	"https://github.com/caddyserver/caddy/releases/download/v$VERSION/caddy_${VERSION}_linux_${ARCH}.tar.gz" \
	--output "$ARCHIVE"

ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | cut -d ' ' -f 1)"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
	echo "Pinned Caddy digest mismatch: expected $EXPECTED_SHA256, got $ACTUAL_SHA256" >&2
	exit 1
fi

tar -xzf "$ARCHIVE" -C "$DOWNLOAD_DIR" caddy
chmod 0755 "$DOWNLOAD_DIR/caddy"
"$DOWNLOAD_DIR/caddy" version | grep -q "^v$VERSION "
mv "$DOWNLOAD_DIR/caddy" "$OUTPUT"
