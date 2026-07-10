import { useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { Button } from '@/components/ui/button'
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
import { Clock, CheckCircle, Ban, Truck, Package } from 'lucide-react'
import { ORDER_STATUS } from '@/lib/schemas/order'

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

	// Determine what to display
	if (latestSettlement) {
		if (settlementStatus === 'settled') {
			if (isWinner) {
				if (hasClaimOrder) {
					return (
						<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
							<CheckCircle className="w-4 h-4 text-green-600" />
							<span>Order completed</span>
						</div>
					)
				} else {
					return (
						<Button onClick={() => onAction?.()} className={className}>
							Submit Shipping Address
						</Button>
					)
				}
			} else if (isSeller) {
				if (hasClaimOrder) {
					return (
						<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
							<Clock className="w-4 h-4 text-yellow-600" />
							<span>Awaiting shipping details from winner</span>
						</div>
					)
				} else {
					return (
						<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
							<Clock className="w-4 h-4 text-yellow-600" />
							<span>Awaiting action from winner</span>
						</div>
					)
				}
			}
		} else if (settlementStatus === 'reserve_not_met') {
			// Check if refund is ready
			if (now >= settlementLocktimeAt && settlementLocktimeAt > 0) {
				return (
					<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
						<CheckCircle className="w-4 h-4 text-green-600" />
						<span>Refund ready to claim</span>
					</div>
				)
			} else {
				return (
					<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
						<Clock className="w-4 h-4 text-yellow-600" />
						<span>Refund pending</span>
					</div>
				)
			}
		}
	}

	// If auction hasn't ended yet
	if (!ended) {
		return null
	}

	// If settlement window has expired
	if (settlementWindowExpired) {
		return (
			<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
				<Ban className="w-4 h-4 text-red-600" />
				<span>Settlement window expired</span>
			</div>
		)
	}

	// Seller perspective
	if (isSeller) {
		if (hasPathReleaseForTopBid && !latestSettlement) {
			return (
				<Button onClick={() => void handleSubmitSettlement()} disabled={settlementMutation.isPending} className={className}>
					{settlementMutation.isPending ? 'Publishing…' : 'Publish Settlement'}
				</Button>
			)
		} else if (!hasPathReleaseForTopBid) {
			return (
				<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
					<Clock className="w-4 h-4 text-yellow-600" />
					<span>Awaiting path release from winner</span>
				</div>
			)
		}
	}

	// Bidder perspective
	if (!isSeller && currentUserPubkey) {
		if (isMyBidTop) {
			if (myAlreadyReleased) {
				return (
					<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
						<Clock className="w-4 h-4 text-yellow-600" />
						<span>Awaiting settlement from seller</span>
					</div>
				)
			} else if (!myBidderRecord) {
				return (
					<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
						<Ban className="w-4 h-4 text-red-600" />
						<span>Local bidder record missing</span>
					</div>
				)
			} else {
				return (
					<Button onClick={() => void handleReleasePath()} disabled={isReleasing} className={className}>
						{isReleasing ? 'Releasing…' : 'Release Path & Settle'}
					</Button>
				)
			}
		} else if (isWinner) {
			return (
				<div className={cn('flex items-center gap-2 text-sm text-muted-foreground flex-wrap', className)}>
					<Clock className="w-4 h-4 text-yellow-600" />
					<span>Awaiting action from seller</span>
				</div>
			)
		}
	}

	// Default state
	return null
}
