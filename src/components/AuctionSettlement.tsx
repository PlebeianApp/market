import { useMemo, useState, type ReactElement } from 'react'
import { useStore } from '@tanstack/react-store'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
	getAuctionRootEventId,
} from '@/queries/auctions'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getAuctionWindowValidBids } from '@/lib/auctionSettlement'
import { Clock, CheckCircle, Ban, Truck, Package, Gavel, Trophy } from 'lucide-react'
import { AuctionClaimDialog } from './AuctionClaimDialog'

interface AuctionSettlementProps {
	auction: NDKEvent
	bids: NDKEvent[]
	className?: string
}

export function AuctionSettlement({ auction, bids, className }: AuctionSettlementProps) {
	const { user } = useStore(authStore)
	const currentUserPubkey = user?.pubkey
	const [isClaimDialogOpen, setIsClaimDialogOpen] = useState(false)

	// Get auction identifiers
	const auctionDTag = auction.tags.find((t) => t[0] === 'd')?.[1] || ''
	const auctionCoordinates = auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
	const auctionRootEventId = getAuctionRootEventId(auction) || auction.id

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
		} catch {
			// Toast handled in mutation hook.
		}
	}

	// Determine state and content
	let state: {
		icon: ReactElement | null
		title: string
		message: string
		buttonTitle: string
		buttonAction: (event: React.MouseEvent) => void
		theme: string
		showButton: boolean
	} = {
		icon: null,
		title: '',
		message: '',
		buttonTitle: '',
		buttonAction: () => {},
		theme: 'default', // 'action', 'waiting', 'completed'
		showButton: false,
	}

	if (latestSettlement) {
		if (settlementStatus === 'settled') {
			if (isWinner) {
				if (hasClaimOrder) {
					state = {
						icon: <CheckCircle className="w-5 h-5 text-green-600" />,
						title: 'Order Submitted',
						message: 'Your shipping address has been submitted to the seller.',
						buttonTitle: 'View Order',
						buttonAction: () => console.log('Navigate to order'),
						theme: 'completed',
						showButton: true,
					}
				} else {
					state = {
						icon: <Truck className="w-5 h-5 text-amber-600" />,
						title: 'Shipping Address Needed',
						message: 'Submit your address for the seller to begin the shipping process.',
						buttonTitle: 'Submit Shipping Address',
						buttonAction: () => setIsClaimDialogOpen(true),
						theme: 'action',
						showButton: true,
					}
				}
			} else if (isSeller) {
				if (hasClaimOrder) {
					state = {
						icon: <Clock className="w-5 h-5 text-blue-600" />,
						title: 'Awaiting Shipment',
						message: 'Waiting for you to process and ship the item to the winner.',
						buttonTitle: '',
						buttonAction: () => {},
						theme: 'waiting',
						showButton: false,
					}
				} else {
					state = {
						icon: <Clock className="w-5 h-5 text-blue-600" />,
						title: 'Awaiting Action',
						message: 'Awaiting shipping details from winner.',
						buttonTitle: '',
						buttonAction: () => {},
						theme: 'waiting',
						showButton: false,
					}
				}
			}
		} else if (settlementStatus === 'reserve_not_met') {
			// Check if refund is ready
			if (now >= settlementLocktimeAt && settlementLocktimeAt > 0) {
				state = {
					icon: <CheckCircle className="w-5 h-5 text-green-600" />,
					title: 'Refund Ready',
					message: 'You can now claim your refund.',
					buttonTitle: 'Claim Refund',
					buttonAction: () => console.log('Claim refund'),
					theme: 'completed',
					showButton: true,
				}
			} else {
				state = {
					icon: <Clock className="w-5 h-5 text-blue-600" />,
					title: 'Refund Pending',
					message: 'Refund window opens soon.',
					buttonTitle: '',
					buttonAction: () => {},
					theme: 'waiting',
					showButton: false,
				}
			}
		}
	}

	// If auction hasn't ended yet
	if (!ended && state.theme === 'default') {
		return null
	}

	// If settlement window has expired
	if (settlementWindowExpired && state.theme === 'default') {
		state = {
			icon: <Ban className="w-5 h-5 text-red-600" />,
			title: 'Settlement Expired',
			message: 'Settlement window has passed.',
			buttonTitle: '',
			buttonAction: () => {},
			theme: 'completed',
			showButton: false,
		}
	}

	// Seller perspective
	if (isSeller && state.theme === 'default') {
		if (hasPathReleaseForTopBid && !latestSettlement) {
			state = {
				icon: <Gavel className="w-5 h-5 text-amber-600" />,
				title: 'Settlement Ready',
				message: 'Complete settlement by publishing the settlement event.',
				buttonTitle: 'Publish Settlement',
				buttonAction: () => void handleSubmitSettlement(),
				theme: 'action',
				showButton: true,
			}
		} else if (!hasPathReleaseForTopBid) {
			state = {
				icon: <Clock className="w-5 h-5 text-blue-600" />,
				title: 'Awaiting Path Release',
				message: 'Waiting for the winning bidder to release their path.',
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
			}
		}
	}

	// Bidder perspective
	if (!isSeller && currentUserPubkey && state.theme === 'default') {
		if (isMyBidTop) {
			if (myAlreadyReleased) {
				state = {
					icon: <Clock className="w-5 h-5 text-blue-600" />,
					title: 'Awaiting Settlement',
					message: 'Waiting for seller to complete settlement.',
					buttonTitle: '',
					buttonAction: () => {},
					theme: 'waiting',
					showButton: false,
				}
			} else if (!myBidderRecord) {
				state = {
					icon: <Ban className="w-5 h-5 text-red-600" />,
					title: 'Local Record Missing',
					message: 'Cannot release path from this device. The bid was placed elsewhere.',
					buttonTitle: '',
					buttonAction: () => {},
					theme: 'completed',
					showButton: false,
				}
			} else {
				state = {
					icon: <Package className="w-5 h-5 text-amber-600" />,
					title: 'Settlement Pending',
					message: 'Release your path to complete settlement.',
					buttonTitle: 'Release Path',
					buttonAction: () => void handleReleasePath(),
					theme: 'action',
					showButton: true,
				}
			}
		} else if (isWinner) {
			state = {
				icon: <Clock className="w-5 h-5 text-blue-600" />,
				title: 'Awaiting Action',
				message: 'Awaiting action from seller.',
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
			}
		}
	}

	// Default state
	if (state.theme === 'default') {
		return null
	}

	// Theme classes
	const themeClasses = {
		action: 'border-amber-200 bg-amber-50',
		waiting: 'border-blue-200 bg-blue-50',
		completed: 'border-green-200 bg-green-50',
		default: '',
	}

	return (
		<>
			<Card className={cn('p-4', themeClasses[state.theme as keyof typeof themeClasses], className)}>
				<div className="flex items-start gap-3">
					<div className="mt-0.5">{state.icon}</div>
					<div className="flex-1">
						<h3 className="font-semibold text-foreground">{state.title}</h3>
						<p className="text-sm text-muted-foreground mt-1">{state.message}</p>
						{state.showButton && (
							<Button onClick={state.buttonAction} disabled={isReleasing || settlementMutation.isPending} className="mt-3" size="sm">
								{isReleasing || settlementMutation.isPending ? 'Processing...' : state.buttonTitle}
							</Button>
						)}
					</div>
				</div>
			</Card>

			{/* Shipping Address Dialog */}
			{isWinner && latestSettlement && auction && (
				<AuctionClaimDialog
					open={isClaimDialogOpen}
					onOpenChange={setIsClaimDialogOpen}
					auctionEventId={auctionRootEventId}
					auctionCoordinates={auctionCoordinates}
					settlementEventId={latestSettlement.id}
					sellerPubkey={auction.pubkey}
					finalAmount={settlementFinalAmount}
				/>
			)}
		</>
	)
}
