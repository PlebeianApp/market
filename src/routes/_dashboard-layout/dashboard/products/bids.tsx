import { AuctionCountdown } from '@/components/AuctionCountdown'
import { AvatarUser } from '@/components/AvatarUser'
import { ProfileName } from '@/components/ProfileName'
import { DashboardListItem } from '@ui/components/DashboardListItem'
import { BidStatusBanner, BidStatusPill, getBidStatusCopy } from '@ui/components/BidStatusViews'
import { resolveBidGroupStatus } from '@sdk/commerce/auctions/bidGroupStatus'
import { Badge } from '@ui/primitives/badge'
import { Button } from '@ui/primitives/button'
import { authStore } from '@/lib/stores/auth'
import { notificationActions } from '@/lib/stores/notifications'
import { formatReclaimWaitSeconds, getAuctionReclaimReadyAt, nip60Actions, nip60Store, type PendingNip60Token } from '@/lib/stores/nip60'
import { getMintHostname } from '@/lib/wallet'
import {
	auctionClaimOrdersQueryOptions,
	auctionQueryOptions,
	auctionSettlementsQueryOptions,
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
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { useQueries } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { CheckCircle, Clock, Eye, Loader2, MapPin, RotateCcw, Trophy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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

const getPendingAuctionBidTokens = (tokens: PendingNip60Token[]): PendingNip60Token[] =>
	tokens.filter((token) => token.context?.kind === 'auction_bid')

/**
 * Earliest timestamp at which this pending bid token can actually be reclaimed,
 * accounting for both the authoritative proof-secret locktime and the ~30s
 * skew buffer applied inside the wallet's reclaim path. Using the same helper
 * here keeps the "Reclaim available" banner consistent with the reclaim gate
 * (so users don't see "Reclaim available" and then "Bid refund opens in …").
 */
const getPendingTokenReclaimReadyAt = (token: PendingNip60Token): number => getAuctionReclaimReadyAt(token.token, token.context?.locktime)

const getLatestBidForGroup = (bids: NDKEvent[]): NDKEvent =>
	[...bids].sort((a, b) => {
		const amountDelta = getBidAmount(b) - getBidAmount(a)
		if (amountDelta !== 0) return amountDelta
		const createdAtDelta = (b.created_at || 0) - (a.created_at || 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return b.id.localeCompare(a.id)
	})[0]

const getBidGroupState = (group: BidGroup, settlementEvent: NDKEvent | null, userPubkey: string, now: number) =>
	resolveBidGroupStatus<PendingNip60Token>({
		latestBidId: group.latestBid.id,
		latestBidLocktime: getBidLocktime(group.latestBid),
		tokens: group.pendingTokens.map((token) => ({
			token,
			status: token.status,
			reclaimReadyAt: getPendingTokenReclaimReadyAt(token),
			locktime: token.context?.locktime ?? 0,
		})),
		settlement: settlementEvent
			? {
					status: getAuctionSettlementStatus(settlementEvent) ?? null,
					winningBidId: getAuctionSettlementWinningBid(settlementEvent) ?? null,
					winnerPubkey: getAuctionSettlementWinner(settlementEvent) ?? null,
				}
			: null,
		userPubkey,
		now,
	})

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
	// Ticks every second so reclaim countdowns and the "Locked → Reclaim
	// available" state transition update without a page refresh.
	const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000))
	useEffect(() => {
		const id = window.setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 1000)
		return () => window.clearInterval(id)
	}, [])
	const [animationParent] = useAutoAnimate()

	const { data: myBids, isLoading, error } = useAuctionBidsByBidder(user?.pubkey ?? '', 500)

	useEffect(() => {
		if (isAuthenticated && user?.pubkey) {
			notificationActions.markBidUpdatesSeen()
		}
	}, [isAuthenticated, user?.pubkey])

	// Pending tokens are kept in localStorage scoped to the bidder's pubkey, so
	// they survive relay resets. When a lock succeeds at the mint but the
	// subsequent bid-event publish fails (rate-limit storm, network blip, or
	// the wallet is later recreated by dev seed), the token stays here as an
	// orphan — it points at a bid event the relay doesn't have, and often at
	// a refund privkey the current wallet doesn't hold. We split pendingTokens
	// into tokens attached to relay-visible bid events and orphaned local
	// custody records. Orphaned records are preserved because they may be the
	// only local evidence available for recovery/debugging.
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

		for (const group of Array.from(groups.values())) {
			group.latestBid = getLatestBidForGroup(group.bids)
			const groupBidIds = new Set(group.bids.map((bid: NDKEvent) => bid.id))
			group.pendingTokens = auctionBidTokens
				.filter((token) => {
					const context = token.context
					if (context?.kind !== 'auction_bid') return false
					// Only attach tokens backed by a bid event that actually
					// landed in this group. Tokens whose bidEventId we've
					// never seen are orphans (lock succeeded, publish
					// didn't) and belong in the stale bucket instead.
					if (!context.bidEventId || !groupBidIds.has(context.bidEventId)) return false
					return true
				})
				.sort((a, b) => b.createdAt - a.createdAt)
		}

		return Array.from(groups.values()).sort((a, b) => {
			const createdAtDelta = (b.latestBid.created_at || 0) - (a.latestBid.created_at || 0)
			if (createdAtDelta !== 0) return createdAtDelta
			return getBidAmount(b.latestBid) - getBidAmount(a.latestBid)
		})
	}, [myBids, pendingTokens])

	const orphanedTokens = useMemo(() => {
		const liveBidEventIds = new Set((myBids ?? []).map((bid) => bid.id))
		return getPendingAuctionBidTokens(pendingTokens).filter((token) => {
			const context = token.context
			if (context?.kind !== 'auction_bid') return false
			if (!context.bidEventId) return true
			return !liveBidEventIds.has(context.bidEventId)
		})
	}, [myBids, pendingTokens])

	const orphanedAmount = orphanedTokens.reduce((sum, token) => sum + token.amount, 0)

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
			await nip60Actions.refresh({ consolidate: true })
		} finally {
			setIsRefreshingBids(false)
		}
	}

	const handleReclaimBidGroup = async (group: BidGroup, reclaimableTokens: PendingNip60Token[]) => {
		if (reclaimableTokens.length === 0) return

		setReclaimingGroup(group.key)
		let reclaimedCount = 0
		const failures: string[] = []
		try {
			for (const token of reclaimableTokens) {
				try {
					// manual:true lets the user override the auto-reclaim
					// "permanently failed" flag in case they want to retry a
					// token the sweeper has given up on.
					await nip60Actions.reclaimToken(token.id, { manual: true })
					reclaimedCount += 1
				} catch (legError) {
					const message = legError instanceof Error ? legError.message : String(legError)
					console.error(`Failed to reclaim bid leg ${token.id}:`, legError)
					failures.push(message)
				}
			}

			const groupIndex = bidGroups.findIndex((item) => item.key === group.key)
			const auctionTitle = getAuctionTitle(auctionResults[groupIndex]?.data ?? null) || 'auction'

			if (reclaimedCount > 0) {
				toast.success(`Reclaimed ${reclaimedCount} locked bid ${reclaimedCount === 1 ? 'part' : 'parts'} for ${auctionTitle}`)
			}
			if (failures.length > 0) {
				toast.error(failures[0])
			}
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
					Refresh wallet state
				</Button>
			</div>

			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden space-y-3">
					<p className="text-sm text-muted-foreground">Bids stay locked until settlement or until reclaim opens at the bid locktime.</p>
					<Button variant="outline" className="w-full gap-2" onClick={handleRefreshBidStatuses} disabled={isRefreshingBids}>
						{isRefreshingBids ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
						Refresh wallet state
					</Button>
				</div>

				{orphanedTokens.length > 0 && (
					<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
						<p className="font-semibold">
							{orphanedTokens.length} orphaned lock {orphanedTokens.length === 1 ? 'attempt' : 'attempts'} tracked locally (
							{orphanedAmount.toLocaleString()} sats)
						</p>
						<p className="mt-1 text-xs leading-relaxed">
							These are lock attempts whose bid event never made it to the relay — usually from a failed bid during a rate-limit storm, or
							from a wallet that was since recreated. Keep these local bid lock records until all auction bids are settled or reclaimed;
							they may be needed to recover funds or diagnose a failed bid. Do not clear browser storage, local wallet data, or local
							auction bid records while locked bid funds may still be recoverable.
						</p>
						<Button variant="outline" size="sm" className="mt-2 gap-2" onClick={handleRefreshBidStatuses} disabled={isRefreshingBids}>
							{isRefreshingBids ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
							Refresh wallet state
						</Button>
					</div>
				)}

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
							const now = nowTick
							const state = getBidGroupState(group, settlement, user.pubkey, now)
							const copy = getBidStatusCopy({
								status: state.status,
								reclaimableCount: state.reclaimable.length,
								waitingForReclaim: state.waitingForReclaim,
								hasTrackedTokens: state.hasTrackedTokens,
								latestLocktime: state.latestLocktime,
								reclaimCountdownLabel: `Reclaim opens in ${formatReclaimWaitSeconds(state.reclaimReadyAt - now)}`,
							})
							const totalTrackedAmount = group.pendingTokens.reduce((sum, token) => sum + token.amount, 0)
							const latestBidAmount = getBidAmount(group.latestBid)
							const mintLabel = getMintHostname(getBidMint(group.latestBid) || group.pendingTokens[0]?.mintUrl || '') || 'Unknown mint'

							const isWinningBid = state.status === 'winning'
							const claimOrders = claimOrderResults[index]?.data ?? []
							const myClaimOrder = claimOrders.find((o) => o.pubkey === user.pubkey)
							const hasClaimed = !!myClaimOrder

							// Bid parts: every bid this user placed on this auction, in
							// chronological order. The "headline" bid amount lives on the
							// most recent part; earlier parts are the rebid chain.
							const bidParts = [...group.bids].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))

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
														{getAuctionTitle(auction) || `Auction ${group.auctionEventId.slice(0, 10)}…`}
													</p>
													<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
														<span>Your bid: {latestBidAmount.toLocaleString()} sats</span>
														<span>Mint: {mintLabel}</span>
														{auction && <AuctionCountdown auction={auction} />}
													</div>
												</div>
												<div className="flex flex-wrap items-center gap-1.5 shrink-0">
													<BidStatusPill copy={copy} />
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
											<>
												<Link
													to="/dashboard/products/auctions/$auctionId"
													params={{ auctionId: group.auctionEventId }}
													onClick={(e) => e.stopPropagation()}
													aria-label={`Open auction route for ${getAuctionTitle(auction) || 'auction'}`}
												>
													<Button variant="ghost" size="sm">
														<Eye className="w-4 h-4" />
													</Button>
												</Link>
												<Button
													variant="ghost"
													size="sm"
													onClick={(e) => {
														e.stopPropagation()
														void handleReclaimBidGroup(group, state.reclaimable)
													}}
													disabled={state.reclaimable.length === 0 || reclaimingGroup === group.key}
													aria-label={`Reclaim bid for ${getAuctionTitle(auction) || 'auction'}`}
												>
													{reclaimingGroup === group.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
												</Button>
											</>
										}
									>
										<div className="space-y-4 p-4 bg-gray-50 border-t">
											{/* Status banner with countdown if applicable */}
											<BidStatusBanner copy={copy} />

											{/* Compact auction info — full detail lives on the auction route */}
											<div className="grid grid-cols-2 gap-3 text-sm">
												<p className="text-gray-600">
													Latest bid: <span className="font-medium text-foreground">{latestBidAmount.toLocaleString()} sats</span>
												</p>
												<p className="text-gray-600">
													Locked collateral: <span className="font-medium text-foreground">{totalTrackedAmount.toLocaleString()} sats</span>
												</p>
												<div className="text-gray-600 col-span-2 flex items-center gap-2">
													<span>Seller:</span>
													<AvatarUser pubkey={group.sellerPubkey} colored className="h-5 w-5" />
													<ProfileName pubkey={group.sellerPubkey} className="font-medium text-foreground" />
												</div>
											</div>

											{/* Bid chain — every relay-visible bid this user placed on this auction */}
											<div className="rounded-md border bg-white">
												<div className="px-3 py-2 border-b">
													<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
														Your locked bid parts ({bidParts.length})
													</p>
													<p className="mt-0.5 text-[11px] text-gray-500">
														Each part is a Cashu lock from one of your bids or rebids on this auction. The chain settles together.
													</p>
												</div>
												<ul className="divide-y">
													{bidParts.map((bidPart, i) => {
														const partAmount = getBidAmount(bidPart)
														const partLocktime = getBidLocktime(bidPart)
														const createdAt = bidPart.created_at ? new Date(bidPart.created_at * 1000).toLocaleString() : 'N/A'
														const matchingPending = group.pendingTokens.find((t) => t.context?.bidEventId === bidPart.id)
														return (
															<li key={bidPart.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-xs">
																<div className="min-w-0">
																	<p className="font-semibold text-zinc-900">
																		Part {i + 1}
																		{i === bidParts.length - 1 ? ' (latest)' : ''} — {partAmount.toLocaleString()} sats
																	</p>
																	<p className="mt-0.5 text-zinc-500">{createdAt}</p>
																	{partLocktime > 0 && <p className="text-zinc-500">Locktime: {formatMaybeDate(partLocktime)}</p>}
																</div>
																<div className="flex flex-col items-end text-right">
																	{matchingPending ? (
																		<span
																			className={`text-[10px] font-medium ${
																				matchingPending.status === 'reclaimed'
																					? 'text-sky-700'
																					: matchingPending.status === 'claimed'
																						? 'text-emerald-700'
																						: 'text-blue-700'
																			}`}
																		>
																			{matchingPending.status}
																		</span>
																	) : (
																		<span className="text-[10px] text-zinc-400">no local lock</span>
																	)}
																</div>
															</li>
														)
													})}
												</ul>
											</div>

											{/* Action footer — primary action is "open the auction route" where
											    settlement / shipping / fulfilment all live. */}
											<div className="flex flex-wrap items-center gap-2">
												<Link to="/dashboard/products/auctions/$auctionId" params={{ auctionId: group.auctionEventId }}>
													<Button variant="default" size="sm" className="gap-2">
														<Eye className="w-3.5 h-3.5" />
														Open Auction
													</Button>
												</Link>
												<Button
													variant="outline"
													size="sm"
													className="gap-2"
													onClick={() => void handleReclaimBidGroup(group, state.reclaimable)}
													disabled={state.reclaimable.length === 0 || reclaimingGroup === group.key}
												>
													{reclaimingGroup === group.key ? (
														<Loader2 className="w-3.5 h-3.5 animate-spin" />
													) : (
														<RotateCcw className="w-3.5 h-3.5" />
													)}
													Reclaim eligible parts
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
		</div>
	)
}
