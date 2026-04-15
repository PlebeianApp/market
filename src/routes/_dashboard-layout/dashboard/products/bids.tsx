import { AuctionClaimDialog } from '@/components/AuctionClaimDialog'
import { AuctionCountdown } from '@/components/AuctionCountdown'
import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { nip60Actions, nip60Store, type PendingNip60Token } from '@/lib/stores/nip60'
import { getMintHostname } from '@/lib/wallet'
import {
	auctionClaimOrdersQueryOptions,
	auctionQueryOptions,
	auctionSettlementsQueryOptions,
	getAuctionEndAt,
	getAuctionId,
	getAuctionSettlementFinalAmount,
	getAuctionSettlementStatus,
	getAuctionSettlementWinner,
	getAuctionSettlementWinningBid,
	getAuctionTitle,
	getBidAmount,
	getBidAuctionCoordinates,
	getBidAuctionEventId,
	getBidLocktime,
	getBidMint,
	getBidSellerPubkey,
	useAuctionBidsByBidder,
} from '@/queries/auctions'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { CheckCircle, Clock, ExternalLink, Loader2, MapPin, RotateCcw, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

type BidGroup = {
	key: string
	auctionEventId: string
	auctionCoordinates?: string
	sellerPubkey: string
	latestBid: NDKEvent
	bids: NDKEvent[]
	pendingTokens: PendingNip60Token[]
}

const formatMaybeDate = (timestamp: number): string => {
	if (!timestamp) return 'N/A'
	return new Date(timestamp * 1000).toLocaleString()
}

const shortenHex = (value: string, left: number = 12, right: number = 10): string => {
	if (!value) return 'N/A'
	if (value.length <= left + right + 1) return value
	return `${value.slice(0, left)}...${value.slice(-right)}`
}

const shortenBidRef = (value: string): string => shortenHex(value, 10, 8)

const getPendingAuctionBidTokens = (tokens: PendingNip60Token[]): PendingNip60Token[] =>
	tokens.filter((token) => token.context?.kind === 'auction_bid')

const getPendingTokenLocktime = (token: PendingNip60Token): number => token.context?.locktime ?? 0

const getLatestBidForGroup = (bids: NDKEvent[]): NDKEvent =>
	[...bids].sort((a, b) => {
		const amountDelta = getBidAmount(b) - getBidAmount(a)
		if (amountDelta !== 0) return amountDelta
		const createdAtDelta = (b.created_at || 0) - (a.created_at || 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return b.id.localeCompare(a.id)
	})[0]

const getBidGroupState = (
	group: BidGroup,
	settlementEvent: NDKEvent | null,
	userPubkey: string,
	now: number,
): {
	label: string
	helper: string
	toneClass: string
	reclaimableTokens: PendingNip60Token[]
} => {
	const reclaimableTokens = group.pendingTokens.filter((token) => token.status === 'pending' && getPendingTokenLocktime(token) <= now)
	const trackedTokens = group.pendingTokens.length
	const allClaimed = trackedTokens > 0 && group.pendingTokens.every((token) => token.status === 'claimed')
	const allReclaimed = trackedTokens > 0 && group.pendingTokens.every((token) => token.status === 'reclaimed')
	const settlementStatus = getAuctionSettlementStatus(settlementEvent)
	const winningBidId = getAuctionSettlementWinningBid(settlementEvent)
	const winnerPubkey = getAuctionSettlementWinner(settlementEvent)

	if (winningBidId === group.latestBid.id && winnerPubkey === userPubkey) {
		return {
			label: 'Winning bid',
			helper: 'This bid won the auction and should settle to the seller.',
			toneClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
			reclaimableTokens: [],
		}
	}

	if (allClaimed) {
		return {
			label: 'Refund received',
			helper: 'The seller settlement refund has already been claimed into your wallet.',
			toneClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
			reclaimableTokens: [],
		}
	}

	if (allReclaimed) {
		return {
			label: 'Reclaimed',
			helper: 'You reclaimed this locked bid chain back into your wallet after locktime.',
			toneClass: 'border-sky-200 bg-sky-50 text-sky-700',
			reclaimableTokens: [],
		}
	}

	if (reclaimableTokens.length > 0) {
		return {
			label: 'Reclaim available',
			helper: `${reclaimableTokens.length} locked bid ${reclaimableTokens.length === 1 ? 'leg is' : 'legs are'} past locktime and can be reclaimed now.`,
			toneClass: 'border-amber-200 bg-amber-50 text-amber-700',
			reclaimableTokens,
		}
	}

	if (settlementStatus === 'settled') {
		return {
			label: 'Outbid',
			helper:
				trackedTokens > 0
					? 'Your bid stays timelocked until reclaim opens after locktime.'
					: 'This device has no tracked reclaim token for the bid chain.',
			toneClass: 'border-zinc-200 bg-zinc-50 text-zinc-700',
			reclaimableTokens: [],
		}
	}

	if (settlementStatus === 'reserve_not_met') {
		return {
			label: 'Reserve not met',
			helper:
				trackedTokens > 0
					? 'Reclaim opens automatically after the bid locktime.'
					: 'This device has no tracked reclaim token for the bid chain.',
			toneClass: 'border-violet-200 bg-violet-50 text-violet-700',
			reclaimableTokens: [],
		}
	}

	if (settlementStatus === 'cancelled') {
		return {
			label: 'Auction cancelled',
			helper:
				trackedTokens > 0
					? 'Reclaim opens automatically after the bid locktime.'
					: 'This device has no tracked reclaim token for the bid chain.',
			toneClass: 'border-rose-200 bg-rose-50 text-rose-700',
			reclaimableTokens: [],
		}
	}

	const latestLocktime = group.pendingTokens.reduce(
		(max, token) => Math.max(max, getPendingTokenLocktime(token)),
		getBidLocktime(group.latestBid),
	)
	if (latestLocktime > now) {
		return {
			label: 'Locked',
			helper: `No settlement refund yet. Manual reclaim opens after ${formatMaybeDate(latestLocktime)}.`,
			toneClass: 'border-blue-200 bg-blue-50 text-blue-700',
			reclaimableTokens: [],
		}
	}

	return {
		label: 'Bid recorded',
		helper:
			trackedTokens > 0
				? 'Waiting for settlement or for locktime reclaim to open.'
				: 'This device is missing the local reclaim token for this bid.',
		toneClass: 'border-zinc-200 bg-zinc-50 text-zinc-700',
		reclaimableTokens: [],
	}
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/bids')({
	component: BidsOverviewComponent,
})

function BidsOverviewComponent() {
	useDashboardTitle('Bids')

	const { user, isAuthenticated } = useStore(authStore)
	const { pendingTokens } = useStore(nip60Store)
	const [expandedBidGroup, setExpandedBidGroup] = useState<string | null>(null)
	const [reclaimingGroup, setReclaimingGroup] = useState<string | null>(null)
	const [isRefreshingBids, setIsRefreshingBids] = useState(false)
	const [claimDialogGroup, setClaimDialogGroup] = useState<string | null>(null)
	const [animationParent] = useAutoAnimate()

	const { data: myBids, isLoading, error } = useAuctionBidsByBidder(user?.pubkey ?? '', 500)

	const bidGroups = useMemo(() => {
		const auctionBidTokens = getPendingAuctionBidTokens(pendingTokens)
		const groups = new Map<string, BidGroup>()

		for (const bid of myBids ?? []) {
			const auctionEventId = getBidAuctionEventId(bid)
			if (!auctionEventId) continue

			const auctionCoordinates = getBidAuctionCoordinates(bid) || undefined
			const key = `${auctionEventId}:${auctionCoordinates || ''}`
			const existing = groups.get(key)
			if (existing) {
				existing.bids.push(bid)
				continue
			}

			groups.set(key, {
				key,
				auctionEventId,
				auctionCoordinates,
				sellerPubkey: getBidSellerPubkey(bid),
				latestBid: bid,
				bids: [bid],
				pendingTokens: [],
			})
		}

		for (const group of groups.values()) {
			group.latestBid = getLatestBidForGroup(group.bids)
			group.pendingTokens = auctionBidTokens
				.filter((token) => {
					const context = token.context
					if (context?.kind !== 'auction_bid') return false
					if (context.auctionEventId === group.auctionEventId) return true
					return !!group.auctionCoordinates && context.auctionCoordinates === group.auctionCoordinates
				})
				.sort((a, b) => b.createdAt - a.createdAt)
		}

		return Array.from(groups.values()).sort((a, b) => {
			const createdAtDelta = (b.latestBid.created_at || 0) - (a.latestBid.created_at || 0)
			if (createdAtDelta !== 0) return createdAtDelta
			return getBidAmount(b.latestBid) - getBidAmount(a.latestBid)
		})
	}, [myBids, pendingTokens])

	const auctionResults = useQueries({
		queries: bidGroups.map((group) => ({
			...auctionQueryOptions(group.auctionEventId),
			staleTime: 300000,
		})),
	})

	const settlementResults = useQueries({
		queries: bidGroups.map((group) => ({
			...auctionSettlementsQueryOptions(group.auctionEventId, 20),
			refetchInterval: 5000,
		})),
	})

	// Claim orders for won auctions — fetched by auction coordinates
	const claimOrderResults = useQueries({
		queries: bidGroups.map((group) => {
			const coordinates = group.auctionCoordinates || ''
			return {
				...auctionClaimOrdersQueryOptions(coordinates),
				enabled: !!coordinates,
			}
		}),
	})

	const handleRefreshBidStatuses = async () => {
		setIsRefreshingBids(true)
		try {
			await nip60Actions.refresh()
		} finally {
			setIsRefreshingBids(false)
		}
	}

	const handleReclaimBidGroup = async (group: BidGroup, reclaimableTokens: PendingNip60Token[]) => {
		if (reclaimableTokens.length === 0) return

		setReclaimingGroup(group.key)
		try {
			let reclaimedCount = 0
			for (const token of reclaimableTokens) {
				const success = await nip60Actions.reclaimToken(token.id)
				if (success) reclaimedCount += 1
			}

			if (reclaimedCount > 0) {
				const groupIndex = bidGroups.findIndex((item) => item.key === group.key)
				const auctionTitle = getAuctionTitle(auctionResults[groupIndex]?.data ?? null) || 'auction'
				toast.success(`Reclaimed ${reclaimedCount} bid ${reclaimedCount === 1 ? 'leg' : 'legs'} for ${auctionTitle}`)
			} else {
				toast.error('No bid legs could be reclaimed')
			}
		} catch (reclaimError) {
			console.error('Failed to reclaim bid group:', reclaimError)
			toast.error(reclaimError instanceof Error ? reclaimError.message : 'Failed to reclaim bid')
		} finally {
			setReclaimingGroup(null)
		}
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your bids.</p>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold">Bids</h1>
					<p className="text-sm text-muted-foreground">Bids stay locked until settlement or until reclaim opens at the bid locktime.</p>
				</div>
				<Button variant="outline" size="sm" className="gap-2" onClick={handleRefreshBidStatuses} disabled={isRefreshingBids}>
					{isRefreshingBids ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
					Refresh Refunds
				</Button>
			</div>

			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden space-y-3">
					<p className="text-sm text-muted-foreground">Bids stay locked until settlement or until reclaim opens at the bid locktime.</p>
					<Button variant="outline" className="w-full gap-2" onClick={handleRefreshBidStatuses} disabled={isRefreshingBids}>
						{isRefreshingBids ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
						Refresh Refunds
					</Button>
				</div>

				{isLoading && (
					<div className="text-center py-8 text-gray-500">
						<Clock className="animate-spin h-6 w-6 mx-auto mb-2" />
						Loading bids...
					</div>
				)}

				{error && (
					<div className="text-center py-8 text-red-500">
						Failed to load your bids: {error instanceof Error ? error.message : 'Unknown error'}
					</div>
				)}

				{!isLoading && !error && bidGroups.length === 0 && (
					<div className="text-center py-10 border rounded-lg bg-white">
						<Trophy className="h-10 w-10 mx-auto mb-3 text-gray-400" />
						<h3 className="text-lg font-medium mb-1">No bids yet</h3>
						<p className="text-muted-foreground">Bid on an auction and it will show up here with refund and reclaim status.</p>
					</div>
				)}

				{!isLoading && !error && bidGroups.length > 0 && (
					<ul ref={animationParent} className="flex flex-col gap-4">
						{bidGroups.map((group, index) => {
							const auction = auctionResults[index]?.data ?? null
							const settlement = settlementResults[index]?.data?.[0] ?? null
							const now = Math.floor(Date.now() / 1000)
							const state = getBidGroupState(group, settlement, user.pubkey, now)
							const totalTrackedAmount = group.pendingTokens.reduce((sum, token) => sum + token.amount, 0)
							const claimedCount = group.pendingTokens.filter((token) => token.status === 'claimed').length
							const reclaimedCount = group.pendingTokens.filter((token) => token.status === 'reclaimed').length
							const pendingCount = group.pendingTokens.filter((token) => token.status === 'pending').length
							const latestBidAmount = getBidAmount(group.latestBid)
							const latestLocktime = group.pendingTokens.reduce(
								(max, token) => Math.max(max, getPendingTokenLocktime(token)),
								getBidLocktime(group.latestBid),
							)
							const mintLabel = getMintHostname(getBidMint(group.latestBid) || group.pendingTokens[0]?.mintUrl || '') || 'Unknown mint'

							// Fulfilment state for winning bids
							const isWinningBid = state.label === 'Winning bid'
							const claimOrders = claimOrderResults[index]?.data ?? []
							const myClaimOrder = claimOrders.find((o) => o.pubkey === user.pubkey)
							const hasClaimed = !!myClaimOrder

							return (
								<li key={group.key}>
									<DashboardListItem
										isOpen={expandedBidGroup === group.key}
										onOpenChange={() => setExpandedBidGroup((prev) => (prev === group.key ? null : group.key))}
										icon={false}
										triggerContent={
											<div className="flex items-center gap-3">
												<div className="min-w-0 flex-1">
													<p className="font-semibold truncate">
														{getAuctionTitle(auction) || `Auction ${shortenBidRef(group.auctionEventId)}`}
													</p>
													<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
														<span>Your bid: {latestBidAmount.toLocaleString()} sats</span>
														<span>Mint: {mintLabel}</span>
														{auction && (
															<AuctionCountdown
																endAt={getAuctionEndAt(auction)}
																showSeconds
																variant="inline"
																className="px-2 py-1 text-[10px]"
															/>
														)}
													</div>
												</div>
												<div className="flex flex-wrap items-center gap-1.5 shrink-0">
													<span
														className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${state.toneClass}`}
													>
														{state.label}
													</span>
													{isWinningBid && (
														<Badge
															variant="outline"
															className={
																hasClaimed
																	? 'border-emerald-200 bg-emerald-50 text-emerald-700'
																	: 'border-amber-200 bg-amber-50 text-amber-700'
															}
														>
															{hasClaimed ? (
																<>
																	<CheckCircle className="mr-1 h-3 w-3" /> Claimed
																</>
															) : (
																<>
																	<MapPin className="mr-1 h-3 w-3" /> Address needed
																</>
															)}
														</Badge>
													)}
												</div>
											</div>
										}
										actions={
											<Button
												variant="ghost"
												size="sm"
												onClick={(e) => {
													e.stopPropagation()
													void handleReclaimBidGroup(group, state.reclaimableTokens)
												}}
												disabled={state.reclaimableTokens.length === 0 || reclaimingGroup === group.key}
												aria-label={`Reclaim bid for ${getAuctionTitle(auction) || 'auction'}`}
											>
												{reclaimingGroup === group.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
											</Button>
										}
									>
										<div className="space-y-4">
											<div className={`rounded-lg border px-3 py-2 text-sm ${state.toneClass}`}>
												<p className="font-semibold">{state.label}</p>
												<p className="mt-1 text-xs">{state.helper}</p>
											</div>

											<div className="grid grid-cols-2 gap-3 text-sm">
												<p className="text-gray-600">
													Latest bid: <span className="font-medium text-foreground">{latestBidAmount.toLocaleString()} sats</span>
												</p>
												<p className="text-gray-600">
													Tracked collateral:{' '}
													<span className="font-medium text-foreground">{totalTrackedAmount.toLocaleString()} sats</span>
												</p>
												<p className="text-gray-600">
													Pending legs: <span className="font-medium text-foreground">{pendingCount}</span>
												</p>
												<p className="text-gray-600">
													Claimed/refunded: <span className="font-medium text-foreground">{claimedCount}</span>
												</p>
												<p className="text-gray-600">
													Reclaimed manually: <span className="font-medium text-foreground">{reclaimedCount}</span>
												</p>
												<p className="text-gray-600">
													Locktime:{' '}
													<span className="font-medium text-foreground">{latestLocktime ? formatMaybeDate(latestLocktime) : 'N/A'}</span>
												</p>
												<p className="text-gray-600 col-span-2">
													Seller: <span className="font-medium text-foreground">{shortenBidRef(group.sellerPubkey)}</span>
												</p>
												<p className="text-gray-600 col-span-2">
													Bid event: <span className="font-medium text-foreground break-all">{group.latestBid.id}</span>
												</p>
											</div>

											{settlement && (
												<div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm space-y-1">
													<p className="font-semibold">Settlement</p>
													<p className="text-gray-600">
														Status: <span className="font-medium text-foreground">{getAuctionSettlementStatus(settlement)}</span>
													</p>
													<p className="text-gray-600">
														Final amount:{' '}
														<span className="font-medium text-foreground">
															{getAuctionSettlementFinalAmount(settlement).toLocaleString()} sats
														</span>
													</p>
													<p className="text-gray-600 break-all">
														Winner: <span className="font-medium text-foreground">{getAuctionSettlementWinner(settlement) || 'None'}</span>
													</p>
												</div>
											)}

											{/* Fulfilment section for winning bids */}
											{isWinningBid && settlement && (
												<div
													className={`rounded-lg border px-3 py-3 text-sm ${hasClaimed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
												>
													<p className="font-semibold flex items-center gap-2">
														{hasClaimed ? (
															<>
																<CheckCircle className="h-4 w-4 text-emerald-600" /> Shipping details submitted
															</>
														) : (
															<>
																<MapPin className="h-4 w-4 text-amber-600" /> Shipping address required
															</>
														)}
													</p>
													{hasClaimed ? (
														<p className="mt-1 text-xs text-emerald-700">
															Your address has been sent to the seller. Track order progress on the auction page.
														</p>
													) : (
														<div className="mt-2">
															<p className="text-xs text-amber-700 mb-2">
																Submit your shipping address so the seller can send you the item.
															</p>
															<Button size="sm" onClick={() => setClaimDialogGroup(group.key)}>
																Submit Shipping Address
															</Button>
														</div>
													)}
												</div>
											)}

											<div className="flex flex-wrap items-center gap-2">
												<Link to={`/auctions/${group.auctionEventId}`}>
													<Button variant="outline" size="sm" className="gap-2">
														<ExternalLink className="w-3.5 h-3.5" />
														View Auction
													</Button>
												</Link>
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														navigator.clipboard
															.writeText(group.latestBid.id)
															.then(() => toast.success('Bid event ID copied'))
															.catch(() => toast.error('Failed to copy bid event ID'))
													}
												>
													Copy Bid ID
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														navigator.clipboard
															.writeText(group.auctionEventId)
															.then(() => toast.success('Auction event ID copied'))
															.catch(() => toast.error('Failed to copy auction event ID'))
													}
												>
													Copy Auction ID
												</Button>
												<Button
													variant="outline"
													size="sm"
													className="gap-2"
													onClick={() => void handleReclaimBidGroup(group, state.reclaimableTokens)}
													disabled={state.reclaimableTokens.length === 0 || reclaimingGroup === group.key}
												>
													{reclaimingGroup === group.key ? (
														<Loader2 className="w-3.5 h-3.5 animate-spin" />
													) : (
														<RotateCcw className="w-3.5 h-3.5" />
													)}
													Reclaim Eligible Legs
												</Button>
											</div>
										</div>
									</DashboardListItem>
								</li>
							)
						})}
					</ul>
				)}
			</div>

			{/* Claim dialog for winning bids — rendered once, driven by claimDialogGroup state */}
			{(() => {
				if (!claimDialogGroup) return null
				const groupIndex = bidGroups.findIndex((g) => g.key === claimDialogGroup)
				if (groupIndex === -1) return null
				const group = bidGroups[groupIndex]
				const auction = auctionResults[groupIndex]?.data ?? null
				const settlement = settlementResults[groupIndex]?.data?.[0] ?? null
				if (!auction || !settlement) return null

				const dTag = getAuctionId(auction)
				const coordinates = dTag ? `30408:${auction.pubkey}:${dTag}` : group.auctionCoordinates || ''

				return (
					<AuctionClaimDialog
						open
						onOpenChange={(open) => {
							if (!open) setClaimDialogGroup(null)
						}}
						auctionEventId={group.auctionEventId}
						auctionCoordinates={coordinates}
						settlementEventId={settlement.id}
						sellerPubkey={group.sellerPubkey}
						finalAmount={getAuctionSettlementFinalAmount(settlement)}
					/>
				)
			})()}
		</div>
	)
}
