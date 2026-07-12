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
	getAuctionTopBidValid,
} from '@/queries/auctions'
import { getAuctionWindowValidBids } from '@/lib/auctionSettlement'
import { Clock, CheckCircle, Ban, Truck, Package, Gavel, Trophy } from 'lucide-react'
import { AuctionClaimDialog } from './AuctionClaimDialog'
import { useNavigate } from '@tanstack/react-router'
import type { NDKEvent } from '@/lib/nostr/ndk-events'

interface AuctionSettlementProps {
	auction: NDKEvent
	bids: NDKEvent[]
	className?: string
}

export function AuctionSettlement({ auction, bids, className }: AuctionSettlementProps) {
	const { user } = useStore(authStore)
	const currentUserPubkey = user?.pubkey
	const [isClaimDialogOpen, setIsClaimDialogOpen] = useState(false)
	const navigate = useNavigate()

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
	const hasClaimOrder = claimOrders.some((order) => order.pubkey === (isSeller ? settlementWinner : currentUserPubkey))

	// Task 1: Replace boolean hasClaimOrder check with matchedClaimOrder constant
	const matchedClaimOrder = useMemo(() => {
		if (isSeller && settlementWinner) {
			// Seller view - look for order from the winner
			return claimOrders.find((order) => order.pubkey === settlementWinner) ?? null
		} else if (!isSeller && currentUserPubkey) {
			// Buyer view - look for order from the current user
			return claimOrders.find((order) => order.pubkey === currentUserPubkey) ?? null
		}
		return null
	}, [claimOrders, isSeller, settlementWinner, currentUserPubkey])

	// Get auction timing info
	const maxEndAt = getAuctionMaxEndAt(auction)
	const settlementGrace = getAuctionSettlementGrace(auction)
	const settlementLocktimeAt = maxEndAt > 0 && settlementGrace > 0 ? maxEndAt + settlementGrace : 0
	const now = Math.floor(Date.now() / 1000)
	const settlementWindowExpired = settlementLocktimeAt > 0 && now >= settlementLocktimeAt
	const ended = maxEndAt > 0 && now >= maxEndAt

	// Get top bid info
	const topBid = useMemo(() => getAuctionTopBidValid(auction, bids), [auction, bids])

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
		bidAmount?: number
	} = {
		icon: null,
		title: '',
		message: '',
		buttonTitle: '',
		buttonAction: () => {},
		theme: 'default', // 'action', 'waiting', 'completed'
		showButton: false,
		bidAmount: 0,
	}

	// Bidder settle action - shown to the top bidder once the auction ends
	// so they can publish their kind-1025 path release
	if (isMyBidTop && ended && !myAlreadyReleased && myBidderRecord && !latestSettlement) {
		state = {
			icon: <Gavel className="w-5 h-5 text-sky-300" />,
			title: 'You won — release your path to settle',
			message: `Bid: ${getBidAmount(myTopBidEvent!).toLocaleString()} sats. Publishing your kind-1025 reveals the derivation path so the seller can redeem your locked proofs.`,
			buttonTitle: isReleasing ? 'Releasing…' : 'Release path & settle',
			buttonAction: () => void handleReleasePath(),
			theme: 'action',
			showButton: true,
			bidAmount: getBidAmount(myTopBidEvent!),
		}
	}
	// Path release published - waiting for seller to redeem and publish settlement
	else if (isMyBidTop && ended && myAlreadyReleased && settlementStatus !== 'settled') {
		state = {
			icon: <CheckCircle className="w-5 h-5 text-emerald-300" />,
			title: 'Path release published',
			message: 'Waiting for seller to redeem and publish settlement.',
			buttonTitle: '',
			buttonAction: () => {},
			theme: 'waiting',
			showButton: false,
			bidAmount: 0,
		}
	}
	// Winner banner - shown to the auction winner after settlement
	else if (isWinner && settlementStatus === 'settled') {
		// Task 1: Update navigation logic to use matchedClaimOrder?.id for the route
		if (matchedClaimOrder) {
			const action = () => {
				if (matchedClaimOrder.id) {
					navigate({ to: `/dashboard/orders/${matchedClaimOrder.id}` })
				} else {
					toast.error('Issue with order id. Go to Dashboard -> Your Purchases to find the order.')
				}
			}

			state = {
				icon: <CheckCircle className="w-5 h-5 text-emerald-300" />,
				title: 'You won this auction!',
				message: `Shipping details submitted — awaiting seller. Final price: ${settlementFinalAmount.toLocaleString()} sats`,
				buttonTitle: 'View Order',
				buttonAction: action,
				theme: 'completed',
				showButton: true,
				bidAmount: settlementFinalAmount,
			}
		} else {
			state = {
				icon: <Trophy className="w-5 h-5 text-emerald-300" />,
				title: 'You won this auction!',
				message: `Final price: ${settlementFinalAmount.toLocaleString()} sats`,
				buttonTitle: 'Submit Shipping Address',
				buttonAction: () => setIsClaimDialogOpen(true),
				theme: 'action',
				showButton: true,
				bidAmount: settlementFinalAmount,
			}
		}
	}
	// Seller side - check if winner has submitted shipping details
	else if (isSeller && settlementStatus === 'settled' && settlementWinner) {
		// Task 1: Update navigation logic to use matchedClaimOrder?.id for the route
		if (matchedClaimOrder) {
			const action = () => {
				if (matchedClaimOrder.id) {
					navigate({ to: `/dashboard/orders/${matchedClaimOrder.id}` })
				} else {
					toast.error('Issue with order id. Go to Dashboard -> Sales to find the order.')
				}
			}

			state = {
				icon: <Truck className="w-5 h-5 text-emerald-300" />,
				title: 'Order Received',
				message: 'Winner has submitted shipping details. Process and ship the item.',
				buttonTitle: 'View Order',
				buttonAction: action,
				theme: 'completed',
				showButton: true,
				bidAmount: 0,
			}
		} else {
			state = {
				icon: <Clock className="w-5 h-5 text-blue-300" />,
				title: 'Awaiting Shipping Details',
				message: 'Waiting for winner to submit shipping details.',
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
				bidAmount: 0,
			}
		}
	}
	// Reserve not met states
	else if (latestSettlement && settlementStatus === 'reserve_not_met') {
		// Check if refund is ready
		if (now >= settlementLocktimeAt && settlementLocktimeAt > 0) {
			// Task 2: Remove the "Claim Refund" button and replace with static informational message
			state = {
				icon: <CheckCircle className="w-5 h-5 text-green-300" />,
				title: 'Refund Ready',
				message: 'Refund window opened - verify the unlocked funds have returned to your wallet.',
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'completed',
				showButton: false, // Task 2: Ensure showButton is set to false
				bidAmount: 0,
			}
		} else {
			state = {
				icon: <Clock className="w-5 h-5 text-blue-300" />,
				title: 'Refund Pending',
				message: 'Refund window opens soon.',
				buttonTitle: '',
				buttonAction: () => {},
				theme: 'waiting',
				showButton: false,
				bidAmount: 0,
			}
		}
	}
	// Settlement window expired
	else if (settlementWindowExpired && !latestSettlement) {
		state = {
			icon: <Ban className="w-5 h-5 text-red-300" />,
			title: 'Settlement Expired',
			message: 'Settlement window has passed.',
			buttonTitle: '',
			buttonAction: () => {},
			theme: 'completed',
			showButton: false,
			bidAmount: 0,
		}
	}
	// Seller settlement action
	else if (isSeller && ended && !latestSettlement && hasPathReleaseForTopBid) {
		state = {
			icon: <Gavel className="w-5 h-5 text-amber-300" />,
			title: 'Settlement Ready',
			message: 'Complete settlement by publishing the settlement event.',
			buttonTitle: settlementMutation.isPending ? 'Publishing…' : 'Publish Settlement',
			buttonAction: () => void handleSubmitSettlement(),
			theme: 'action',
			showButton: true,
			bidAmount: 0,
		}
	}
	// Seller waiting for path release
	else if (isSeller && ended && !latestSettlement && !hasPathReleaseForTopBid) {
		state = {
			icon: <Clock className="w-5 h-5 text-blue-300" />,
			title: 'Awaiting Path Release',
			message: 'Waiting for the winning bidder to release their path.',
			buttonTitle: '',
			buttonAction: () => {},
			theme: 'waiting',
			showButton: false,
			bidAmount: 0,
		}
	}
	// Bidder waiting for seller after releasing path
	else if (!isSeller && isMyBidTop && myAlreadyReleased && settlementStatus !== 'settled') {
		state = {
			icon: <Clock className="w-5 h-5 text-blue-300" />,
			title: 'Awaiting Settlement',
			message: 'Waiting for seller to complete settlement.',
			buttonTitle: '',
			buttonAction: () => {},
			theme: 'waiting',
			showButton: false,
			bidAmount: 0,
		}
	}
	// Bidder local record missing
	else if (!isSeller && isMyBidTop && !myBidderRecord) {
		state = {
			icon: <Ban className="w-5 h-5 text-red-300" />,
			title: 'Local Record Missing',
			message: 'Cannot release path from this device. The bid was placed elsewhere.',
			buttonTitle: '',
			buttonAction: () => {},
			theme: 'completed',
			showButton: false,
			bidAmount: 0,
		}
	}
	// Auction not ended yet
	else if (!ended) {
		return null
	}

	// Default state - no settlement state to display
	if (state.theme === 'default') {
		return null
	}

	// Theme classes
	const themeClasses = {
		action: 'border-amber-100 bg-amber-50/30',
		waiting: 'border-blue-100 bg-blue-50/30',
		completed: 'border-green-100 bg-green-50/30',
		default: '',
	}

	return (
		<>
			<Card className={cn('p-4', themeClasses[state.theme as keyof typeof themeClasses], className)}>
				<div className="flex items-start gap-3">
					<div className="mt-0.5">{state.icon}</div>
					<div className="flex-1">
						<h3 className="font-semibold text-foreground">{state.title}</h3>
						<p className="text-sm text-white-200 mt-1">{state.message}</p>
						{state.showButton && (
							<Button onClick={state.buttonAction} disabled={isReleasing || settlementMutation.isPending} className="mt-3" size="sm">
								{state.buttonTitle}
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
