import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { toast } from 'sonner'
import { LoaderCircle, Trophy, X } from 'lucide-react'
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
import { hasFinalSettlementForAuctionWin, resolveAuctionWin, shouldUseNonBlockingAuctionWinPrompt } from '@/lib/auction/winNotification'
import { fetchBidNut7States } from '@/lib/auction/useNut7Polling'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { toRawEvent } from '@/lib/nostr/eventLike'
import {
	auctionQueryOptions,
	auctionSettlementsQueryOptions,
	fetchAuctionBids,
	fetchAuctionPathReleases,
	fetchAuctionVerdicts,
	getAuctionBiddingCutoffAt,
	getAuctionImages,
	getAuctionSettlementGrace,
	getAuctionTitle,
} from '@/queries/auctions'
import { auctionKeys } from '@/queries/queryKeyFactory'
import { formatSats } from '@/lib/wallet/display'

const SETTLEMENT_CLOSE_DELAY_MS = 1500

export function AuctionWonModal() {
	const { queue } = useStore(auctionWonStore)
	const { isAuthenticated, user } = useStore(authStore)
	const location = useLocation()
	const active = queue[0] ?? null
	const isActiveBidder = !!(isAuthenticated && user?.pubkey && active?.bidderPubkey === user.pubkey)
	const queryClient = useQueryClient()
	const [isSettling, setIsSettling] = useState(false)
	const [isClosingAfterSettlement, setIsClosingAfterSettlement] = useState(false)
	const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)

	const auctionQuery = useQuery(auctionQueryOptions(active?.auctionRootEventId ?? ''))
	const auction = auctionQuery.data ?? null
	const auctionCoordinate = auction ? getAuctionCoordinate(auction) : ''
	const settlementsQuery = useQuery(auctionSettlementsQueryOptions(active?.auctionRootEventId ?? '', 100, auctionCoordinate))
	const winResolutionQuery = useQuery({
		queryKey: auctionKeys.winResolution(active?.auctionRootEventId ?? '', active?.bidEventId ?? ''),
		enabled: !!(active && auction && auctionCoordinate && isActiveBidder),
		queryFn: async () => {
			if (!active || !auction) throw new Error('Auction win is unavailable')
			const parsedAuctionResult = parseAuctionEvent(toRawEvent(auction))
			if (!parsedAuctionResult.ok) throw new Error('Auction event is malformed')
			const parsedAuction = parsedAuctionResult.value
			const [bidEvents, verdictEvents, pathReleaseEvents] = await Promise.all([
				fetchAuctionBids(active.auctionRootEventId, null, parsedAuction.coordinate),
				fetchAuctionVerdicts(active.auctionRootEventId, null, parsedAuction.coordinate, parsedAuction.auditors),
				fetchAuctionPathReleases(active.auctionRootEventId, null, parsedAuction.coordinate),
			])
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
			const nut7States = await fetchBidNut7States(parsedBids, parsedAuction.mints)
			return resolveAuctionWin(
				active,
				parsedAuction,
				parsedBids,
				parsedVerdicts,
				parsedPathReleases,
				nut7States,
				Math.floor(Date.now() / 1000),
			)
		},
		staleTime: 5000,
		refetchInterval: 5000,
	})
	const title = getAuctionTitle(auction)
	const imageUrl = getAuctionImages(auction)[0]?.[1]
	const sellerPubkey = auction?.pubkey
	const settlementDeadlineAt = getAuctionBiddingCutoffAt(auction) + getAuctionSettlementGrace(auction)
	const settlementCountdown = useAuctionCountdown(settlementDeadlineAt, { showSeconds: true })
	const hasSettlementExpired = auction !== null && settlementDeadlineAt > 0 && settlementCountdown.isEnded
	const hasFinalSettlement =
		active !== null && auction !== null && hasFinalSettlementForAuctionWin(active, auction, auctionCoordinate, settlementsQuery.data ?? [])
	const hasReleasedPath = winResolutionQuery.data?.hasReleasedPath === true
	const isNoLongerWinner = !!winResolutionQuery.data?.canonicalWinner && !winResolutionQuery.data.isActiveWinner
	const hasVerifiedUnresolved =
		auctionQuery.isSuccess &&
		settlementsQuery.isSuccess &&
		winResolutionQuery.isSuccess &&
		winResolutionQuery.data.isActiveWinner &&
		!hasFinalSettlement &&
		!hasReleasedPath
	const useNonBlockingPrompt = shouldUseNonBlockingAuctionWinPrompt(location.pathname)

	useEffect(() => {
		setIsSettling(false)
		setIsClosingAfterSettlement(false)
		setIsLeaveConfirmOpen(false)
	}, [active?.auctionRootEventId])

	useEffect(() => {
		if (active && !isClosingAfterSettlement && (hasSettlementExpired || hasFinalSettlement || hasReleasedPath || isNoLongerWinner)) {
			auctionWonActions.dismissActive()
		}
	}, [active, hasFinalSettlement, hasReleasedPath, hasSettlementExpired, isClosingAfterSettlement, isNoLongerWinner])

	if (
		!active ||
		!isActiveBidder ||
		(!hasVerifiedUnresolved && !isClosingAfterSettlement) ||
		(hasSettlementExpired && !isClosingAfterSettlement)
	)
		return null

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
			setIsClosingAfterSettlement(true)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: auctionKeys.pathReleases(active.auctionRootEventId) }),
				queryClient.invalidateQueries({ queryKey: auctionKeys.details(active.auctionRootEventId) }),
				new Promise((resolve) => setTimeout(resolve, SETTLEMENT_CLOSE_DELAY_MS)),
			])
			toast.success('Path release published — seller can now redeem')
			auctionWonActions.dismissActive()
		} catch (err) {
			toast.error(`Failed to settle auction: ${err instanceof Error ? err.message : String(err)}`)
			setIsClosingAfterSettlement(false)
			setIsSettling(false)
		}
	}

	const settlementButton = (
		<Button size="lg" className="w-full" onClick={handleSettle} disabled={isSettling}>
			{isSettling ? (
				<>
					<LoaderCircle className="animate-spin" />
					Settling…
				</>
			) : (
				'Settle Auction'
			)}
		</Button>
	)

	const leaveConfirmation = (
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
	)

	if (useNonBlockingPrompt) {
		return (
			<>
				<ConfettiBurst />
				<aside
					role="dialog"
					aria-modal="false"
					aria-labelledby="auction-win-prompt-title"
					className="fixed top-20 right-3 z-40 w-[calc(100%-1.5rem)] max-w-sm overflow-hidden rounded-lg border-2 border-amber-400 bg-background shadow-2xl sm:top-24 sm:right-5"
				>
					<div className="h-1.5 bg-amber-400" />
					<button
						type="button"
						onClick={() => setIsLeaveConfirmOpen(true)}
						className="absolute top-4 right-4 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						aria-label="Close auction settlement prompt"
					>
						<X className="h-4 w-4" />
					</button>

					<div className="space-y-4 p-5 pr-11">
						<div className="flex items-start gap-3">
							<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
								<Trophy className="h-6 w-6" />
							</div>
							<div className="min-w-0">
								<h2 id="auction-win-prompt-title" className="text-lg font-bold">
									You won this auction
								</h2>
								<p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
							</div>
						</div>

						<div className="flex items-end justify-between gap-4 border-y py-3">
							<div>
								<p className="text-xs text-muted-foreground">Winning bid</p>
								<p className="text-xl font-bold">{formatSats(active.bidAmount)} sats</p>
							</div>
							<p className="text-right text-xs font-medium text-muted-foreground">
								Settle in
								<br />
								<span className="text-sm text-foreground">{settlementCountdown.displayLabel}</span>
							</p>
						</div>

						{settlementButton}
					</div>
				</aside>
				{leaveConfirmation}
			</>
		)
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

						{settlementButton}
					</div>
				</DialogContent>
			</Dialog>

			{leaveConfirmation}
		</>
	)
}
