import type { NDKTag } from '@nostr-dev-kit/ndk'

export const AUCTION_TRANSFER_DM_KIND = 14
export const AUCTION_BID_TOKEN_TOPIC = 'auction_bid_token_v1'
export const AUCTION_REFUND_TOPIC = 'auction_refund_v1'
export const AUCTION_BID_ENVELOPE_MARKER = 'bid'
export const AUCTION_REFUND_SOURCE_MARKER = 'refund_source'

export interface AuctionBidTokenEnvelope {
	type: typeof AUCTION_BID_TOKEN_TOPIC
	auctionEventId: string
	auctionCoordinates?: string
	bidEventId: string
	bidderPubkey: string
	sellerPubkey: string
	escrowPubkey: string
	refundPubkey: string
	lockPubkey: string
	locktime: number
	mintUrl: string
	amount: number
	totalBidAmount: number
	commitment: string
	bidNonce: string
	token: string
	createdAt: number
}

export interface AuctionRefundTransfer {
	mintUrl: string
	amount: number
	token: string
}

export interface AuctionRefundEnvelope {
	type: typeof AUCTION_REFUND_TOPIC
	auctionEventId: string
	auctionCoordinates?: string
	settlementEventId?: string
	sellerPubkey: string
	recipientPubkey: string
	sourceBidEventIds: string[]
	refunds: AuctionRefundTransfer[]
	createdAt: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const parseAuctionBidTokenEnvelope = (value: string): AuctionBidTokenEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_BID_TOKEN_TOPIC) return null
		if (typeof parsed.auctionEventId !== 'string' || typeof parsed.bidEventId !== 'string') return null
		if (typeof parsed.bidderPubkey !== 'string' || typeof parsed.sellerPubkey !== 'string') return null
		if (typeof parsed.escrowPubkey !== 'string' || typeof parsed.refundPubkey !== 'string') return null
		if (typeof parsed.lockPubkey !== 'string' || typeof parsed.token !== 'string') return null
		if (typeof parsed.mintUrl !== 'string' || typeof parsed.commitment !== 'string' || typeof parsed.bidNonce !== 'string') return null
		if (typeof parsed.amount !== 'number' || typeof parsed.totalBidAmount !== 'number' || typeof parsed.locktime !== 'number') return null
		return {
			type: AUCTION_BID_TOKEN_TOPIC,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: typeof parsed.auctionCoordinates === 'string' ? parsed.auctionCoordinates : undefined,
			bidEventId: parsed.bidEventId,
			bidderPubkey: parsed.bidderPubkey,
			sellerPubkey: parsed.sellerPubkey,
			escrowPubkey: parsed.escrowPubkey,
			refundPubkey: parsed.refundPubkey,
			lockPubkey: parsed.lockPubkey,
			locktime: parsed.locktime,
			mintUrl: parsed.mintUrl,
			amount: parsed.amount,
			totalBidAmount: parsed.totalBidAmount,
			commitment: parsed.commitment,
			bidNonce: parsed.bidNonce,
			token: parsed.token,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
		}
	} catch {
		return null
	}
}

export const parseAuctionRefundEnvelope = (value: string): AuctionRefundEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_REFUND_TOPIC) return null
		if (typeof parsed.auctionEventId !== 'string' || typeof parsed.sellerPubkey !== 'string' || typeof parsed.recipientPubkey !== 'string') return null
		if (!Array.isArray(parsed.sourceBidEventIds) || !Array.isArray(parsed.refunds)) return null
		const sourceBidEventIds = parsed.sourceBidEventIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
		const refunds = parsed.refunds
			.map((entry) => {
				if (!isRecord(entry)) return null
				if (typeof entry.mintUrl !== 'string' || typeof entry.token !== 'string' || typeof entry.amount !== 'number') return null
				return {
					mintUrl: entry.mintUrl,
					token: entry.token,
					amount: entry.amount,
				}
			})
			.filter((entry): entry is AuctionRefundTransfer => !!entry)

		return {
			type: AUCTION_REFUND_TOPIC,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: typeof parsed.auctionCoordinates === 'string' ? parsed.auctionCoordinates : undefined,
			settlementEventId: typeof parsed.settlementEventId === 'string' ? parsed.settlementEventId : undefined,
			sellerPubkey: parsed.sellerPubkey,
			recipientPubkey: parsed.recipientPubkey,
			sourceBidEventIds,
			refunds,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
		}
	} catch {
		return null
	}
}

export const getMarkedEventIds = (tags: NDKTag[], marker: string): string[] =>
	tags.filter((tag) => tag[0] === 'e' && tag[1] && tag[3] === marker).map((tag) => tag[1])
