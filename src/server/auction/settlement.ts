import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import {
	AUCTION_BID_KIND,
	AUCTION_SETTLEMENT_KIND,
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
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
import { auctionP2pkPubkeysMatch, deriveAuctionChildP2pkPubkeyFromXpub, normalizeAuctionP2pkPubkey } from '../../lib/auctionP2pk'
import { AUCTION_BID_TOKEN_TOPIC, parseAuctionBidTokenEnvelope } from '../../lib/auctionTransfers'
import {
	buildAuctionPathRegistry,
	findAuctionPathEntryByChildPubkey,
	type AuctionPathRegistryEntry,
} from '../../lib/auctionPathOracle'
import { ensureInvoiceNdkConnected, getAppAuctionSigner } from '../ndk'
import { getAppPublicKeyOrThrow } from '../runtime'
import { sha256Hex } from '../util/sha256'
import { fetchAuctionPathRegistry, publishAuctionPathRegistry } from './registry'
import { getAuctionPathIssuerFromEvent, loadAuctionEvent } from './loadAuction'

export async function buildAuctionSettlementPlan(params: {
	auctionEventId: string
	auctionCoordinates?: string
	/**
	 * Seller's best guess at the outcome. Optional — when omitted the backend
	 * computes the status itself. When provided, backend will still reject a
	 * mismatch so the seller never publishes the wrong outcome.
	 */
	status?: AuctionSettlementPublishStatus
}): Promise<AuctionSettlementPlanResponse> {
	const ndk = await ensureInvoiceNdkConnected()
	const appPubkey = getAppPublicKeyOrThrow()
	const appSigner = await getAppAuctionSigner()
	const closeAt = Math.floor(Date.now() / 1000)

	const auctionEvent = await loadAuctionEvent(params.auctionEventId)
	const issuerPubkey = getAuctionPathIssuerFromEvent(auctionEvent)
	if (issuerPubkey !== appPubkey) {
		throw new Error('Auction is not configured for this path issuer')
	}

	const xpub = getAuctionTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!xpub) {
		throw new Error('Auction is missing p2pk_xpub')
	}

	const existingSettlements = await ndk.fetchEvents({
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
	const bidEvents = Array.from(await ndk.fetchEvents(bidFilters.length === 1 ? bidFilters[0] : bidFilters))
	const effectiveEndAt = getAuctionEffectiveEndAt(auctionEvent, bidEvents)
	const nominalEndAt = getAuctionEndAt(auctionEvent)
	if (!nominalEndAt || closeAt < effectiveEndAt) {
		throw new Error('Auction has not ended yet')
	}

	const envelopeFilters = [
		{
			kinds: [14],
			'#p': [appPubkey],
			'#t': [AUCTION_BID_TOKEN_TOPIC],
			'#e': [params.auctionEventId],
			limit: 500,
		},
		...(auctionCoordinates
			? [
					{
						kinds: [14],
						'#p': [appPubkey],
						'#t': [AUCTION_BID_TOKEN_TOPIC],
						'#a': [auctionCoordinates],
						limit: 500,
					},
				]
			: []),
	]
	const envelopeEvents = Array.from(await ndk.fetchEvents(envelopeFilters.length === 1 ? envelopeFilters[0] : envelopeFilters))
	const envelopeByBidId = new Map<string, ReturnType<typeof parseAuctionBidTokenEnvelope>>()

	for (const event of envelopeEvents) {
		try {
			const decryptable = new NDKEvent(ndk, event.rawEvent())
			await decryptable.decrypt(new NDKUser({ pubkey: event.pubkey }), appSigner, 'nip44')
			const envelope = parseAuctionBidTokenEnvelope(decryptable.content)
			if (!envelope || envelope.auctionEventId !== params.auctionEventId) continue
			if (envelope.pathIssuerPubkey !== appPubkey) continue
			const tokenCommitment = await sha256Hex(envelope.token)
			if (tokenCommitment !== envelope.commitment) continue
			envelopeByBidId.set(envelope.bidEventId, envelope)
		} catch (error) {
			console.error('[auction] Failed to decrypt app bid envelope:', error)
		}
	}

	// Settlement-time policy checks. AUCTIONS.md §7 MUST list:
	//   - mint in seller trusted list
	//   - locktime exactly `max_end_at + settlement_grace` (§4.1, §6.0 invariant)
	//   - `derivation_path` tag MUST NOT appear (§4.2 forbidden tag, §13)
	// We compute these once per auction outside the chain loop.
	const trustedMints = new Set(
		auctionEvent.tags
			.filter((tag) => tag[0] === 'mint' && !!tag[1])
			.map((tag) => tag[1]),
	)
	const auctionMaxEndAt = getAuctionMaxEndAt(auctionEvent)
	const auctionSettlementGrace = getAuctionSettlementGrace(auctionEvent)
	const expectedLocktime = auctionMaxEndAt && auctionSettlementGrace ? auctionMaxEndAt + auctionSettlementGrace : 0

	const registry = await fetchAuctionPathRegistry(params.auctionEventId)
	const eligibleChains = buildActiveAuctionBidChains(getAuctionWindowValidBids(auctionEvent, bidEvents))
		.filter((group) =>
			group.chain.every((bid) => {
				const envelope = envelopeByBidId.get(bid.id)
				if (!envelope) return false
				if (getAuctionTagValue(bid, 'commitment') !== envelope.commitment) return false
				// §4.2 forbidden tag: a path-oracle bid MUST NOT carry a
				// `derivation_path` tag. Bidders that self-generate paths
				// would be allowed to redeem early — see §9.1.
				if (getAuctionTagValue(bid, 'derivation_path')) return false
				// §7 MUST: mint in seller's trusted list. Check both the bid
				// tag and the envelope's mintUrl so a bidder can't lie via
				// either side.
				const bidMint = getAuctionTagValue(bid, 'mint')
				if (!bidMint || !trustedMints.has(bidMint)) return false
				if (!trustedMints.has(envelope.mintUrl)) return false
				// §4.1 / §6.0 invariant: locktime must equal
				// `max_end_at + settlement_grace`. Drift here would let a
				// bidder either reclaim early or block the chain past spec.
				if (expectedLocktime > 0) {
					const bidLocktime = parseInt(getAuctionTagValue(bid, 'locktime') || '0', 10)
					if (!Number.isFinite(bidLocktime) || bidLocktime !== expectedLocktime) return false
					if (envelope.locktime !== expectedLocktime) return false
				}
				// Every bid in a valid chain must come from a path that the
				// issuer actually granted (otherwise the bidder self-generated
				// a path and the seller could redeem prematurely — see §9.1).
				const bidChildPubkey = getAuctionTagValue(bid, 'child_pubkey')
				if (!bidChildPubkey) return false
				const entry = findAuctionPathEntryByChildPubkey(registry, bidChildPubkey)
				return !!entry
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
		const envelope = envelopeByBidId.get(bid.id)
		if (!envelope) {
			throw new Error(`Missing private token envelope for winning bid ${bid.id}`)
		}
		const bidChildPubkey = getAuctionTagValue(bid, 'child_pubkey')
		if (!bidChildPubkey) {
			throw new Error(`Winning bid ${bid.id} is missing child_pubkey`)
		}
		const registryEntry = findAuctionPathEntryByChildPubkey(registry, bidChildPubkey)
		if (!registryEntry) {
			throw new Error(`Winning bid ${bid.id} was not granted by the path oracle`)
		}
		// Defence-in-depth: re-derive the pubkey from xpub + stored path. If
		// the registry entry was tampered with, this throws before releasing.
		const redeployedChildPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, registryEntry.derivationPath)
		if (!auctionP2pkPubkeysMatch(redeployedChildPubkey, registryEntry.childPubkey)) {
			throw new Error('Registry path does not re-derive to the recorded child pubkey')
		}
		winnerTokens.push({
			bidEventId: bid.id,
			bidderPubkey: envelope.bidderPubkey,
			derivationPath: registryEntry.derivationPath,
			childPubkey: normalizeAuctionP2pkPubkey(registryEntry.childPubkey),
			mintUrl: envelope.mintUrl,
			amount: envelope.amount,
			totalBidAmount: envelope.totalBidAmount,
			commitment: envelope.commitment,
			locktime: envelope.locktime,
			refundPubkey: envelope.refundPubkey,
			token: envelope.token,
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
