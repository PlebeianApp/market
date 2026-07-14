import { cn } from '@/lib/utils'
import { AvatarUser } from '@/components/AvatarUser'
import { AuctionCountdown } from '@/components/AuctionCountdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authStore } from '@/lib/stores/auth'
import { notificationActions } from '@/lib/stores/notifications'
import { uiActions } from '@/lib/stores/ui'
import { usePublishAuctionSettlementMutation } from '@/publish/auctions'
import {
	auctionsByPubkeyQueryOptions,
	getAuctionBiddingCutoffAt,
	getAuctionBidCountFromBids,
	getAuctionId,
	getAuctionImages,
	getAuctionRootEventId,
	getAuctionStartAt,
	getAuctionSummary,
	getAuctionTitle,
	getAuctionTopBidFromBids,
	getBidAmount,
	useAuctionBids,
	useAuctionBidsForList,
	useAuctionClaimOrders,
	useAuctionSettlements,
} from '@/queries/auctions'
import { useComments } from '@/queries/comments'
import { useLiveActivity, useLiveChatMessages } from '@/queries/liveChat'
import { getOrderId } from '@/queries/orders'
import { useProfileName } from '@/queries/profiles'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Clock, ExternalLink, Gavel, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
	auctionSortOptionValues,
	defaultAuctionFilters,
	getAuctionSortOptionTitle,
	useFilteredAuctions,
	type AuctionSortOption,
} from '@/lib/utils/auctions'

type AuctionStatus = 'Scheduled' | 'Live' | 'Settlement' | 'Ended'

function formatAuctionStatus(startAt: number, biddingCutoffAt: number, settlementLocked: boolean, now: number): AuctionStatus {
	if (startAt > 0 && now < startAt) return 'Scheduled'
	if (settlementLocked) return 'Ended'
	if (biddingCutoffAt > 0 && now >= biddingCutoffAt) return 'Settlement'
	return 'Live'
}

function formatMaybeDate(timestamp: number): string {
	if (!timestamp) return 'N/A'
	return new Date(timestamp * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTimeAgo(timestamp: number): string {
	if (!timestamp) return ''
	const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp)
	if (diffSeconds < 60) return 'just now'
	const diffMinutes = Math.floor(diffSeconds / 60)
	if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`
	const diffHours = Math.floor(diffMinutes / 60)
	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
	const diffDays = Math.floor(diffHours / 24)
	return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

const getAuctionCoordinates = (auction: NDKEvent): string => {
	const auctionDTag = getAuctionId(auction)
	return auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
}

const STATUS_BADGE_STYLES: Record<AuctionStatus, string> = {
	Scheduled: 'border-sky-400 text-sky-700 bg-sky-50',
	Live: 'border-emerald-400 text-emerald-700 bg-emerald-50',
	Settlement: 'border-sky-400 text-sky-700 bg-sky-50',
	Ended: 'border-zinc-300 text-zinc-500 bg-zinc-50',
}

function ActivityRow({ header, unit, count, newCount }: { header: string; unit: string; count: number; newCount: number }) {
	return (
		<div className="space-y-0.5">
			<p className="text-xs text-muted-foreground">{header}</p>
			<p className="text-sm">
				<span className="font-semibold">
					{count} {count === 1 ? unit : `${unit}s`}
				</span>
				{newCount > 0 && <span className="ml-2 text-pink-600 font-semibold">{newCount} New</span>}
			</p>
		</div>
	)
}

function TopBidBox({ auction, bids }: { auction: NDKEvent; bids: NDKEvent[] }) {
	const topBid = getAuctionTopBidFromBids(auction, bids)
	const { data: bidderName } = useProfileName(topBid?.pubkey ?? '')

	if (!topBid) {
		return (
			<div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-4">
				<p className="text-sm text-zinc-500">No bids yet. Winning bid will appear here.</p>
			</div>
		)
	}

	return (
		<div className="rounded-xl border-2 border-emerald-300 bg-emerald-100 px-4 py-4">
			<div>
				<div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">
					<span>Top bid:</span>
					<span>{formatTimeAgo(topBid.created_at ?? 0)}</span>
				</div>
				<p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">{getBidAmount(topBid).toLocaleString()} sats</p>
			</div>
			<div className="mt-2 flex items-center justify-between gap-2">
				<Badge className="border-emerald-300 bg-white text-emerald-800 hover:bg-white">Winning bid</Badge>

				<div className="flex items-center gap-2">
					<Link to="/profile/$profileId" params={{ profileId: topBid.pubkey }}>
						<AvatarUser pubkey={topBid.pubkey} colored deterministicFallbackText className="w-6 h-6" />
					</Link>
					<span className="text-sm font-medium truncate max-w-32">{bidderName || topBid.pubkey.slice(0, 8)}</span>
				</div>
			</div>
		</div>
	)
}

function AuctionListItem({
	auction,
	onPublishSettlement,
	isSettling,
}: {
	auction: NDKEvent
	onPublishSettlement: () => void
	isSettling: boolean
}) {
	const summary = getAuctionSummary(auction) || auction.content || 'No description'
	const images = getAuctionImages(auction)
	const thumbnailUrl = images.length > 0 ? images[0][1] : null
	const startAt = getAuctionStartAt(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = getAuctionCoordinates(auction)
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const now = Math.floor(Date.now() / 1000)

	const bidsQuery = useAuctionBids(auctionRootEventId || auction.id, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const bidsCount = getAuctionBidCountFromBids(auction, bids)
	const newBidsCount = bids.filter((bid) => (bid.created_at ?? 0) > notificationActions.getLastSeenAuctionBids()).length

	const settlementsQuery = useAuctionSettlements(auctionRootEventId || auction.id, 5, auctionCoordinates)
	const latestSettlement = settlementsQuery.data?.[0] ?? null
	const settlementLocked = !!latestSettlement

	const status = formatAuctionStatus(startAt, biddingCutoffAt, settlementLocked, now)

	const commentsQuery = useComments(auction)
	const comments = commentsQuery.data ?? []
	const newCommentsCount = comments.filter((comment) => comment.createdAt > notificationActions.getLastSeenAuctionEventComments()).length
	const liveActivityQuery = useLiveActivity(auction)
	const liveActivityCoord = liveActivityQuery.data?.coord ?? ''
	const chatQuery = useLiveChatMessages(liveActivityCoord, status === 'Live')
	const chatMessages = chatQuery.data ?? []
	const newChatCount = chatMessages.filter((message) => message.createdAt > notificationActions.getLastSeenAuctionComments()).length

	const claimOrdersQuery = useAuctionClaimOrders(auctionCoordinates)
	const orderId = claimOrdersQuery.data?.[0] ? getOrderId(claimOrdersQuery.data[0]) : undefined

	return (
		<div className="rounded-lg border border-zinc-200 bg-background p-6 shadow-md">
			<div className="flex flex-col gap-6 lg:flex-row">
				<div className="flex shrink-0 items-start gap-3 lg:flex-col">
					{thumbnailUrl ? (
						<img src={thumbnailUrl} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover lg:h-32 lg:w-32" />
					) : (
						<div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-zinc-100 lg:h-32 lg:w-32">
							<Gavel className="h-8 w-8 text-zinc-400" />
						</div>
					)}
					<Link to="/dashboard/products/auctions/$auctionId" params={{ auctionId: auction.id }} className="lg:w-32">
						<Button variant="outline" size="sm" className="w-full gap-2">
							<ExternalLink className="h-3.5 w-3.5" />
							Open Auction
						</Button>
					</Link>
				</div>

				<div className="flex-1 min-w-0 space-y-4 lg:max-w-[28rem]">
					<div className="min-w-0">
						<h3 className="text-lg font-semibold text-foreground truncate">{getAuctionTitle(auction)}</h3>
						<p className="text-sm text-muted-foreground truncate">{summary}</p>
						<p className="mt-1 text-xs text-muted-foreground">Created: {formatMaybeDate(auction.created_at ?? 0)}</p>
					</div>

					<TopBidBox auction={auction} bids={bids} />

					{status === 'Settlement' && (
						<Button className="w-full bg-pink-600 hover:bg-pink-700 text-white" onClick={onPublishSettlement} disabled={isSettling}>
							{isSettling ? (
								<>
									<Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
									Publishing…
								</>
							) : (
								'Publish Settlement'
							)}
						</Button>
					)}

					{status === 'Ended' && orderId && (
						<Link to="/dashboard/orders/$orderId" params={{ orderId }}>
							<Button className="w-full bg-neutral-800 hover:bg-neutral-700 text-white">Go to Order Page</Button>
						</Link>
					)}
				</div>

				<div className="ml-auto flex w-full shrink-0 flex-col items-end gap-3 lg:w-[22rem]">
					<div className="flex w-full items-center gap-2">
						<div className="min-w-0 flex-1">
							<AuctionCountdown auction={auction} bids={bids} />
						</div>
						<span
							className={cn('inline-flex w-fit whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium', STATUS_BADGE_STYLES[status])}
						>
							{status}
						</span>
					</div>
					<div className="w-full space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Activity</p>
						<ActivityRow header="Bids" unit="Bid" count={bidsCount} newCount={newBidsCount} />
						<ActivityRow header="Comments" unit="Comment" count={comments.length} newCount={newCommentsCount} />
						<ActivityRow header="Live Chat" unit="Message" count={chatMessages.length} newCount={newChatCount} />
					</div>
				</div>
			</div>
		</div>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/auctions')({
	component: AuctionsOverviewComponent,
})

function AuctionsOverviewComponent() {
	const { user, isAuthenticated } = useStore(authStore)
	const matchRoute = useMatchRoute()
	const [sort, setSort] = useState<AuctionSortOption>(defaultAuctionFilters.sort ?? 'ending-soon')
	const settlementMutation = usePublishAuctionSettlementMutation()
	const [settlingAuctionId, setSettlingAuctionId] = useState<string | null>(null)
	const [animationParent] = useAutoAnimate()

	const isOnChildRoute = matchRoute({
		to: '/dashboard/products/auctions/$auctionId',
		fuzzy: true,
	})

	useDashboardTitle(isOnChildRoute ? 'Auction Details' : 'Auctions')

	useEffect(() => {
		if (isAuthenticated && user?.pubkey) {
			notificationActions.markAuctionBidsSeen()
			notificationActions.markAuctionCommentsSeen()
			notificationActions.markAuctionEventCommentsSeen()
			notificationActions.markAuctionLiveSeen()
			notificationActions.markAuctionSettlementBeginsSeen()
		}
	}, [isAuthenticated, user?.pubkey])

	const {
		data: auctions,
		isLoading,
		error,
	} = useQuery({
		...auctionsByPubkeyQueryOptions(user?.pubkey ?? ''),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	const auctionRootEventIdsForBids = useMemo(
		() => (auctions ?? []).map((auction) => getAuctionRootEventId(auction) || auction.id),
		[auctions],
	)
	const { data: bidsByAuctionId } = useAuctionBidsForList(auctionRootEventIdsForBids)
	const sortedAuctions = useFilteredAuctions({ auctions: auctions ?? [], filters: { sort: sort }, bidsByAuctionId, tag: undefined })

	const handlePublishSettlement = async (auction: NDKEvent) => {
		const auctionRootEventId = getAuctionRootEventId(auction)
		const auctionCoordinates = getAuctionCoordinates(auction)
		setSettlingAuctionId(auction.id)
		try {
			// Backend computes the actual outcome (settled / reserve_not_met)
			// from bids + reserve; we don't pre-pick a status here.
			await settlementMutation.mutateAsync({
				auctionEventId: auctionRootEventId || auction.id,
				auctionCoordinates,
			})
		} catch {
			// Toast handled by mutation hook.
		} finally {
			setSettlingAuctionId(null)
		}
	}

	const handleCreateAuction = () => {
		uiActions.openDrawer('createAuction')
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your auctions.</p>
			</div>
		)
	}

	if (isOnChildRoute) {
		return <Outlet />
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Auctions</h1>
				<div className="flex items-center gap-4">
					<Select value={sort} onValueChange={(value) => setSort(value as AuctionSortOption)}>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							{auctionSortOptionValues.map((value) => (
								<SelectItem key={value} value={value}>
									{getAuctionSortOptionTitle(value)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Link to="/auctions">
						<Button variant="outline" className="gap-2">
							<ExternalLink className="w-4 h-4" />
							View Public Auctions
						</Button>
					</Link>
					<Button
						onClick={handleCreateAuction}
						className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold"
					>
						<Gavel className="w-4 h-4" />
						Add An Auction
					</Button>
				</div>
			</div>

			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden space-y-4">
					<Select value={sort} onValueChange={(value) => setSort(value as AuctionSortOption)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							{auctionSortOptionValues.map((value) => (
								<SelectItem key={value} value={value}>
									{getAuctionSortOptionTitle(value)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						onClick={handleCreateAuction}
						data-testid="add-auction-button-mobile"
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<Gavel className="w-4 h-4" /> Add An Auction
					</Button>
				</div>

				<div>
					{isLoading && (
						<div className="text-center py-8 text-gray-500">
							<Clock className="animate-spin h-6 w-6 mx-auto mb-2" />
							Loading auctions...
						</div>
					)}

					{error && (
						<div className="text-center py-8 text-red-500">
							Failed to load your auctions: {error instanceof Error ? error.message : 'Unknown error'}
						</div>
					)}

					{!isLoading && !error && sortedAuctions.length === 0 && (
						<div className="text-center py-12 border rounded-lg">
							<Gavel className="h-10 w-10 mx-auto mb-3 text-gray-400" />
							<h3 className="text-lg font-medium mb-1">No auctions yet</h3>
							<p className="text-muted-foreground mb-4">Click the "Add An Auction" button to create your first one.</p>
							<Button onClick={handleCreateAuction} className="bg-neutral-800 hover:bg-neutral-700 text-white">
								Add An Auction
							</Button>
						</div>
					)}

					{!isLoading && !error && sortedAuctions.length > 0 && (
						<ul ref={animationParent} className="flex flex-col gap-4 mt-4">
							{sortedAuctions.map((auction) => (
								<li key={auction.id}>
									<AuctionListItem
										auction={auction}
										onPublishSettlement={() => void handlePublishSettlement(auction)}
										isSettling={settlingAuctionId === auction.id && settlementMutation.isPending}
									/>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	)
}
