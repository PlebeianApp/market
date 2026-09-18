#!/usr/bin/env bash
# Auctions NDK-surface guard (ADR-0002, auctions publish seam).
#
# Fails if any PRODUCTION file in the auctions file set imports @nostr-dev-kit
# directly (a value import or `import type`) or touches the NDK store singleton
# (ndkActions / ndkStore). Auctions relay I/O, signing, and identity must go
# through the first-party seam at src/lib/nostr/io.ts instead.
#
# Scope: the production auctions file set only (tests are out of scope).
#
# Coverage (review 2026-09-18, item 1): the file set is NOT a hand-pinned list.
# It is assembled from pinned files that MUST exist plus glob families that MUST
# each match at least one file. If a pinned path disappears, or a family matches
# nothing, the guard FAILS instead of printing `OK` over a smaller (or empty)
# set — a silently blind guard is a gate regression. `scanned N` alone is not
# coverage evidence, so the coverage check runs before the grep. The unit tests
# set AUCTIONS_GUARD_REQUIRE_COVERAGE=0 for their throwaway repos; the real repo
# always runs strict.
#
# Out of scope (named, not silently ignored): `src/lib/stores/nip60.ts` carries
# 13 NDK-surface hits and is imported by six auction production files, but it is
# the shared NIP-60 wallet store (NDKCashuWallet / NDKZapper), not auctions-owned
# code. Moving it onto the seam is a separate wallet-migration follow-up; it is
# deliberately NOT in the scanned set and NOT in the #1252 allowlist below.
#
# Allowlist: NIP-59 / private-claim encryption needs the raw active signer
# object, which the library-agnostic I/O seam does not expose. Such files are
# gated on the signer-capability migration (PR #1252) and carry an explicit
# ALLOWLIST entry below. Do NOT re-export the NDK store under another name to
# slip past this guard — allowlist the file and cite #1252 instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Unit tests stage throwaway repos with a handful of files and set this to 0.
REQUIRE_COVERAGE="${AUCTIONS_GUARD_REQUIRE_COVERAGE:-1}"

# #1252-gated allowlist — paths relative to the repo root.
ALLOWLIST=(
	# NIP-59 private-claim encrypt/decrypt needs the raw active signer (PR #1252).
	"src/lib/auctions/privateAuctionClaimMessage.ts"
)

# Pinned production files that MUST exist. A missing pinned path means the guard
# is blind: fail (when coverage is enforced) rather than count a ghost.
PINNED=(
	"$ROOT/src/publish/auctions.tsx"
	"$ROOT/src/queries/auctions.tsx"
	"$ROOT/src/routes/_dashboard-layout/dashboard/products/bids.tsx"
)

# Glob families that MUST each match at least one file. These are the
# auction-owned production surfaces: public routes, components, the auction
# library directories, hooks, schemas, and the server-side validator.
GLOBS=(
	"$ROOT"/src/routes/auctions.*.tsx
	"$ROOT"/src/components/Auction*.tsx
	"$ROOT"/src/lib/auction*.ts
	"$ROOT"/src/lib/auction/*.ts
	"$ROOT"/src/lib/auctions/*.ts
	"$ROOT"/src/hooks/useAuction*.ts
	"$ROOT"/src/lib/schemas/auction/*.ts
	"$ROOT"/src/server/auction-validator/*.ts
	"$ROOT"/src/components/nostr/AuctionSectionGrid.tsx
	"$ROOT"/src/components/sheet-contents/auctions/*.tsx
	"$ROOT"/src/routes/_dashboard-layout/dashboard/products/auctions*.tsx
)

shopt -s nullglob
FILES=()
missing=()
for f in "${PINNED[@]}"; do
	if [ -e "$f" ]; then
		FILES+=("$f")
	else
		missing+=("$f")
	fi
done
for pattern in "${GLOBS[@]}"; do
	matched=()
	for f in $pattern; do
		if [ -e "$f" ]; then
			matched+=("$f")
		fi
	done
	if [ "${#matched[@]}" -eq 0 ]; then
		missing+=("$pattern")
	else
		FILES+=("${matched[@]}")
	fi
done
shopt -u nullglob

if [ "${#missing[@]}" -gt 0 ]; then
	echo ""
	echo "::error::Auctions NDK-surface guard coverage check failed — the file set is smaller than the gate's claim:"
	printf '  missing: %s\n' "${missing[@]}"
	echo "A pinned path was removed or a glob matched nothing. Fix the file set (or the globs) before trusting a green run."
	if [ "$REQUIRE_COVERAGE" = "1" ]; then
		exit 1
	fi
	echo "(AUCTIONS_GUARD_REQUIRE_COVERAGE=0 — staged test repo; continuing without the coverage gate.)"
fi

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

echo "Auctions NDK-surface guard: scanned $scanned production file(s); allowlisted ${#ALLOWLIST[@]} (#1252-gated); coverage strict=${REQUIRE_COVERAGE}"

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
