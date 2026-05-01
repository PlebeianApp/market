import type { NDKTag } from '@nostr-dev-kit/ndk'

export const AUCTION_TRANSFER_DM_KIND = 14
export const AUCTION_BID_TOKEN_TOPIC = 'auction_bid_token_v1'
export const AUCTION_REFUND_TOPIC = 'auction_refund_v1'
export const AUCTION_PATH_REQUEST_TOPIC = 'auction_path_request_v1'
export const AUCTION_PATH_GRANT_TOPIC = 'auction_path_grant_v1'
export const AUCTION_PATH_RELEASE_TOPIC = 'auction_path_release_v1'
export const AUCTION_BID_ENVELOPE_MARKER = 'bid'
export const AUCTION_REFUND_SOURCE_MARKER = 'refund_source'

export interface AuctionBidTokenEnvelope {
	type: typeof AUCTION_BID_TOKEN_TOPIC
	auctionEventId: string
	auctionCoordinates?: string
	bidEventId: string
	bidderPubkey: string
	sellerPubkey: string
	pathIssuerPubkey: string
	refundPubkey: string
	lockPubkey: string
	locktime: number
	mintUrl: string
	amount: number
	totalBidAmount: number
	commitment: string
	bidNonce: string
	grantId?: string
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
	senderPubkey: string
	recipientPubkey: string
	sourceBidEventIds: string[]
	refunds: AuctionRefundTransfer[]
	createdAt: number
}

export interface AuctionPathRequestEnvelope {
	type: typeof AUCTION_PATH_REQUEST_TOPIC
	requestId: string
	auctionEventId: string
	auctionCoordinates: string
	bidderPubkey: string
	bidderRefundPubkey: string
	createdAt: number
}

export interface AuctionPathGrantEnvelope {
	type: typeof AUCTION_PATH_GRANT_TOPIC
	grantId: string
	requestId: string
	auctionEventId: string
	auctionCoordinates: string
	bidderPubkey: string
	pathIssuerPubkey: string
	xpub: string
	derivationPath: string
	childPubkey: string
	issuedAt: number
	expiresAt: number
}

export interface AuctionPathReleaseEntry {
	bidEventId: string
	derivationPath: string
	childPubkey: string
}

export interface AuctionPathReleaseEnvelope {
	type: typeof AUCTION_PATH_RELEASE_TOPIC
	releaseId: string
	auctionEventId: string
	auctionCoordinates: string
	sellerPubkey: string
	pathIssuerPubkey: string
	winningBidEventId: string
	winnerPubkey: string
	releases: AuctionPathReleaseEntry[]
	finalAmount: number
	releasedAt: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const parseAuctionBidTokenEnvelope = (value: string): AuctionBidTokenEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_BID_TOKEN_TOPIC) return null
		if (!isNonEmptyString(parsed.auctionEventId) || !isNonEmptyString(parsed.bidEventId)) return null
		if (!isNonEmptyString(parsed.bidderPubkey) || !isNonEmptyString(parsed.sellerPubkey)) return null
		if (!isNonEmptyString(parsed.pathIssuerPubkey) || !isNonEmptyString(parsed.refundPubkey)) return null
		if (!isNonEmptyString(parsed.lockPubkey) || !isNonEmptyString(parsed.token)) return null
		if (!isNonEmptyString(parsed.mintUrl) || !isNonEmptyString(parsed.commitment) || !isNonEmptyString(parsed.bidNonce)) return null
		if (typeof parsed.amount !== 'number' || typeof parsed.totalBidAmount !== 'number' || typeof parsed.locktime !== 'number') return null
		return {
			type: AUCTION_BID_TOKEN_TOPIC,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: typeof parsed.auctionCoordinates === 'string' ? parsed.auctionCoordinates : undefined,
			bidEventId: parsed.bidEventId,
			bidderPubkey: parsed.bidderPubkey,
			sellerPubkey: parsed.sellerPubkey,
			pathIssuerPubkey: parsed.pathIssuerPubkey,
			refundPubkey: parsed.refundPubkey,
			lockPubkey: parsed.lockPubkey,
			locktime: parsed.locktime,
			mintUrl: parsed.mintUrl,
			amount: parsed.amount,
			totalBidAmount: parsed.totalBidAmount,
			commitment: parsed.commitment,
			bidNonce: parsed.bidNonce,
			grantId: typeof parsed.grantId === 'string' ? parsed.grantId : undefined,
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
		if (!isNonEmptyString(parsed.auctionEventId) || !isNonEmptyString(parsed.recipientPubkey)) return null
		const senderPubkey = isNonEmptyString(parsed.senderPubkey)
			? parsed.senderPubkey
			: isNonEmptyString((parsed as { sellerPubkey?: unknown }).sellerPubkey)
				? (parsed as { sellerPubkey: string }).sellerPubkey
				: null
		if (!senderPubkey) return null
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
			senderPubkey,
			recipientPubkey: parsed.recipientPubkey,
			sourceBidEventIds,
			refunds,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
		}
	} catch {
		return null
	}
}

export const parseAuctionPathRequestEnvelope = (value: string): AuctionPathRequestEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_PATH_REQUEST_TOPIC) return null
		if (!isNonEmptyString(parsed.requestId) || !isNonEmptyString(parsed.auctionEventId)) return null
		if (!isNonEmptyString(parsed.auctionCoordinates) || !isNonEmptyString(parsed.bidderPubkey)) return null
		if (!isNonEmptyString(parsed.bidderRefundPubkey)) return null
		return {
			type: AUCTION_PATH_REQUEST_TOPIC,
			requestId: parsed.requestId,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: parsed.auctionCoordinates,
			bidderPubkey: parsed.bidderPubkey,
			bidderRefundPubkey: parsed.bidderRefundPubkey,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
		}
	} catch {
		return null
	}
}

export const parseAuctionPathGrantEnvelope = (value: string): AuctionPathGrantEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_PATH_GRANT_TOPIC) return null
		if (!isNonEmptyString(parsed.grantId) || !isNonEmptyString(parsed.requestId)) return null
		if (!isNonEmptyString(parsed.auctionEventId) || !isNonEmptyString(parsed.auctionCoordinates)) return null
		if (!isNonEmptyString(parsed.bidderPubkey) || !isNonEmptyString(parsed.pathIssuerPubkey)) return null
		if (!isNonEmptyString(parsed.xpub) || !isNonEmptyString(parsed.derivationPath) || !isNonEmptyString(parsed.childPubkey)) return null
		if (typeof parsed.issuedAt !== 'number' || typeof parsed.expiresAt !== 'number') return null
		return {
			type: AUCTION_PATH_GRANT_TOPIC,
			grantId: parsed.grantId,
			requestId: parsed.requestId,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: parsed.auctionCoordinates,
			bidderPubkey: parsed.bidderPubkey,
			pathIssuerPubkey: parsed.pathIssuerPubkey,
			xpub: parsed.xpub,
			derivationPath: parsed.derivationPath,
			childPubkey: parsed.childPubkey,
			issuedAt: parsed.issuedAt,
			expiresAt: parsed.expiresAt,
		}
	} catch {
		return null
	}
}

export const parseAuctionPathReleaseEnvelope = (value: string): AuctionPathReleaseEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_PATH_RELEASE_TOPIC) return null
		if (!isNonEmptyString(parsed.releaseId) || !isNonEmptyString(parsed.auctionEventId)) return null
		if (!isNonEmptyString(parsed.auctionCoordinates) || !isNonEmptyString(parsed.sellerPubkey)) return null
		if (!isNonEmptyString(parsed.pathIssuerPubkey) || !isNonEmptyString(parsed.winningBidEventId)) return null
		if (!isNonEmptyString(parsed.winnerPubkey)) return null
		if (!Array.isArray(parsed.releases)) return null
		const releases = parsed.releases
			.map((entry) => {
				if (!isRecord(entry)) return null
				if (!isNonEmptyString(entry.bidEventId) || !isNonEmptyString(entry.derivationPath) || !isNonEmptyString(entry.childPubkey)) {
					return null
				}
				return {
					bidEventId: entry.bidEventId,
					derivationPath: entry.derivationPath,
					childPubkey: entry.childPubkey,
				}
			})
			.filter((entry): entry is AuctionPathReleaseEntry => !!entry)
		if (!releases.length) return null
		if (typeof parsed.finalAmount !== 'number') return null
		return {
			type: AUCTION_PATH_RELEASE_TOPIC,
			releaseId: parsed.releaseId,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: parsed.auctionCoordinates,
			sellerPubkey: parsed.sellerPubkey,
			pathIssuerPubkey: parsed.pathIssuerPubkey,
			winningBidEventId: parsed.winningBidEventId,
			winnerPubkey: parsed.winnerPubkey,
			releases,
			finalAmount: parsed.finalAmount,
			releasedAt: typeof parsed.releasedAt === 'number' ? parsed.releasedAt : Date.now(),
		}
	} catch {
		return null
	}
}

export const getMarkedEventIds = (tags: NDKTag[], marker: string): string[] =>
	tags.filter((tag) => tag[0] === 'e' && tag[1] && tag[3] === marker).map((tag) => tag[1])
