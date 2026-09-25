const normalizeMintUrl = (mint: string): string => mint.trim().replace(/\/$/, '')

const uniqueMintUrls = (mints: readonly string[]): string[] =>
	Array.from(new Set(mints.map(normalizeMintUrl).filter((mint) => mint.length > 0)))

/**
 * Coco auctions must use the same sealed fake-mint allowlist as the Coco
 * wallet. Legacy/default wallet mints remain available outside Coco mode.
 */
export function resolveAuctionFormAvailableMints(
	cocoFakeMintAllowlist: readonly string[] | null,
	legacyAvailableMints: readonly string[],
): string[] {
	return uniqueMintUrls(cocoFakeMintAllowlist ?? legacyAvailableMints)
}

/**
 * Remove mint selections restored from another environment or an older draft.
 * If none of the saved selections are valid for the current Coco environment,
 * select the environment's complete fake-mint allowlist.
 */
export function reconcileCocoAuctionTrustedMints(currentSelection: readonly string[], cocoFakeMintAllowlist: readonly string[]): string[] {
	const allowedMints = uniqueMintUrls(cocoFakeMintAllowlist)
	const allowedSet = new Set(allowedMints)
	const retained = uniqueMintUrls(currentSelection).filter((mint) => allowedSet.has(mint))
	return retained.length > 0 ? retained : allowedMints
}
