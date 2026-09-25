#!/usr/bin/env bash
set -euo pipefail

OUTPUT="${1:?output path is required}"
VERSION='0.17.0-rc.0'

case "$(uname -m)" in
	x86_64)
		ASSET="cdk-mintd-$VERSION-x86_64"
		EXPECTED_SHA256='d6868866b0b0873faa527d7cc949427c6e3d4e2a0b92b2ec6a99319c9f33eb29'
		;;
	aarch64 | arm64)
		ASSET="cdk-mintd-$VERSION-aarch64"
		EXPECTED_SHA256='f958ea46608accd1e3525ebb3469915a88143762c5e062191ecbd8d3bbdca3cf'
		;;
	*)
		echo "Unsupported architecture for pinned cdk-mintd: $(uname -m)" >&2
		exit 1
		;;
esac

mkdir -p "$(dirname "$OUTPUT")"
TEMP_FILE="$(mktemp "${OUTPUT}.download.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT

curl --fail --location --silent --show-error \
	"https://github.com/cashubtc/cdk/releases/download/v$VERSION/$ASSET" \
	--output "$TEMP_FILE"

ACTUAL_SHA256="$(sha256sum "$TEMP_FILE" | cut -d ' ' -f 1)"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
	echo "Pinned cdk-mintd digest mismatch: expected $EXPECTED_SHA256, got $ACTUAL_SHA256" >&2
	exit 1
fi

chmod 0755 "$TEMP_FILE"
test "$($TEMP_FILE --version)" = "cdk-mintd $VERSION"
mv "$TEMP_FILE" "$OUTPUT"
