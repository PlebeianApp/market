import {
	AUCTION_BID_KIND,
	BID_FLOOR_TIME_GRACE_SECONDS,
	computeAuctionBidFloor,
	getAuctionBidAmount,
	getAuctionTagValue,
} from '../../lib/auctionSettlement'
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
	/**
	 * Bid floor enforced for this grant at request time (AUCTIONS.md §6.1).
	 * Lower bound on `intendedAmount`; the bidder's kind-1023 amount MUST
	 * be ≥ this value, and settlement re-checks against the floor at the
	 * bid's own `created_at`.
	 */
	acceptedFloor: number
}

export async function buildAuctionPathGrant(
	ctx: AuctionContext,
	params: {
		requestId: string
		auctionEventId: string
		auctionCoordinates: string
		bidderPubkey: string
		bidderRefundPubkey: string
		intendedAmount: number
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
	if (!Number.isFinite(params.intendedAmount) || params.intendedAmount <= 0) {
		throw new Error('intendedAmount must be a positive integer (sats)')
	}

	ctx.stateStore.enforcePathRequestRateLimit({
		issuerPubkey: ctx.issuerPubkey,
		auctionEventId: params.auctionEventId,
		bidderPubkey: params.bidderPubkey,
		requestId: params.requestId,
	})

	const auctionEvent = await loadAuctionEvent(ctx, params.auctionEventId)

	// AUCTIONS.md §7.5.1 — seller self-bid block. A seller bidding on
	// their own auction could pump the floor against honest bidders
	// without ever paying out (the kind-1023 → submit_bid_token loop
	// would still settle to themselves, but the curve would have
	// inflated the cost for legitimate participants in the meantime).
	if (params.bidderPubkey.toLowerCase() === auctionEvent.pubkey.toLowerCase()) {
		throw new Error('Sellers MUST NOT bid on their own auction')
	}

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

	// AUCTIONS.md §6.1 — anti-snipe curve enforcement. Compute the floor
	// at `now - GRACE` (server is lenient by 5 s to absorb relay/network
	// latency between the bidder clicking "Bid" and us receiving the
	// kind-25910). The floor uses the relay-current top bid; we fetch a
	// fresh slice rather than trusting any client-supplied state.
	const topBidAmount = await fetchCurrentTopBidAmount(ctx, params.auctionEventId, params.auctionCoordinates)
	const effectiveT = Math.max(now - BID_FLOOR_TIME_GRACE_SECONDS, endAt)
	const acceptedFloor = computeAuctionBidFloor(auctionEvent, topBidAmount, effectiveT)
	if (params.intendedAmount < acceptedFloor) {
		throw new Error(
			`intendedAmount ${params.intendedAmount} is below the current bid floor ${acceptedFloor} sats — wait for the next floor update or bid higher`,
		)
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
		acceptedFloor,
	}
}

/**
 * Fetch every kind-1023 bid event for the auction and return the highest
 * `amount` we see. Used by `buildAuctionPathGrant` to compute the
 * curve-aware floor.
 *
 * Returns `0` when no bids exist yet, which makes
 * `computeAuctionBidFloor` fall back to `starting_bid` for the baseline
 * (the "first bid" case in AUCTIONS.md §6.1).
 *
 * We deliberately don't enforce chain priority or any of settlement's
 * stricter checks here — those guard the actual release. For floor
 * enforcement we want the loosest possible interpretation of "what's
 * the current top": a bid that's structurally invalid is still
 * something a bidder might have committed to outbid.
 */
async function fetchCurrentTopBidAmount(
	ctx: AuctionContext,
	auctionEventId: string,
	auctionCoordinates: string,
): Promise<number> {
	const filters = [
		{
			kinds: [AUCTION_BID_KIND],
			'#e': [auctionEventId],
			limit: 200,
		},
		...(auctionCoordinates
			? [
					{
						kinds: [AUCTION_BID_KIND],
						'#a': [auctionCoordinates],
						limit: 200,
					},
				]
			: []),
	]
	try {
		const bidEvents = Array.from(await ctx.ndk.fetchEvents(filters.length === 1 ? filters[0] : filters))
		let top = 0
		for (const bid of bidEvents) {
			const amount = getAuctionBidAmount(bid)
			if (amount > top) top = amount
		}
		return top
	} catch (error) {
		// On relay error, fall back to "no top bid" — the floor degrades
		// to `starting_bid × multiplier`. The bidder's UI shows the same
		// number (it doesn't know about the failure), so behaviour stays
		// consistent. Log so operators see persistent issues.
		console.warn('[auction] fetchCurrentTopBidAmount failed; falling back to top=0', error)
		return 0
	}
}
