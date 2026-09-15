import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { buildActiveAuctionBidChains, compareAuctionBidChainPriority, getAuctionWindowValidBids } from '@/lib/auctionSettlement'
import { auctionWonActions } from '@/lib/stores/auctionWon'
import {
	fetchAuction,
	fetchAuctionBids,
	fetchAuctionBidsByBidder,
	getAuctionBiddingCutoffAt,
	getAuctionReserve,
	getAuctionSettlementGrace,
	getBidAmount,
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

					const bids = await fetchAuctionBids(rootEventId, 500)
					let chains
					try {
						chains = buildActiveAuctionBidChains(getAuctionWindowValidBids(auction, bids))
					} catch {
						continue
					}

					resolvedRootEventIds.current.add(rootEventId)

					const topChain = [...chains].sort(compareAuctionBidChainPriority)[0]
					if (!topChain || topChain.bidderPubkey !== pubkey) continue

					const bidAmount = getBidAmount(topChain.latestBid)
					const reserveMet = bidAmount >= getAuctionReserve(auction)
					if (!reserveMet) continue
					if (cancelled || !authStore.state.isAuthenticated || authStore.state.user?.pubkey !== pubkey) return
					auctionWonActions.enqueue({
						bidderPubkey: pubkey,
						auctionRootEventId: rootEventId,
						bidEventId: topChain.latestBid.id,
						bidAmount,
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
