import { getAuctionTagValue } from '../../lib/auctionSettlement'
import {
	AUCTION_PATH_GRANT_DEFAULT_TTL_SECONDS,
	AUCTION_PATH_REGISTRY_SCHEMA,
	allocateAuctionPath,
	buildAuctionPathRegistry,
	upsertAuctionPathEntry,
	type AuctionPathRegistryEntry,
} from '../../lib/auctionPathOracle'
import { getAppPublicKeyOrThrow } from '../runtime'
import { fetchAuctionPathRegistry, publishAuctionPathRegistry } from './registry'
import { getAuctionPathIssuerFromEvent, loadAuctionEvent } from './loadAuction'

/**
 * AUCTIONS.md §7.5.1: the issuer applies rate limits per bidder per
 * auction and deduplicates by `(auctionEventId, bidderPubkey, requestId)`.
 * We do this in-process — Bun runs a single issuer instance, and the
 * registry on Nostr is the durable record. Restarting the process resets
 * these caches; per-bidder rate limits are a courtesy, not a security
 * boundary (the durable spam control is the path-allocation cost).
 */
const AUCTION_PATH_REQUEST_DEDUP_WINDOW_S = 30 * 60
const AUCTION_PATH_REQUEST_RATE_LIMIT_WINDOW_S = 60
const AUCTION_PATH_REQUEST_RATE_LIMIT_MAX = 10
const auctionPathRequestSeen = new Map<string, number>()
const auctionPathRequestRecentByBidder = new Map<string, number[]>()

const enforceAuctionPathRequestRateLimit = (params: { auctionEventId: string; bidderPubkey: string; requestId: string }): void => {
	const now = Math.floor(Date.now() / 1000)

	// Periodic GC so the maps don't grow unbounded across long-lived runs.
	if (auctionPathRequestSeen.size > 4096) {
		for (const [key, ts] of Array.from(auctionPathRequestSeen.entries())) {
			if (now - ts > AUCTION_PATH_REQUEST_DEDUP_WINDOW_S) auctionPathRequestSeen.delete(key)
		}
	}

	const dedupKey = `${params.auctionEventId}:${params.bidderPubkey}:${params.requestId}`
	if (auctionPathRequestSeen.has(dedupKey)) {
		throw new Error('Duplicate path request id (already processed)')
	}

	const rateKey = `${params.auctionEventId}:${params.bidderPubkey}`
	const cutoff = now - AUCTION_PATH_REQUEST_RATE_LIMIT_WINDOW_S
	const recent = (auctionPathRequestRecentByBidder.get(rateKey) ?? []).filter((ts) => ts > cutoff)
	if (recent.length >= AUCTION_PATH_REQUEST_RATE_LIMIT_MAX) {
		throw new Error('Too many path requests for this auction; please slow down')
	}
	recent.push(now)
	auctionPathRequestRecentByBidder.set(rateKey, recent)
	auctionPathRequestSeen.set(dedupKey, now)
}

const NOSTR_PUBKEY_HEX_RE = /^[0-9a-f]{64}$/i
const COMPRESSED_SECP256K1_PUBKEY_HEX_RE = /^0[23][0-9a-f]{64}$/i

export interface AuctionPathGrant {
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

export async function buildAuctionPathGrant(params: {
	requestId: string
	auctionEventId: string
	auctionCoordinates: string
	bidderPubkey: string
	bidderRefundPubkey: string
}): Promise<AuctionPathGrant> {
	// AUCTIONS.md §7.5.1 input validation. The HTTP endpoint already enforces
	// NIP-98 caller identity == bidderPubkey, so by the time we get here we
	// know who we're talking to — but we still validate the raw fields so
	// downstream code (path-derivation, registry persistence) gets clean
	// inputs only.
	if (!NOSTR_PUBKEY_HEX_RE.test(params.bidderPubkey)) {
		throw new Error('bidderPubkey must be a 32-byte hex Nostr pubkey')
	}
	if (!COMPRESSED_SECP256K1_PUBKEY_HEX_RE.test(params.bidderRefundPubkey)) {
		throw new Error('bidderRefundPubkey must be a compressed secp256k1 pubkey (33 bytes hex, 02/03 prefix)')
	}

	enforceAuctionPathRequestRateLimit({
		auctionEventId: params.auctionEventId,
		bidderPubkey: params.bidderPubkey,
		requestId: params.requestId,
	})

	const appPubkey = getAppPublicKeyOrThrow()
	const auctionEvent = await loadAuctionEvent(params.auctionEventId)
	const issuerPubkey = getAuctionPathIssuerFromEvent(auctionEvent)
	if (issuerPubkey !== appPubkey) {
		throw new Error('Auction is not configured for this path issuer')
	}

	const xpub = getAuctionTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!xpub) {
		throw new Error('Auction is missing p2pk_xpub')
	}

	const now = Math.floor(Date.now() / 1000)
	const startAt = Number(getAuctionTagValue(auctionEvent, 'start_at') || 0)
	const endAt = Number(getAuctionTagValue(auctionEvent, 'end_at') || 0)
	// max_end_at is the hard bidding cutoff (timestamp #2 of the three-
	// timestamp protocol invariant: end_at → max_end_at → locktime). New
	// auctions always emit it; older auctions without the tag fall back to
	// end_at so we don't accidentally allow bids forever on legacy data.
	const maxEndAt = Number(getAuctionTagValue(auctionEvent, 'max_end_at') || 0) || endAt
	if (startAt && now < startAt) {
		throw new Error('Auction has not started yet')
	}
	if (maxEndAt && now >= maxEndAt) {
		throw new Error('Auction has reached its hard bidding cutoff')
	}

	const registry = (await fetchAuctionPathRegistry(params.auctionEventId)) ?? {
		type: AUCTION_PATH_REGISTRY_SCHEMA,
		auctionEventId: params.auctionEventId,
		auctionCoordinates: params.auctionCoordinates,
		xpub,
		entries: [],
		updatedAt: Date.now(),
	}
	if (registry.xpub && registry.xpub !== xpub) {
		throw new Error('Auction xpub changed since registry was initialised')
	}

	const allocated = allocateAuctionPath({
		auctionEventId: params.auctionEventId,
		auctionCoordinates: params.auctionCoordinates,
		xpub,
		bidderPubkey: params.bidderPubkey,
		existingEntries: registry.entries,
	})

	const newEntry: AuctionPathRegistryEntry = {
		bidderPubkey: params.bidderPubkey,
		derivationPath: allocated.derivationPath,
		childPubkey: allocated.childPubkey,
		grantId: allocated.grantId,
		grantedAt: allocated.grantedAt,
		status: 'issued',
	}
	const updatedRegistry = buildAuctionPathRegistry({
		auctionEventId: params.auctionEventId,
		auctionCoordinates: params.auctionCoordinates,
		xpub,
		entries: upsertAuctionPathEntry(registry.entries, newEntry),
	})
	await publishAuctionPathRegistry(updatedRegistry)

	const issuedAt = allocated.grantedAt
	const expiresAt = issuedAt + AUCTION_PATH_GRANT_DEFAULT_TTL_SECONDS
	return {
		grantId: allocated.grantId,
		requestId: params.requestId,
		auctionEventId: params.auctionEventId,
		auctionCoordinates: params.auctionCoordinates,
		bidderPubkey: params.bidderPubkey,
		pathIssuerPubkey: issuerPubkey,
		xpub,
		derivationPath: allocated.derivationPath,
		childPubkey: allocated.childPubkey,
		issuedAt,
		expiresAt,
	}
}
