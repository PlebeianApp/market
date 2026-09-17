import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { auctionWonActions } from '@/lib/stores/auctionWon'
import {
	getValidatedAuctionBids,
	hasFinalSettlementForAuctionWin,
	hasValidatedPathReleaseForAuctionWin,
} from '@/lib/auction/winNotification'
import { fetchBidNut7States } from '@/lib/auction/useNut7Polling'
import { fetchDleqKeysetsForBids } from '@/lib/cashu/dleq'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { toRawEvent } from '@/lib/nostr/eventLike'
import {
	fetchAuction,
	fetchAuctionWithRetry,
	fetchAuctionBids,
	fetchAuctionBidsByBidder,
	fetchAuctionPathReleases,
	fetchAuctionSettlements,
	fetchAuctionVerdicts,
	getAuctionBiddingCutoffAt,
	getAuctionSettlementGrace,
	getBidAuctionEventId,
} from '@/queries/auctions'

const POLL_INTERVAL_MS = 20000
const BID_DISCOVERY_LIMIT = 500
const AUCTION_EVENT_LIMIT = 500
const PATH_RELEASE_LIMIT = 200
const SETTLEMENT_LOOKBACK_SECONDS = 60 * 60 * 24 * 30

/**
 * Globally watches auctions the current user has bid on and, once bidding closes with them
 * as the top (reserve-meeting) bidder, enqueues a "you won" modal (see AuctionWonModal) - so
 * the win is surfaced no matter where in the app they are, not only on the auction's own page.
 */
export function useAuctionWinMonitor() {
	const { isAuthenticated, user } = useStore(authStore)
	const pubkey = user?.pubkey
	const terminalRootEventIds = useRef<Set<string>>(new Set())
	const announcedBidIdsByRoot = useRef<Map<string, string>>(new Map())
	const isChecking = useRef(false)

	useEffect(() => {
		terminalRootEventIds.current = new Set()
		announcedBidIdsByRoot.current = new Map()
		if (isAuthenticated && pubkey) auctionWonActions.retainForBidder(pubkey)
		else auctionWonActions.clear()
	}, [isAuthenticated, pubkey])

	useEffect(() => {
		if (!isAuthenticated || !pubkey) return

		let cancelled = false

		const checkForWins = async () => {
			if (isChecking.current) return
			isChecking.current = true
			try {
				const discoverySince = Math.floor(Date.now() / 1000) - SETTLEMENT_LOOKBACK_SECONDS
				const ownBids = await fetchAuctionBidsByBidder(pubkey, BID_DISCOVERY_LIMIT, true, discoverySince)
				const candidateRootEventIds = new Set<string>()
				for (const bid of ownBids) {
					const rootEventId = getBidAuctionEventId(bid)
					if (rootEventId && !terminalRootEventIds.current.has(rootEventId)) {
						candidateRootEventIds.add(rootEventId)
					}
				}

				for (const rootEventId of candidateRootEventIds) {
					if (cancelled) return

					const auction = await fetchAuctionWithRetry(rootEventId, true)
					if (!auction) {
						terminalRootEventIds.current.add(rootEventId)
						announcedBidIdsByRoot.current.delete(rootEventId)
						auctionWonActions.removeForAuction(rootEventId)
						continue
					}

					const biddingCutoffAt: number = getAuctionBiddingCutoffAt(auction)
					const now = Math.floor(Date.now() / 1000)
					if (biddingCutoffAt <= 0 || biddingCutoffAt > now) continue // Auction hasn't ended yet.

					const settlementDeadlineAt = biddingCutoffAt + getAuctionSettlementGrace(auction)
					if (settlementDeadlineAt <= now) {
						terminalRootEventIds.current.add(rootEventId)
						announcedBidIdsByRoot.current.delete(rootEventId)
						auctionWonActions.removeForAuction(rootEventId)
						continue
					}

					const parsedAuctionResult = parseAuctionEvent(toRawEvent(auction))
					if (!parsedAuctionResult.ok) continue
					const parsedAuction = parsedAuctionResult.value

					const [bidEvents, verdictEvents, pathReleaseEvents, settlementEvents] = await Promise.all([
						fetchAuctionBids(rootEventId, AUCTION_EVENT_LIMIT, parsedAuction.coordinate, true),
						fetchAuctionVerdicts(rootEventId, AUCTION_EVENT_LIMIT, parsedAuction.coordinate, parsedAuction.auditors),
						fetchAuctionPathReleases(rootEventId, PATH_RELEASE_LIMIT, parsedAuction.coordinate, undefined, true),
						fetchAuctionSettlements(rootEventId, AUCTION_EVENT_LIMIT, parsedAuction.coordinate, undefined, true),
					])
					if (hasFinalSettlementForAuctionWin({ auctionRootEventId: rootEventId }, auction, parsedAuction.coordinate, settlementEvents)) {
						terminalRootEventIds.current.add(rootEventId)
						announcedBidIdsByRoot.current.delete(rootEventId)
						auctionWonActions.removeForAuction(rootEventId)
						continue
					}
					const parsedBids = bidEvents
						.map((bid) => parseBidEvent(toRawEvent(bid)))
						.filter((result): result is { ok: true; value: import('@/lib/auction/events').ParsedBidEvent } => result.ok)
						.map((result) => result.value)
					const parsedVerdicts = verdictEvents
						.map((verdict) => parseValidatorVerdictEvent(toRawEvent(verdict)))
						.filter((result): result is { ok: true; value: import('@/lib/auction/events').ParsedValidatorVerdictEvent } => result.ok)
						.map((result) => result.value)
					const parsedPathReleases = pathReleaseEvents
						.map((release) => parsePathReleaseEvent(toRawEvent(release)))
						.filter((result): result is { ok: true; value: import('@/lib/auction/events').ParsedPathReleaseEvent } => result.ok)
						.map((result) => result.value)
					const [nut7States, dleqKeysets] = await Promise.all([
						fetchBidNut7States(parsedBids, parsedAuction.mints),
						// DLEQ is unconditional: without the keysets every
						// DLEQ-bearing bid is pending and no winner surfaces.
						fetchDleqKeysetsForBids(parsedBids, parsedAuction.mints),
					])
					const validatedBids = getValidatedAuctionBids(parsedAuction, parsedBids, parsedVerdicts, nut7States, dleqKeysets)
					const canonicalWinner = validatedBids.canonicalWinner

					const previouslyAnnouncedBidId = announcedBidIdsByRoot.current.get(rootEventId)
					if (!canonicalWinner) {
						if (previouslyAnnouncedBidId) {
							announcedBidIdsByRoot.current.delete(rootEventId)
							auctionWonActions.removeForAuction(rootEventId)
						}
						continue
					}
					if (canonicalWinner.bidderPubkey !== pubkey) {
						if (previouslyAnnouncedBidId) {
							announcedBidIdsByRoot.current.delete(rootEventId)
							auctionWonActions.removeForAuction(rootEventId)
						}
						continue
					}

					const reserveMet = canonicalWinner.amount >= parsedAuction.reserve
					if (!reserveMet) {
						announcedBidIdsByRoot.current.delete(rootEventId)
						auctionWonActions.removeForAuction(rootEventId)
						continue
					}
					const win = {
						bidderPubkey: pubkey,
						auctionRootEventId: rootEventId,
						bidEventId: canonicalWinner.id,
						bidAmount: canonicalWinner.amount,
					}
					if (await hasValidatedPathReleaseForAuctionWin(win, parsedAuction, validatedBids, parsedPathReleases, now)) {
						announcedBidIdsByRoot.current.set(rootEventId, canonicalWinner.id)
						auctionWonActions.removeForAuction(rootEventId)
						continue
					}
					if (previouslyAnnouncedBidId === canonicalWinner.id) continue
					if (previouslyAnnouncedBidId && previouslyAnnouncedBidId !== canonicalWinner.id) {
						auctionWonActions.removeForAuction(rootEventId)
					}
					if (cancelled || !authStore.state.isAuthenticated || authStore.state.user?.pubkey !== pubkey) return
					auctionWonActions.enqueue(win)
					announcedBidIdsByRoot.current.set(rootEventId, canonicalWinner.id)
				}
			} catch (error) {
				console.error('[AuctionWinMonitor] Failed to check for auction wins:', error)
			} finally {
				isChecking.current = false
			}
		}

		void checkForWins()
		const interval = setInterval(() => void checkForWins(), POLL_INTERVAL_MS)

		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [isAuthenticated, pubkey])
}
