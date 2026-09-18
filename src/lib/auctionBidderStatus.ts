import {
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
	getAuctionWindowValidBids,
	type AuctionBidChainGroup,
} from '@/lib/auctionSettlement'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { ValidatedBidSet } from '@/lib/auction/bidValidation'
import { getValidatedBidderState } from '@/lib/auction/validatedBidView'

export type AuctionBidderStatusKind = 'winning' | 'outbid' | 'won' | 'was_outbid'

export interface AuctionBidderStatus {
	status: AuctionBidderStatusKind
	label: string
}

export interface AuctionBidderStatusInput {
	currentUserPubkey?: string | null
	auction: NDKEvent | null
	bids: NDKEvent[]
	isEnded: boolean
	/**
	 * Optional validated bid set. When present, the status is derived from
	 * the validated set's canonicalWinner and validBids instead of the raw
	 * bid chains.
	 */
	validatedBidSet?: ValidatedBidSet | null
}

const STATUS_LABELS: Record<AuctionBidderStatusKind, string> = {
	winning: "You're winning",
	outbid: "You've been outbid",
	won: 'You had the top bid',
	was_outbid: 'You were outbid',
}

const getTopBidChain = (chains: AuctionBidChainGroup[]): AuctionBidChainGroup | null =>
	[...chains].sort(compareAuctionBidChainPriority)[0] ?? null

/**
 * Derive the bidder status straight from a validated bid set, skipping the raw
 * bid-chain computation entirely. Returns `null` when the pubkey has no valid
 * bid in the set (`'none'`).
 *
 * This is the validated half of `getAuctionBidderStatus`; it is declared above
 * it so the delegation reads top-down and the `'none'` → `null` mapping exists
 * exactly once.
 */
export function getValidatedBidderStatus(pubkey: string, set: ValidatedBidSet, isEnded: boolean): AuctionBidderStatus | null {
	const state = getValidatedBidderState(set, pubkey, isEnded)
	if (state === 'none') return null
	return {
		status: state,
		label: STATUS_LABELS[state],
	}
}

export function getAuctionBidderStatus(input: AuctionBidderStatusInput): AuctionBidderStatus | null {
	const currentUserPubkey = input.currentUserPubkey?.trim()
	if (!currentUserPubkey || !input.auction) return null

	// When a validated bid set is provided, use the validated path.
	if (input.validatedBidSet) {
		return getValidatedBidderStatus(currentUserPubkey, input.validatedBidSet, input.isEnded)
	}

	// Legacy path: derive from raw bid chains (fallback).
	let chains: AuctionBidChainGroup[]
	try {
		chains = buildActiveAuctionBidChains(getAuctionWindowValidBids(input.auction, input.bids))
	} catch {
		return null
	}

	const userChain = chains.find((chain) => chain.bidderPubkey === currentUserPubkey)
	if (!userChain) return null

	const topChain = getTopBidChain(chains)
	if (!topChain) return null

	const status: AuctionBidderStatusKind =
		topChain.bidderPubkey === currentUserPubkey ? (input.isEnded ? 'won' : 'winning') : input.isEnded ? 'was_outbid' : 'outbid'

	return {
		status,
		label: STATUS_LABELS[status],
	}
}
