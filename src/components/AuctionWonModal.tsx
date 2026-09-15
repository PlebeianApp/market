import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Trophy } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Media } from '@/components/Media'
import { UserCard } from '@/components/UserCard'
import { ConfettiBurst } from '@/components/ConfettiBurst'
import { auctionWonActions, auctionWonStore } from '@/lib/stores/auctionWon'
import { authStore } from '@/lib/stores/auth'
import { nip60Actions } from '@/lib/stores/nip60'
import { useAuctionCountdown } from '@/components/AuctionCountdown'
import { getAuctionCoordinate } from '@/lib/auctionSettlement'
import { hasFinalSettlementForAuctionWin, isAuctionWonModalSuppressedPath } from '@/lib/auction/winNotification'
import {
	auctionQueryOptions,
	auctionSettlementsQueryOptions,
	getAuctionBiddingCutoffAt,
	getAuctionImages,
	getAuctionSettlementGrace,
	getAuctionTitle,
} from '@/queries/auctions'
import { auctionKeys } from '@/queries/queryKeyFactory'
import { formatSats } from '@/lib/wallet/display'

export function AuctionWonModal() {
	const { queue } = useStore(auctionWonStore)
	const { isAuthenticated, user } = useStore(authStore)
	const location = useLocation()
	const active = queue[0] ?? null
	const isActiveBidder = !!(isAuthenticated && user?.pubkey && active?.bidderPubkey === user.pubkey)
	const queryClient = useQueryClient()
	const [isSettling, setIsSettling] = useState(false)
	const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)

	const auctionQuery = useQuery(auctionQueryOptions(active?.auctionRootEventId ?? ''))
	const auction = auctionQuery.data ?? null
	const auctionCoordinate = auction ? getAuctionCoordinate(auction) : ''
	const settlementsQuery = useQuery(auctionSettlementsQueryOptions(active?.auctionRootEventId ?? '', 100, auctionCoordinate))
	const title = getAuctionTitle(auction)
	const imageUrl = getAuctionImages(auction)[0]?.[1]
	const sellerPubkey = auction?.pubkey
	const settlementDeadlineAt = getAuctionBiddingCutoffAt(auction) + getAuctionSettlementGrace(auction)
	const settlementCountdown = useAuctionCountdown(settlementDeadlineAt, { showSeconds: true })
	const hasSettlementExpired = auction !== null && settlementDeadlineAt > 0 && settlementCountdown.isEnded
	const hasFinalSettlement =
		active !== null && auction !== null && hasFinalSettlementForAuctionWin(active, auction, auctionCoordinate, settlementsQuery.data ?? [])
	const hasVerifiedUnresolved = auctionQuery.isSuccess && settlementsQuery.isSuccess && !hasFinalSettlement
	const isOnFocusedWorkflow = isAuctionWonModalSuppressedPath(location.pathname)

	useEffect(() => {
		setIsSettling(false)
		setIsLeaveConfirmOpen(false)
	}, [active?.auctionRootEventId])

	useEffect(() => {
		if (active && (hasSettlementExpired || hasFinalSettlement)) auctionWonActions.dismissActive()
	}, [active, hasFinalSettlement, hasSettlementExpired])

	if (!active || !isActiveBidder || !hasVerifiedUnresolved || hasSettlementExpired || isOnFocusedWorkflow) return null

	const handleOpenChange = (open: boolean) => {
		if (!open) setIsLeaveConfirmOpen(true)
	}

	const handleLeaveSettlement = () => {
		setIsLeaveConfirmOpen(false)
		auctionWonActions.dismissActive()
	}

	const handleSettle = async () => {
		if (!isAuthenticated || !user?.pubkey || active.bidderPubkey !== user.pubkey) {
			auctionWonActions.clear()
			toast.error('Your account changed. Reopen the auction before settling.')
			return
		}

		setIsSettling(true)
		try {
			await nip60Actions.settleAuctionAsWinner({
				bidEventId: active.bidEventId,
				releaseReason: 'settlement',
			})
			await queryClient.invalidateQueries({ queryKey: auctionKeys.pathReleases(active.auctionRootEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(active.auctionRootEventId) })
			toast.success('Path release published — seller can now redeem')
			auctionWonActions.dismissActive()
		} catch (err) {
			toast.error(`Failed to settle auction: ${err instanceof Error ? err.message : String(err)}`)
			setIsSettling(false)
		}
	}

	return (
		<>
			<Dialog open onOpenChange={handleOpenChange}>
				<DialogContent className="overflow-hidden sm:max-w-md">
					<ConfettiBurst />
					<div className="relative flex flex-col items-center gap-4 pt-2 text-center">
						<div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
							<Trophy className="h-7 w-7" />
						</div>

						<div>
							<DialogTitle className="text-2xl font-bold">You won!</DialogTitle>
							<DialogDescription className="mt-1 text-sm text-muted-foreground">
								Your bid was the highest when the auction closed. Settle now to let the seller ship your item.
							</DialogDescription>
						</div>

						{imageUrl && (
							<div className="h-40 w-40 overflow-hidden rounded-lg border">
								<Media src={imageUrl} alt={title} video={false} className="h-full w-full object-cover" />
							</div>
						)}

						<h3 className="text-lg font-semibold">{title}</h3>

						{sellerPubkey && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<span>Seller:</span>
								<UserCard pubkey={sellerPubkey} size="xs" subtitle="none" onPress="none" />
							</div>
						)}

						<div className="rounded-lg bg-muted px-4 py-2">
							<div className="text-xs text-muted-foreground">Your winning bid</div>
							<div className="text-xl font-bold">{formatSats(active.bidAmount)} sats</div>
						</div>

						<div className="text-sm font-medium text-muted-foreground">Time left to settle: {settlementCountdown.displayLabel}</div>

						<Button size="lg" className="w-full" onClick={handleSettle} disabled={isSettling}>
							{isSettling ? 'Settling…' : 'Settle Auction'}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog open={isLeaveConfirmOpen} onOpenChange={setIsLeaveConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Leave settlement?</AlertDialogTitle>
						<AlertDialogDescription>
							You are leaving this auction unsettled. The settlement window will continue to count down, and the seller cannot redeem your
							payment until you settle.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Continue settlement</AlertDialogCancel>
						<AlertDialogAction onClick={handleLeaveSettlement}>Leave settlement</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
