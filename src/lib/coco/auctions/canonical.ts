import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { CocoAuctionAccountIdentity, CocoAuctionBidIntent, CocoAuctionReference } from './types'

const HEX_32 = /^[0-9a-f]{64}$/

const canonicalObject = (value: unknown): unknown => {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Canonical Auction identity cannot contain a non-finite number')
		return value
	}
	if (Array.isArray(value)) return value.map(canonicalObject)
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, child]) => child !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalObject(child)]),
		)
	}
	throw new Error('Canonical Auction identity contains a non-serializable value')
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalObject(value))

export const fingerprintCocoAuctionValue = (value: unknown): string => bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))))

export const normalizeCocoMintUrl = (value: string): string => {
	let parsed: URL
	try {
		parsed = new URL(value.trim())
	} catch {
		throw new Error('Coco Auction mint URL is invalid')
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Coco Auction mint URL must use HTTP(S)')
	parsed.hash = ''
	parsed.search = ''
	parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
	return parsed.toString().replace(/\/$/, '')
}

export const assertCocoAuctionAccountIdentity = (identity: CocoAuctionAccountIdentity): CocoAuctionAccountIdentity => {
	const accountPubkey = identity.accountPubkey.trim().toLowerCase()
	if (!HEX_32.test(accountPubkey)) throw new Error('Coco Auction account identity must be a 32-byte lowercase hex pubkey')
	const environmentId = identity.environmentId.trim()
	if (!environmentId || environmentId !== identity.environmentId) throw new Error('Coco Auction environment identity is required and exact')
	return Object.freeze({ accountPubkey, environmentId })
}

export const assertCocoAuctionReference = (reference: CocoAuctionReference): CocoAuctionReference => {
	const rootEventId = reference.rootEventId.trim().toLowerCase()
	if (!HEX_32.test(rootEventId)) throw new Error('Coco Auction root event id must be a 32-byte hex id')
	const parts = reference.coordinate.split(':')
	if (parts.length !== 3 || parts[0] !== '30408' || !HEX_32.test(parts[1]) || !parts[2]) {
		throw new Error('Coco Auction coordinate must be 30408:<seller-pubkey>:<d>')
	}
	return Object.freeze({ rootEventId, coordinate: `30408:${parts[1].toLowerCase()}:${parts[2]}` })
}

export const normalizeCocoAuctionBidIntent = (intent: CocoAuctionBidIntent): CocoAuctionBidIntent => {
	if (!intent.commandId || intent.commandId.trim() !== intent.commandId)
		throw new Error('Coco Auction command id must be non-empty and exact')
	const account = assertCocoAuctionAccountIdentity(intent.account)
	const auction = assertCocoAuctionReference(intent.auction)
	const bidderPubkey = intent.bidderPubkey.trim().toLowerCase()
	const sellerPubkey = intent.sellerPubkey.trim().toLowerCase()
	if (!HEX_32.test(bidderPubkey) || !HEX_32.test(sellerPubkey))
		throw new Error('Coco Auction signer identities must be 32-byte hex pubkeys')
	if (!intent.sellerPublicAuthority.trim() || intent.sellerPublicAuthority.trim() !== intent.sellerPublicAuthority) {
		throw new Error('Coco Auction seller public authority is required and exact')
	}
	if (account.accountPubkey !== bidderPubkey) throw new Error('Coco Auction command account does not match the bidder signer')
	if (auction.coordinate.split(':')[1] !== sellerPubkey) throw new Error('Coco Auction seller does not match the addressable coordinate')
	if (!Number.isSafeInteger(intent.grossAmount) || intent.grossAmount <= 0)
		throw new Error('Coco Auction gross amount must be positive integer sats')
	if (!Number.isSafeInteger(intent.amount) || intent.amount <= 0 || intent.amount > intent.grossAmount) {
		throw new Error('Coco Auction Send amount must be positive integer sats not exceeding the gross bid')
	}
	if (!Number.isSafeInteger(intent.locktime) || intent.locktime <= 0)
		throw new Error('Coco Auction locktime must be a positive unix timestamp')
	if (!Number.isSafeInteger(intent.createdForEndAt) || intent.createdForEndAt <= 0) {
		throw new Error('Coco Auction effective end time must be a positive unix timestamp')
	}
	return Object.freeze({
		...intent,
		account,
		auction,
		bidderPubkey,
		sellerPubkey,
		sellerPublicAuthority: intent.sellerPublicAuthority,
		mintUrl: normalizeCocoMintUrl(intent.mintUrl),
		unit: 'sat',
	})
}

export const cocoAuctionBidIntentFingerprint = (intent: CocoAuctionBidIntent): string => {
	const normalized = normalizeCocoAuctionBidIntent(intent)
	return fingerprintCocoAuctionValue({
		account: normalized.account,
		auction: normalized.auction,
		bidderPubkey: normalized.bidderPubkey,
		sellerPubkey: normalized.sellerPubkey,
		sellerPublicAuthority: normalized.sellerPublicAuthority,
		mintUrl: normalized.mintUrl,
		unit: normalized.unit,
		grossAmount: normalized.grossAmount,
		amount: normalized.amount,
		locktime: normalized.locktime,
		createdForEndAt: normalized.createdForEndAt,
		previousBidEventId: normalized.previousBidEventId ?? null,
	})
}

export const deriveCocoAuctionCommandId = (
	kind: 'prepare-bid' | 'winner-release' | 'winner-receive' | 'loser-refund',
	identity: Readonly<Record<string, unknown>>,
): string => `pm:coco-v2:auction:${kind}:${fingerprintCocoAuctionValue(identity)}`

export const deriveCocoAuctionBidCommandId = (intent: Omit<CocoAuctionBidIntent, 'commandId'>): string =>
	deriveCocoAuctionCommandId('prepare-bid', {
		account: intent.account,
		auction: intent.auction,
		bidderPubkey: intent.bidderPubkey,
		sellerPubkey: intent.sellerPubkey,
		sellerPublicAuthority: intent.sellerPublicAuthority,
		mintUrl: normalizeCocoMintUrl(intent.mintUrl),
		unit: intent.unit,
		grossAmount: intent.grossAmount,
		amount: intent.amount,
		locktime: intent.locktime,
		createdForEndAt: intent.createdForEndAt,
		previousBidEventId: intent.previousBidEventId ?? null,
	})
