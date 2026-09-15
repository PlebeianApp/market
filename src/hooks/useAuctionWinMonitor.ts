import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { auctionWonActions } from '@/lib/stores/auctionWon'
import { selectValidatedAuctionWinner } from '@/lib/auction/winNotification'
import { fetchBidNut7States } from '@/lib/auction/useNut7Polling'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { toRawEvent } from '@/lib/nostr/eventLike'
import {
	fetchAuction,
	fetchAuctionBids,
	fetchAuctionBidsByBidder,
	fetchAuctionVerdicts,
	getAuctionBiddingCutoffAt,
	getAuctionSettlementGrace,
	getBidAuctionEventId,
} from '@/queries/auctions'

const POLL_INTERVAL_MS = 20000

/**
 * Globally watches auctions the current user has bid on and, once bidding closes with them
 * as the top (reserve-meeting) bidder, enqueues a "you won" modal (see AuctionWonModal) - so
 * the win is surfaced no matter where in the app they are, not only on the auction's own page.
 */
export function useAuctionWinMonitor() {
	const { isAuthenticated, user } = useStore(authStore)
	const pubkey = user?.pubkey
	// Auctions already resolved (won or not) this session, so we don't keep re-fetching them.
	const resolvedRootEventIds = useRef<Set<string>>(new Set())
	const isChecking = useRef(false)

	useEffect(() => {
		resolvedRootEventIds.current = new Set()
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
				const ownBids = await fetchAuctionBidsByBidder(pubkey, 500)
				const candidateRootEventIds = new Set<string>()
				for (const bid of ownBids) {
					const rootEventId = getBidAuctionEventId(bid)
					if (rootEventId && !resolvedRootEventIds.current.has(rootEventId)) {
						candidateRootEventIds.add(rootEventId)
					}
				}

				for (const rootEventId of candidateRootEventIds) {
					if (cancelled) return

					const auction = await fetchAuction(rootEventId)
					if (!auction) continue

					const biddingCutoffAt: number = getAuctionBiddingCutoffAt(auction)
					const now = Math.floor(Date.now() / 1000)
					if (biddingCutoffAt <= 0 || biddingCutoffAt > now) continue // Auction hasn't ended yet.

					const settlementDeadlineAt = biddingCutoffAt + getAuctionSettlementGrace(auction)
					if (settlementDeadlineAt <= now) {
						resolvedRootEventIds.current.add(rootEventId)
						continue
					}

					const parsedAuctionResult = parseAuctionEvent(toRawEvent(auction))
					if (!parsedAuctionResult.ok) continue
					const parsedAuction = parsedAuctionResult.value

					const [bidEvents, verdictEvents] = await Promise.all([
						fetchAuctionBids(rootEventId, 500, parsedAuction.coordinate),
						fetchAuctionVerdicts(rootEventId, 500, parsedAuction.coordinate, parsedAuction.auditors),
					])
					const parsedBids = bidEvents
						.map((bid) => parseBidEvent(toRawEvent(bid)))
						.filter((result): result is { ok: true; value: import('@/lib/auction/events').ParsedBidEvent } => result.ok)
						.map((result) => result.value)
					const parsedVerdicts = verdictEvents
						.map((verdict) => parseValidatorVerdictEvent(toRawEvent(verdict)))
						.filter((result): result is { ok: true; value: import('@/lib/auction/events').ParsedValidatorVerdictEvent } => result.ok)
						.map((result) => result.value)
					const nut7States = await fetchBidNut7States(parsedBids, parsedAuction.mints)
					const canonicalWinner = selectValidatedAuctionWinner(parsedAuction, parsedBids, parsedVerdicts, nut7States)

					if (!canonicalWinner) continue
					resolvedRootEventIds.current.add(rootEventId)
					if (canonicalWinner.bidderPubkey !== pubkey) continue

					const reserveMet = canonicalWinner.amount >= parsedAuction.reserve
					if (!reserveMet) continue
					if (cancelled || !authStore.state.isAuthenticated || authStore.state.user?.pubkey !== pubkey) return
					auctionWonActions.enqueue({
						bidderPubkey: pubkey,
						auctionRootEventId: rootEventId,
						bidEventId: canonicalWinner.id,
						bidAmount: canonicalWinner.amount,
					})
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
