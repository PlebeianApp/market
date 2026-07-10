import { useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { authStore } from '@/lib/stores/auth'
import { cn } from '@/lib/utils'
import { findBidderRecord } from '@/lib/auction/bidderRecords'
import { nip60Actions } from '@/lib/stores/nip60'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { auctionKeys } from '@/queries/queryKeyFactory'
import { usePublishAuctionSettlementMutation } from '@/publish/auctions'
import {
	useAuctionSettlements,
	useAuctionPathReleases,
	useAuctionClaimOrders,
	getAuctionSettlementStatus,
	getAuctionSettlementWinner,
	getAuctionSettlementFinalAmount,
	getAuctionSettlementGrace,
	getAuctionMaxEndAt,
	getBidAmount,
} from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getAuctionWindowValidBids } from '@/lib/auctionSettlement'

interface AuctionSettlementProps {
	auction: NDKEvent
	bids: NDKEvent[]
	className?: string
	onAction?: () => void
}

export function AuctionSettlement({ auction, bids, className, onAction }: AuctionSettlementProps) {
	const { user } = useStore(authStore)
	const currentUserPubkey = user?.pubkey

	// Get auction identifiers
	const auctionDTag = auction.tags.find((t) => t[0] === 'd')?.[1] || ''
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
	const auctionRootEventId = auction.tags.find((t) => t[0] === 'auction_root_event_id')?.[1] || auction.id

	// Fetch settlement-related data
	const settlementsQuery = useAuctionSettlements(auctionRootEventId, 10, auctionCoordinates)
	const pathReleasesQuery = useAuctionPathReleases(auctionRootEventId, 200, auctionCoordinates)
	const claimOrdersQuery = useAuctionClaimOrders(auctionCoordinates)

	const settlements = settlementsQuery.data ?? []
	const pathReleases = pathReleasesQuery.data ?? []
	const claimOrders = claimOrdersQuery.data ?? []

	const latestSettlement = settlements[0] || null
	const settlementStatus = latestSettlement ? getAuctionSettlementStatus(latestSettlement) : 'unknown'
	const settlementWinner = latestSettlement ? getAuctionSettlementWinner(latestSettlement) : ''
	const settlementFinalAmount = latestSettlement ? getAuctionSettlementFinalAmount(latestSettlement) : 0

	const isSeller = currentUserPubkey === auction.pubkey
	const isWinner = currentUserPubkey && settlementWinner === currentUserPubkey
	const hasClaimOrder = claimOrders.some((order) => order.pubkey === currentUserPubkey)

	// Get auction timing info
	const maxEndAt = getAuctionMaxEndAt(auction)
	const settlementGrace = getAuctionSettlementGrace(auction)
	const settlementLocktimeAt = maxEndAt > 0 && settlementGrace > 0 ? maxEndAt + settlementGrace : 0
	const now = Math.floor(Date.now() / 1000)
	const settlementWindowExpired = settlementLocktimeAt > 0 && now >= settlementLocktimeAt
	const ended = maxEndAt > 0 && now >= maxEndAt

	// Get top bid info
	const validBids = getAuctionWindowValidBids(auction, bids)
	const topBid = useMemo(() => {
		if (validBids.length === 0) return null
		return [...validBids]
			.sort((a, b) => {
				const amountDelta = getBidAmount(b) - getBidAmount(a)
				if (amountDelta !== 0) return amountDelta
				const timeDelta = (b.created_at || 0) - (a.created_at || 0)
				if (timeDelta !== 0) return timeDelta
				return b.id.localeCompare(a.id)
			})
			.at(0)
	}, [validBids])

	const reserve = auction.tags.find((t) => t[0] === 'reserve')?.[1]
		? parseInt(auction.tags.find((t) => t[0] === 'reserve')?.[1] || '0', 10)
		: 0
	const reserveMet = !!topBid && getBidAmount(topBid) >= reserve

	// Check if path release for top bid exists
	const hasPathReleaseForTopBid = useMemo(() => {
		if (!topBid) return false
		return pathReleases.some((pr) => pr.tags.find((t) => t[0] === 'e')?.[1] === topBid.id)
	}, [pathReleases, topBid])

	// Bidder-specific data
	const myTopBidEvent = useMemo(() => {
		if (!currentUserPubkey) return null
		const mine = bids.filter((b) => b.pubkey === currentUserPubkey)
		if (!mine.length) return null
		return mine.reduce<(typeof mine)[0] | null>((best, bid) => {
			if (!best) return bid
			const delta = getBidAmount(bid) - getBidAmount(best)
			if (delta > 0) return bid
			if (delta < 0) return best
			return (bid.created_at ?? 0) < (best.created_at ?? 0) ? bid : best
		}, mine[0])
	}, [bids, currentUserPubkey])

	const isMyBidTop = !!(myTopBidEvent && topBid && myTopBidEvent.id === topBid.id)
	const myAlreadyReleased = useMemo(() => {
		if (!myTopBidEvent) return false
		return pathReleases.some((pr) => pr.tags.find((t) => t[0] === 'e')?.[1] === myTopBidEvent.id)
	}, [pathReleases, myTopBidEvent])
	const myBidderRecord = useMemo(() => (myTopBidEvent ? findBidderRecord(myTopBidEvent.id) : null), [myTopBidEvent])

	// Determine settlement state
	const settlementState = useMemo(() => {
		// Check if settlement is already published
		if (latestSettlement) {
			if (settlementStatus === 'settled') {
				if (isWinner) {
					if (hasClaimOrder) {
						return {
							step: 'order_tracking',
							label: 'Order Submitted',
							description: 'Your shipping address has been submitted',
							action: 'View Order',
							variant: 'success',
						}
					} else {
						return {
							step: 'shipping_address_needed',
							label: 'Submit Shipping Address',
							description: 'Please submit your shipping address to proceed',
							action: 'Submit Address',
							variant: 'info',
						}
					}
				} else if (isSeller) {
					return {
						step: 'shipping_address_needed',
						label: 'Shipping Address Needed',
						description: 'Winner needs to submit shipping address',
						action: null,
						variant: 'info',
					}
				}
			} else if (settlementStatus === 'reserve_not_met') {
				// Check if refund is ready
				if (now >= settlementLocktimeAt && settlementLocktimeAt > 0) {
					return {
						step: 'refund_ready',
						label: 'Refund Ready',
						description: 'You can now claim your refund',
						action: 'Claim Refund',
						variant: 'success',
					}
				} else {
					return {
						step: 'refund_pending',
						label: 'Refund Pending',
						description: 'Refund window opens soon',
						action: null,
						variant: 'warning',
					}
				}
			}
		}

		// If auction hasn't ended yet
		if (!ended) {
			return {
				step: 'auction_active',
				label: 'Auction Active',
				description: 'Bidding is still open',
				action: null,
				variant: 'default',
			}
		}

		// If settlement window has expired
		if (settlementWindowExpired) {
			return {
				step: 'settlement_expired',
				label: 'Settlement Expired',
				description: 'Settlement window has passed',
				action: null,
				variant: 'destructive',
			}
		}

		// Seller perspective
		if (isSeller) {
			if (hasPathReleaseForTopBid && !latestSettlement) {
				return {
					step: 'settlement_pending_seller',
					label: 'Settlement Pending',
					description: 'Please complete settlement by publishing settlement event',
					action: 'Complete Settlement',
					variant: 'warning',
				}
			} else if (!hasPathReleaseForTopBid) {
				return {
					step: 'settlement_pending_bidder',
					label: 'Settlement Pending from Bidder',
					description: 'Waiting for the winning bidder to release their path',
					action: null,
					variant: 'warning',
				}
			}
		}

		// Bidder perspective
		if (!isSeller && currentUserPubkey) {
			if (isMyBidTop) {
				if (myAlreadyReleased) {
					return {
						step: 'settlement_pending_seller',
						label: 'Settlement Pending from Seller',
						description: 'Waiting for seller to complete settlement',
						action: null,
						variant: 'warning',
					}
				} else if (!myBidderRecord) {
					return {
						step: 'local_record_missing',
						label: 'Local Bidder Record Missing',
						description: 'Cannot release path from this device',
						action: null,
						variant: 'destructive',
					}
				} else {
					return {
						step: 'settlement_pending_bidder',
						label: 'Settlement Pending',
						description: 'Please release your path to complete settlement',
						action: 'Release Path',
						variant: 'warning',
					}
				}
			}
		}

		// Default state
		return {
			step: 'settlement_pending_unknown',
			label: 'Settlement Pending',
			description: 'Waiting for settlement to be completed',
			action: null,
			variant: 'default',
		}
	}, [
		latestSettlement,
		settlementStatus,
		isWinner,
		hasClaimOrder,
		isSeller,
		hasPathReleaseForTopBid,
		ended,
		settlementWindowExpired,
		isMyBidTop,
		myAlreadyReleased,
		myBidderRecord,
		currentUserPubkey,
		now,
		settlementLocktimeAt,
	])

	console.log(settlementState)

	// Handle actions
	const queryClient = useQueryClient()
	const settlementMutation = usePublishAuctionSettlementMutation()
	const [isReleasing, setIsReleasing] = useState(false)

	const handleReleasePath = async () => {
		if (!myTopBidEvent) return
		setIsReleasing(true)
		try {
			const result = await nip60Actions.settleAuctionAsWinner({
				bidEventId: myTopBidEvent.id,
				releaseReason: 'settlement',
			})
			toast.success('Path release published — seller can now redeem')
			void result.pathReleaseEventId
			await queryClient.invalidateQueries({ queryKey: auctionKeys.pathReleases(auctionRootEventId) })
			onAction?.()
		} catch (err) {
			toast.error(`Failed to release path: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setIsReleasing(false)
		}
	}

	const handleSubmitSettlement = async () => {
		if (!auction) return

		try {
			const desiredStatus: 'reserve_not_met' | undefined = topBid && reserveMet ? undefined : 'reserve_not_met'
			await settlementMutation.mutateAsync({
				auctionEventId: auctionRootEventId,
				auctionCoordinates,
				status: desiredStatus,
				winningBidEventId: desiredStatus ? undefined : topBid?.id,
			})
			onAction?.()
		} catch {
			// Toast handled in mutation hook.
		}
	}

	// Don't show anything if there's no settlement state to display
	if (settlementState.step === 'auction_active' || settlementState.step === 'settlement_pending_unknown') {
		return null
	}

	// Render the settlement status button
	return (
		<div className={cn('w-full mb-2', className)}>
			<Button
				variant={settlementState.variant === 'warning' ? 'destructive' : settlementState.variant === 'success' ? 'default' : 'secondary'}
				className={cn(
					'w-full py-2 px-3 text-sm font-medium justify-between',
					settlementState.variant === 'warning' && 'bg-pink-500 hover:bg-pink-600 text-white',
					settlementState.variant === 'success' && 'bg-emerald-500 hover:bg-emerald-600 text-white',
					settlementState.variant === 'info' && 'bg-blue-500 hover:bg-blue-600 text-white',
					settlementState.variant === 'destructive' && 'bg-red-500 hover:bg-red-600 text-white',
				)}
				onClick={() => {
					if (settlementState.action === 'Release Path' && !isReleasing) {
						void handleReleasePath()
					} else if (settlementState.action === 'Complete Settlement') {
						void handleSubmitSettlement()
					} else if (settlementState.action) {
						onAction?.()
					}
				}}
				disabled={isReleasing}
			>
				<span className="flex items-center gap-2">
					<span className="font-semibold">{settlementState.label}</span>
					<span className="text-xs opacity-90">{settlementState.description}</span>
				</span>
				{settlementState.action && settlementState.action !== 'Release Path' && (
					<Badge variant="outline" className="ml-2 text-xs bg-white/20 text-white border-white/30">
						{settlementState.action}
					</Badge>
				)}
				{settlementState.action === 'Release Path' && isReleasing && (
					<Badge variant="outline" className="ml-2 text-xs bg-white/20 text-white border-white/30">
						Releasing...
					</Badge>
				)}
			</Button>
		</div>
	)
}
