import { getAuctionTagValue } from '../../lib/auctionSettlement'
import {
	AUCTION_PATH_GRANT_DEFAULT_TTL_SECONDS,
	AUCTION_PATH_REGISTRY_SCHEMA,
	allocateAuctionPath,
	buildAuctionPathRegistry,
	upsertAuctionPathEntry,
	type AuctionPathRegistryEntry,
} from '../../lib/auctionPathOracle'
import type { AuctionContext } from './context'
import { fetchAuctionPathRegistry, publishAuctionPathRegistry } from './registry'
import { getAuctionPathIssuerFromEvent, loadAuctionEvent } from './loadAuction'

/**
 * AUCTIONS.md §7.5.1 — the issuer rate-limits per bidder per auction
 * and deduplicates by `(auctionEventId, bidderPubkey, requestId)`. The
 * counters live in the `AuctionContext.stateStore` (SQLite) so they
 * survive process restarts; a misbehaving bidder can't reset their
 * window by triggering a reload.
 */

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

export async function buildAuctionPathGrant(
	ctx: AuctionContext,
	params: {
		requestId: string
		auctionEventId: string
		auctionCoordinates: string
		bidderPubkey: string
		bidderRefundPubkey: string
	},
): Promise<AuctionPathGrant> {
	// AUCTIONS.md §7.5.1 input validation. The transport (HTTP NIP-98 or
	// ContextVM kind-25910) authenticates the caller; we still validate
	// raw fields so downstream code (path-derivation, registry persistence)
	// gets clean inputs only.
	if (!NOSTR_PUBKEY_HEX_RE.test(params.bidderPubkey)) {
		throw new Error('bidderPubkey must be a 32-byte hex Nostr pubkey')
	}
	if (!COMPRESSED_SECP256K1_PUBKEY_HEX_RE.test(params.bidderRefundPubkey)) {
		throw new Error('bidderRefundPubkey must be a compressed secp256k1 pubkey (33 bytes hex, 02/03 prefix)')
	}

	ctx.stateStore.enforcePathRequestRateLimit({
		issuerPubkey: ctx.issuerPubkey,
		auctionEventId: params.auctionEventId,
		bidderPubkey: params.bidderPubkey,
		requestId: params.requestId,
	})

	const auctionEvent = await loadAuctionEvent(ctx, params.auctionEventId)
	const issuerPubkey = getAuctionPathIssuerFromEvent(auctionEvent)
	if (issuerPubkey !== ctx.issuerPubkey) {
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

	const registry = (await fetchAuctionPathRegistry(ctx, params.auctionEventId)) ?? {
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
	await publishAuctionPathRegistry(ctx, updatedRegistry)

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
