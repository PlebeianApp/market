import {
	AUCTION_BID_KIND,
	AUCTION_SETTLEMENT_KIND,
	BID_FLOOR_TIME_GRACE_SECONDS,
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
	computeAuctionBidFloor,
	getAuctionBidAmount,
	getAuctionEffectiveEndAt,
	getAuctionEndAt,
	getAuctionMaxEndAt,
	getAuctionReserveAmount,
	getAuctionSettlementGrace,
	getAuctionTagValue,
	getAuctionWindowValidBids,
	type AuctionSettlementPlanResponse,
	type AuctionSettlementPublishStatus,
} from '../../lib/auctionSettlement'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { auctionP2pkPubkeysMatch, deriveAuctionChildP2pkPubkeyFromXpub, normalizeAuctionP2pkPubkey } from '../../lib/auctionP2pk'
import { buildAuctionPathRegistry, findAuctionPathEntryByChildPubkey, type AuctionPathRegistryEntry } from '../../lib/auctionPathOracle'
import type { AuctionContext } from './context'
import { fetchAuctionPathRegistry, publishAuctionPathRegistry } from './registry'
import { getAuctionPathIssuerFromEvent, loadAuctionEvent } from './loadAuction'

export async function buildAuctionSettlementPlan(
	ctx: AuctionContext,
	params: {
		auctionEventId: string
		auctionCoordinates?: string
		/**
		 * Seller's best guess at the outcome. Optional — when omitted the backend
		 * computes the status itself. When provided, backend will still reject a
		 * mismatch so the seller never publishes the wrong outcome.
		 */
		status?: AuctionSettlementPublishStatus
	},
): Promise<AuctionSettlementPlanResponse> {
	const closeAt = Math.floor(Date.now() / 1000)

	const auctionEvent = await loadAuctionEvent(ctx, params.auctionEventId)
	const issuerPubkey = getAuctionPathIssuerFromEvent(auctionEvent)
	if (issuerPubkey !== ctx.issuerPubkey) {
		throw new Error('Auction is not configured for this path issuer')
	}

	const xpub = getAuctionTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!xpub) {
		throw new Error('Auction is missing p2pk_xpub')
	}

	const existingSettlements = await ctx.ndk.fetchEvents({
		kinds: [AUCTION_SETTLEMENT_KIND],
		'#e': [params.auctionEventId],
		limit: 20,
	})
	if (existingSettlements.size > 0) {
		throw new Error('Settlement already published for this auction')
	}

	const auctionCoordinates =
		params.auctionCoordinates ||
		(() => {
			const dTag = getAuctionTagValue(auctionEvent, 'd')
			return dTag ? `30408:${auctionEvent.pubkey}:${dTag}` : undefined
		})()

	const bidFilters = [
		{
			kinds: [AUCTION_BID_KIND],
			'#e': [params.auctionEventId],
			limit: 500,
		},
		...(auctionCoordinates
			? [
					{
						kinds: [AUCTION_BID_KIND],
						'#a': [auctionCoordinates],
						limit: 500,
					},
				]
			: []),
	]
	const bidEvents = Array.from(await ctx.ndk.fetchEvents(bidFilters.length === 1 ? bidFilters[0] : bidFilters))
	const effectiveEndAt = getAuctionEffectiveEndAt(auctionEvent, bidEvents)
	const nominalEndAt = getAuctionEndAt(auctionEvent)
	if (!nominalEndAt || closeAt < effectiveEndAt) {
		throw new Error('Auction has not ended yet')
	}

	// Settlement-time policy checks. AUCTIONS.md §7 MUST list:
	//   - mint in seller trusted list
	//   - locktime exactly `max_end_at + settlement_grace` (§4.1, §6.0 invariant)
	//   - `derivation_path` tag MUST NOT appear (§4.2 forbidden tag, §13)
	// We compute these once per auction outside the chain loop.
	const trustedMints = new Set(auctionEvent.tags.filter((tag) => tag[0] === 'mint' && !!tag[1]).map((tag) => tag[1]))
	const auctionMaxEndAt = getAuctionMaxEndAt(auctionEvent)
	const auctionSettlementGrace = getAuctionSettlementGrace(auctionEvent)
	const expectedLocktime = auctionMaxEndAt && auctionSettlementGrace ? auctionMaxEndAt + auctionSettlementGrace : 0

	// AUCTIONS.md §7.5.2: the locked Cashu token now lives on the registry
	// entry's `lockPayload`, populated by `submit_bid_token`. The legacy
	// kind-14 DM envelope path was removed when we pivoted to ContextVM
	// — fetching kind 14s here would always return zero, which is what
	// caused every settlement to resolve to `reserve_not_met` no matter
	// what the bid amount was.
	const registry = await fetchAuctionPathRegistry(ctx, params.auctionEventId)

	// AUCTIONS.md §6.1 — pre-compute the "top bid AT THE MOMENT just before
	// this bid landed", per-bid. The floor for a bid B depends on the
	// auction-wide top bid that B was trying to outbid, not the chain-
	// internal predecessor. We walk bids in time order, keeping a running
	// max and stamping each bid with the max-before-it.
	const allWindowBids = getAuctionWindowValidBids(auctionEvent, bidEvents)
	const bidsByTime = [...allWindowBids].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
	const topBidBeforeByBidId = new Map<string, number>()
	{
		let runningMax = 0
		for (const bid of bidsByTime) {
			topBidBeforeByBidId.set(bid.id, runningMax)
			const amount = getAuctionBidAmount(bid)
			if (amount > runningMax) runningMax = amount
		}
	}
	const computeBidFloorAtCreated = (bid: NDKEvent): number => {
		const topBefore = topBidBeforeByBidId.get(bid.id) ?? 0
		const effectiveT = (bid.created_at || 0) - BID_FLOOR_TIME_GRACE_SECONDS
		return computeAuctionBidFloor(auctionEvent, topBefore, effectiveT)
	}

	const eligibleChains = buildActiveAuctionBidChains(allWindowBids)
		.filter((group) =>
			group.chain.every((bid) => {
				const bidChildPubkey = getAuctionTagValue(bid, 'child_pubkey')
				if (!bidChildPubkey) return false
				const entry = findAuctionPathEntryByChildPubkey(registry, bidChildPubkey)
				if (!entry) return false
				// Bid must have been locked via `submit_bid_token` — the
				// lockPayload is the issuer's record of the actual Cashu
				// token. Without it there's nothing to release, so the
				// chain is ineligible regardless of how the kind 1023 looks.
				//
				// `'released'` is accepted alongside `'locked'` so that
				// `request_settlement` is idempotent: if the seller's
				// previous attempt marked the registry released but then
				// failed to redeem (cashu decode error, mint outage,
				// network drop, etc.), re-calling settlement returns the
				// same plan with the same tokens. Otherwise the registry
				// gets stuck in 'released' and every subsequent attempt
				// reports `reserve_not_met` — which is what produced the
				// "settlement event already exists for this auction" dead
				// end on staging (see `auctionsdev` repro at
				// 1618640c35ce…0881).
				const lockPayload = entry.lockPayload
				if (!lockPayload || (entry.status !== 'locked' && entry.status !== 'released')) return false
				if (entry.bidEventId !== bid.id) return false
				if (getAuctionTagValue(bid, 'commitment') !== lockPayload.commitment) return false
				// §4.2 forbidden tag: a path-oracle bid MUST NOT carry a
				// `derivation_path` tag. Bidders that self-generate paths
				// would be allowed to redeem early — see §9.1.
				if (getAuctionTagValue(bid, 'derivation_path')) return false
				// §7 MUST: mint in seller's trusted list. Check both the bid
				// tag and the lockPayload's mintUrl so a bidder can't lie via
				// either side.
				const bidMint = getAuctionTagValue(bid, 'mint')
				if (!bidMint || !trustedMints.has(bidMint)) return false
				if (!trustedMints.has(lockPayload.mintUrl)) return false
				// §4.1 / §6.0 invariant: locktime must equal
				// `max_end_at + settlement_grace`. Drift here would let a
				// bidder either reclaim early or block the chain past spec.
				if (expectedLocktime > 0) {
					const bidLocktime = parseInt(getAuctionTagValue(bid, 'locktime') || '0', 10)
					if (!Number.isFinite(bidLocktime) || bidLocktime !== expectedLocktime) return false
					if (lockPayload.locktime !== expectedLocktime) return false
				}
				// §6.1 — bid amount must clear the curve-aware floor at its
				// own `created_at` (minus GRACE). A bidder who got a grant
				// early then delayed publishing into the curve window can't
				// cheat: the floor at publish time is what counts.
				const bidAmount = getAuctionBidAmount(bid)
				const floorAtBid = computeBidFloorAtCreated(bid)
				if (bidAmount < floorAtBid) return false
				return true
			}),
		)
		.sort(compareAuctionBidChainPriority)

	const reserve = getAuctionReserveAmount(auctionEvent)
	const winnerChain = eligibleChains[0]
	const winnerAmount = winnerChain ? getAuctionBidAmount(winnerChain.latestBid) : 0
	const resolvedStatus: AuctionSettlementPublishStatus = winnerChain && winnerAmount >= reserve ? 'settled' : 'reserve_not_met'

	if (params.status && resolvedStatus !== params.status) {
		if (params.status === 'settled') {
			throw new Error('No valid reserve-meeting winner is available for settlement')
		}
		throw new Error('A valid reserve-meeting winner exists; reserve_not_met is not allowed')
	}

	if (!winnerChain || resolvedStatus !== 'settled') {
		return {
			auctionEventId: params.auctionEventId,
			auctionCoordinates,
			status: 'reserve_not_met',
			closeAt,
			reserve,
			finalAmount: 0,
			winnerTokens: [],
		}
	}

	const releaseId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	const winnerTokens: AuctionSettlementPlanResponse['winnerTokens'] = []
	const releasedEntries: AuctionPathRegistryEntry[] = registry?.entries ? [...registry.entries] : []
	for (const bid of winnerChain.chain) {
		const bidChildPubkey = getAuctionTagValue(bid, 'child_pubkey')
		if (!bidChildPubkey) {
			throw new Error(`Winning bid ${bid.id} is missing child_pubkey`)
		}
		const registryEntry = findAuctionPathEntryByChildPubkey(registry, bidChildPubkey)
		if (!registryEntry) {
			throw new Error(`Winning bid ${bid.id} was not granted by the path oracle`)
		}
		const lockPayload = registryEntry.lockPayload
		if (!lockPayload) {
			// The chain filter above already rejects any chain whose bids
			// aren't fully locked, so reaching here means the registry was
			// mutated between filter and release — bail rather than emit a
			// half-built settlement.
			throw new Error(`Winning bid ${bid.id} has no locked Cashu payload on the registry entry`)
		}
		// Defence-in-depth: re-derive the pubkey from xpub + stored path. If
		// the registry entry was tampered with, this throws before releasing.
		const redeployedChildPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, registryEntry.derivationPath)
		if (!auctionP2pkPubkeysMatch(redeployedChildPubkey, registryEntry.childPubkey)) {
			throw new Error('Registry path does not re-derive to the recorded child pubkey')
		}
		winnerTokens.push({
			bidEventId: bid.id,
			bidderPubkey: registryEntry.bidderPubkey,
			derivationPath: registryEntry.derivationPath,
			childPubkey: normalizeAuctionP2pkPubkey(registryEntry.childPubkey),
			mintUrl: lockPayload.mintUrl,
			amount: lockPayload.amount,
			totalBidAmount: lockPayload.totalBidAmount,
			commitment: lockPayload.commitment,
			locktime: lockPayload.locktime,
			refundPubkey: lockPayload.refundPubkey,
			token: lockPayload.token,
		})
		const updated: AuctionPathRegistryEntry = {
			...registryEntry,
			status: 'released',
			releasedAt: Math.floor(Date.now() / 1000),
			releaseTargetPubkey: auctionEvent.pubkey,
			bidEventId: bid.id,
		}
		const index = releasedEntries.findIndex((entry) => entry.grantId === registryEntry.grantId)
		if (index >= 0) releasedEntries[index] = updated
	}

	if (registry && releasedEntries.length) {
		await publishAuctionPathRegistry(
			ctx,
			buildAuctionPathRegistry({
				auctionEventId: params.auctionEventId,
				auctionCoordinates: auctionCoordinates || registry.auctionCoordinates,
				xpub,
				entries: releasedEntries,
			}),
		)
	}

	return {
		auctionEventId: params.auctionEventId,
		auctionCoordinates,
		status: 'settled',
		closeAt,
		reserve,
		winningBidEventId: winnerChain.latestBid.id,
		winnerPubkey: winnerChain.bidderPubkey,
		finalAmount: winnerAmount,
		winnerTokens,
		releaseId,
	}
}
