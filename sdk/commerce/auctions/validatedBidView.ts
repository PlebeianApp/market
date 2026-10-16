import type { ValidatedBidSet, BidClassification } from './bidValidation'
import type { ParsedBidEvent } from './events'

/**
 * Get the validated top amount for display. Uses `currentTopValidAmount` from
 * the validated set, with `startingBid` as a floor to match the legacy
 * baseline (see charter §8 T3).
 *
 * Returns 0 when there are no valid bids and no startingBid.
 */
export function getValidatedTopAmount(set: ValidatedBidSet, startingBid: number = 0): number {
	return Math.max(set.currentTopValidAmount, startingBid)
}

/**
 * Get the pubkey of the canonical winner from the validated set.
 *
 * Returns null when there is no canonical winner (no valid bids).
 */
export function getValidatedTopBidderPubkey(set: ValidatedBidSet): string | null {
	return set.canonicalWinner?.bidderPubkey ?? null
}

/**
 * Determine the bidder status for a given pubkey based on the validated set.
 *
 * Preserves the existing label vocabulary from auctionBidderStatus.ts:
 * - `'winning'` — user's pubkey matches the canonical winner and auction is not ended
 * - `'outbid'` — user has a valid bid but is not the canonical winner and auction is not ended
 * - `'won'` — user's pubkey matches the canonical winner and auction is ended
 * - `'was_outbid'` — user has a valid bid but is not the canonical winner and auction is ended
 * - `'none'` — user has no valid bid in the validated set
 */
export function getValidatedBidderState(
	set: ValidatedBidSet,
	pubkey: string,
	isEnded: boolean,
): 'winning' | 'outbid' | 'won' | 'was_outbid' | 'none' {
	const winnerPubkey = set.canonicalWinner?.bidderPubkey ?? null

	if (winnerPubkey === pubkey) {
		return isEnded ? 'won' : 'winning'
	}

	// Check if user has ANY valid bid (not just the winning one)
	const hasValidBid = set.validBids.some((bid) => bid.bidderPubkey === pubkey)
	if (hasValidBid) {
		return isEnded ? 'was_outbid' : 'outbid'
	}

	return 'none'
}

/**
 * Check if a specific bid (by id) is classified as `'valid'` in the validated set.
 * Returns false if the bid is not present in the set at all.
 */
export function isBidValidated(set: ValidatedBidSet, bidId: string): boolean {
	const found = set.classified.find((c) => c.bid.id === bidId)
	return found?.classification === 'valid'
}

/**
 * Get the full classification for a specific bid (by id).
 * Returns `'unknown'` if the bid is not present in the validated set.
 */
export function getBidClassification(set: ValidatedBidSet, bidId: string): BidClassification | 'unknown' {
	const found = set.classified.find((c) => c.bid.id === bidId)
	return found?.classification ?? 'unknown'
}
