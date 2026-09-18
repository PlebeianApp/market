/**
 * Bidder-side derivation-path generator. The only piece of the old
 * `cashu_p2pk_path_oracle_v1` module that survived the pivot: bidders
 * still need to generate high-entropy paths, just locally instead of
 * by calling out to a CVM oracle.
 *
 * The rest of the old module — kind-30410 registry, lock-payload
 * parsing, NIP-44 envelope verification, grant cache — was tied to
 * the oracle scheme and is gone with it. See AUCTIONS.md §5.5 for the
 * entropy requirement.
 */

import { AUCTION_PATH_HD_DEPTH, AUCTION_PATH_HD_MAX_INDEX } from './auction/constants'

const getRandomNonHardenedIndex = (): number => {
	if (globalThis.crypto?.getRandomValues) {
		const buffer = new Uint32Array(1)
		globalThis.crypto.getRandomValues(buffer)
		return buffer[0] & AUCTION_PATH_HD_MAX_INDEX
	}
	return Math.floor(Math.random() * AUCTION_PATH_HD_MAX_INDEX)
}

/**
 * Generate a fresh HD derivation path for a new bid. Five non-hardened
 * levels with uniformly random 31-bit indices (≈155 bits of entropy)
 * make brute-forcing the path from `(xpub, child_pubkey)` infeasible —
 * which matters because, in the bidder-held-path scheme, the seller
 * holds the xpriv and could otherwise enumerate sequential paths to
 * settle a bid without the bidder's cooperation.
 *
 * Returns a BIP-32-style string, e.g. `m/123/4567/.../...` (one segment
 * per AUCTION_PATH_HD_DEPTH level).
 */
export const generateAuctionDerivationPath = (): string => {
	const levels = Array.from({ length: AUCTION_PATH_HD_DEPTH }, () => getRandomNonHardenedIndex())
	return `m/${levels.join('/')}`
}
