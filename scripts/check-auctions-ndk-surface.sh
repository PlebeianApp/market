#!/usr/bin/env bash
# Auctions NDK-surface guard (ADR-0002, auctions publish seam).
#
# Fails if any PRODUCTION file in the auctions file set imports
# @nostr-dev-kit (runtime or type) or touches the NDK store singleton
# (ndkActions / ndkStore). Auctions relay I/O, signing, and identity must go
# through the first-party seam at src/lib/nostr/io.ts instead.
#
# Scope: the production auctions file set only (tests are out of scope).
#
# Allowlist: NIP-59 / private-claim encryption needs the raw active signer
# object, which the library-agnostic I/O seam does not expose. Such files are
# gated on the signer-capability migration (PR #1252) and carry an explicit
# ALLOWLIST entry below. Do NOT re-export the NDK store under another name to
# slip past this guard — allowlist the file and cite #1252 instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# #1252-gated allowlist — paths relative to the repo root.
ALLOWLIST=(
	# NIP-59 private-claim encrypt/decrypt needs the raw active signer (PR #1252).
	"src/lib/auctions/privateAuctionClaimMessage.ts"
)

# Production auctions file set.
shopt -s nullglob
FILES=(
	"$ROOT/src/publish/auctions.tsx"
	"$ROOT/src/queries/auctions.tsx"
	"$ROOT/src/routes/auctions.\$auctionId.tsx"
	"$ROOT"/src/components/Auction*.tsx
	"$ROOT"/src/lib/auction*.ts
	"$ROOT"/src/lib/auctions/*.ts
	"$ROOT"/src/routes/_dashboard-layout/dashboard/products/auctions*.tsx
)
shopt -u nullglob

allowed() {
	local rel="$1" entry
	for entry in "${ALLOWLIST[@]}"; do
		[ "$entry" = "$rel" ] && return 0
	done
	return 1
}

hits=()
scanned=0
for file in "${FILES[@]}"; do
	case "$file" in
		*/__tests__/* | *.test.ts) continue ;;
	esac
	rel="${file#"$ROOT"/}"
	if allowed "$rel"; then
		continue
	fi
	scanned=$((scanned + 1))
	if matches="$(grep -nE '@nostr-dev-kit|ndkActions|ndkStore' "$file" 2>/dev/null)"; then
		while IFS= read -r line; do
			hits+=("$rel:$line")
		done <<< "$matches"
	fi
done

echo "Auctions NDK-surface guard: scanned $scanned production file(s); allowlisted ${#ALLOWLIST[@]} (#1252-gated)"

if [ "${#hits[@]}" -gt 0 ]; then
	echo ""
	echo "::error::NDK API surface found in the auctions production file set:"
	printf '  %s\n' "${hits[@]}"
	echo ""
	echo "Route relay I/O, signing, and identity through src/lib/nostr/io.ts."
	echo "If a file genuinely needs the raw signer (NIP-59 / #1252), add it to the"
	echo "ALLOWLIST in this script with a comment citing #1252."
	exit 1
fi

echo "OK"
