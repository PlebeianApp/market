import {
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
	getAuctionWindowValidBids,
	type AuctionBidChainGroup,
} from '@/lib/auctionSettlement'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

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
}

const STATUS_LABELS: Record<AuctionBidderStatusKind, string> = {
	winning: "You're winning",
	outbid: "You've been outbid",
	won: 'You had the top bid',
	was_outbid: 'You were outbid',
}

const getTopBidChain = (chains: AuctionBidChainGroup[]): AuctionBidChainGroup | null =>
	[...chains].sort(compareAuctionBidChainPriority)[0] ?? null

export function getAuctionBidderStatus(input: AuctionBidderStatusInput): AuctionBidderStatus | null {
	const currentUserPubkey = input.currentUserPubkey?.trim()
	if (!currentUserPubkey || !input.auction) return null

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
