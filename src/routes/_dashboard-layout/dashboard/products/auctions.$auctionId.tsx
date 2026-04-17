import { AuctionCountdown, useAuctionCountdown } from '@/components/AuctionCountdown'
import { AvatarUser } from '@/components/AvatarUser'
import { OrderActions } from '@/components/orders/OrderActions'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { authStore } from '@/lib/stores/auth'
import { getAuctionWindowValidBids } from '@/lib/auctionSettlement'
import { usePublishAuctionSettlementMutation } from '@/publish/auctions'
import {
	auctionQueryOptions,
	getAuctionBidCountFromBids,
	getAuctionBidIncrement,
	getAuctionCurrentPriceFromBids,
	getAuctionCurrency,
	getAuctionEffectiveEndAt,
	getAuctionEndAt,
	getAuctionPathIssuer,
	getAuctionId,
	getAuctionImages,
	getAuctionKeyScheme,
	getAuctionMaxEndAt,
	getAuctionMints,
	getAuctionP2pkXpub,
	getAuctionReserve,
	getAuctionRootEventId,
	getAuctionSchema,
	getAuctionSettlementFinalAmount,
	getAuctionSettlementPolicy,
	getAuctionSettlementStatus,
	getAuctionSettlementWinner,
	getAuctionSettlementWinningBid,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionSummary,
	getAuctionTitle,
	getAuctionType,
	getBidAmount,
	getBidMint,
	getBidStatus,
	useAuctionBids,
	useAuctionClaimOrders,
	useAuctionSettlements,
} from '@/queries/auctions'
import { type OrderWithRelatedEvents, useOrderById } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Clock, Copy, ExternalLink, Gavel, Package, Shield } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'

const AUCTION_STATUS_STYLES: Record<string, string> = {
	Live: 'border-emerald-200 bg-emerald-50 text-emerald-800',
	Scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
	Ended: 'border-zinc-200 bg-zinc-100 text-zinc-700',
}

const SETTLEMENT_STATUS_STYLES: Record<string, string> = {
	settled: 'border-emerald-200 bg-emerald-50 text-emerald-800',
	reserve_not_met: 'border-amber-200 bg-amber-50 text-amber-800',
	cancelled: 'border-rose-200 bg-rose-50 text-rose-800',
	unknown: 'border-zinc-200 bg-zinc-100 text-zinc-700',
}

function formatAuctionStatus(startAt: number, endAt: number, now: number): string {
	if (endAt > 0 && now >= endAt) return 'Ended'
	if (startAt > 0 && now < startAt) return 'Scheduled'
	return 'Live'
}

function formatMaybeDate(timestamp: number): string {
	if (!timestamp) return 'N/A'
	return new Date(timestamp * 1000).toLocaleString()
}

function formatSats(value: number): string {
	return `${value.toLocaleString()} sats`
}

async function copyText(label: string, value: string) {
	try {
		await navigator.clipboard.writeText(value)
		toast.success(`${label} copied`)
	} catch (error) {
		console.error(`Failed to copy ${label.toLowerCase()}:`, error)
		toast.error(`Failed to copy ${label.toLowerCase()}`)
	}
}

function StatCard({ label, value, eyebrow }: { label: string; value: string; eyebrow?: string }) {
	return (
		<div className="rounded-xl border border-black/10 bg-white/85 p-4 shadow-sm">
			{eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{eyebrow}</p>}
			<p className="mt-1 text-sm text-zinc-500">{label}</p>
			<p className="mt-2 text-lg font-semibold text-zinc-950">{value}</p>
		</div>
	)
}

function OverviewItem({ label, value, helper }: { label: string; value: string; helper?: string }) {
	return (
		<div className="rounded-xl border border-zinc-200 bg-white p-4">
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
			<p className="mt-2 text-sm font-medium text-zinc-950">{value}</p>
			{helper && <p className="mt-1 text-xs text-zinc-500">{helper}</p>}
		</div>
	)
}

function TechnicalRow({
	label,
	value,
	copyValue,
	stacked = false,
}: {
	label: string
	value: string
	copyValue?: string
	stacked?: boolean
}) {
	return (
		<div
			className={`rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 ${stacked ? 'space-y-2' : 'flex items-start justify-between gap-3'}`}
		>
			<div className="min-w-0">
				<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
				<p className={`mt-1 text-sm font-medium text-zinc-950 ${stacked ? 'whitespace-pre-wrap break-words' : 'break-all'}`}>
					{value || 'N/A'}
				</p>
			</div>
			{copyValue && (
				<Button
					variant="ghost"
					size="sm"
					className="h-8 shrink-0 px-2 text-zinc-500 hover:text-zinc-950"
					onClick={() => void copyText(label, copyValue)}
				>
					<Copy className="h-4 w-4" />
				</Button>
			)}
		</div>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/auctions/$auctionId')({
	component: DashboardAuctionDetailRoute,
})

function DashboardAuctionDetailRoute() {
	const { auctionId } = Route.useParams()
	useDashboardTitle('Auction Details')
	const { user } = useStore(authStore)

	const auctionQuery = useQuery({
		...auctionQueryOptions(auctionId),
		retry: (failureCount) => failureCount < 10,
	})
	const auction = auctionQuery.data ?? null

	const auctionCoordinates = useMemo(() => {
		if (!auction) return ''
		const dTag = getAuctionId(auction)
		return dTag ? `30408:${auction.pubkey}:${dTag}` : ''
	}, [auction])
	const auctionRootEventId = getAuctionRootEventId(auction)

	const startingBid = getAuctionStartingBid(auction)
	const reserve = getAuctionReserve(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const startAt = getAuctionStartAt(auction)
	const endAt = getAuctionEndAt(auction)
	const isOwner = !!(auction && user?.pubkey && auction.pubkey === user.pubkey)
	const auctionType = getAuctionType(auction)
	const currency = getAuctionCurrency(auction)
	const trustedMints = getAuctionMints(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const summary = getAuctionSummary(auction) || auction?.content || 'No summary provided yet.'
	const previewImage = getAuctionImages(auction)[0]?.[1]

	const bidsQuery = useAuctionBids(auctionRootEventId || auctionId, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const effectiveEndAt = getAuctionEffectiveEndAt(auction, bids) || endAt
	const countdown = useAuctionCountdown(effectiveEndAt, { showSeconds: true })
	const now = countdown.now
	const status = formatAuctionStatus(startAt, effectiveEndAt, now)
	const ended = status === 'Ended'
	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const bidCount = getAuctionBidCountFromBids(auction, bids)

	const settlementsQuery = useAuctionSettlements(auctionRootEventId || auctionId, 100, auctionCoordinates)
	const settlements = settlementsQuery.data ?? []
	const latestSettlement = settlements[0] || null
	const settlementMutation = usePublishAuctionSettlementMutation()

	const topBid = useMemo(() => {
		const validBids = auction ? getAuctionWindowValidBids(auction, bids) : bids
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
	}, [auction, bids])

	const bidsByNewest = useMemo(() => [...bids].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)), [bids])

	const reserveMet = !!topBid && getBidAmount(topBid) >= reserve
	const settlementLocked = !!latestSettlement
	const latestSettlementStatus = latestSettlement ? getAuctionSettlementStatus(latestSettlement) : 'unknown'
	const reserveLabel = bidCount === 0 ? 'Waiting for bids' : reserveMet ? 'Reserve met' : 'Below reserve'

	// Auction claim order (winner's shipping details)
	const settlementWinner = getAuctionSettlementWinner(latestSettlement)
	const claimOrdersQuery = useAuctionClaimOrders(auctionCoordinates)
	const claimOrders = claimOrdersQuery.data ?? []
	const winnerClaimOrder = claimOrders.find((order) => order.pubkey === settlementWinner) ?? null
	const winnerClaimOrderId = winnerClaimOrder?.id ?? ''

	const claimOrderDetailQuery = useOrderById(winnerClaimOrderId)
	const claimOrderWithEvents: OrderWithRelatedEvents | null = claimOrderDetailQuery.data ?? null

	const submitSettlement = async (mode: 'settled' | 'reserve_not_met') => {
		if (!auction) return
		if (!isOwner) {
			toast.error('Only the auction owner can settle this auction')
			return
		}

		if (!ended) {
			toast.error('Auction must be ended before publishing this settlement')
			return
		}

		if (settlementLocked) {
			toast.error('Settlement already published for this auction')
			return
		}

		if (mode === 'settled') {
			if (!topBid) {
				toast.error('Cannot settle winner without bids')
				return
			}
			if (!reserveMet) {
				toast.error('Reserve not met; use "Reserve Not Met" settlement')
				return
			}
		}

		try {
			await settlementMutation.mutateAsync({
				auctionEventId: auctionRootEventId || auction.id,
				auctionCoordinates,
				status: mode,
				winningBidEventId: mode === 'settled' ? topBid?.id : '',
				winnerPubkey: mode === 'settled' ? topBid?.pubkey : '',
				finalAmount: mode === 'settled' ? getBidAmount(topBid) : 0,
			})
		} catch {
			// Toast handled in mutation hook.
		}
	}

	if (auctionQuery.isLoading || (!auction && auctionQuery.isFetching)) {
		return (
			<div className="p-6">
				<div className="text-sm text-gray-500">Loading auction...</div>
			</div>
		)
	}

	if (!auction) {
		return (
			<div className="p-6 space-y-3">
				<p className="text-red-600">{auctionQuery.error instanceof Error ? auctionQuery.error.message : 'Auction not found'}</p>
				<Link to="/dashboard/products/auctions">
					<Button variant="outline">Back to Auctions</Button>
				</Link>
			</div>
		)
	}

	return (
		<div className="space-y-4 p-3 lg:p-4">
			<Card className="overflow-hidden border-black/10 bg-[radial-gradient(circle_at_top_left,_rgba(244,114,182,0.18),_transparent_28%),linear-gradient(135deg,_#fff9fc,_#f8f8fb_58%,_#f2f4f7)] shadow-[0_20px_60px_-40px_rgba(17,24,39,0.45)]">
				<div className="grid gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)]">
					<div className="relative min-h-[260px] border-b border-black/10 bg-zinc-900 lg:min-h-[340px] lg:border-b-0 lg:border-r">
						{previewImage ? (
							<>
								<img src={previewImage} alt={getAuctionTitle(auction)} className="h-full w-full object-cover opacity-90" />
								<div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
							</>
						) : (
							<div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,_#111827,_#27272a)]">
								<div className="rounded-full border border-white/15 bg-white/10 p-5 text-white">
									<Gavel className="h-9 w-9" />
								</div>
							</div>
						)}
						<div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-2 p-4">
							<Badge className={AUCTION_STATUS_STYLES[status]} variant="outline">
								{status}
							</Badge>
							<Badge className="border-white/20 bg-white/10 text-white" variant="outline">
								{bidCount} {bidCount === 1 ? 'bid' : 'bids'}
							</Badge>
							<Badge className="border-white/20 bg-white/10 text-white" variant="outline">
								{reserveLabel}
							</Badge>
						</div>
					</div>

					<div className="space-y-6 p-5 lg:p-8">
						<div className="flex flex-wrap items-start justify-between gap-4">
							<div className="space-y-3">
								<p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Seller view</p>
								<div className="space-y-2">
									<h2 className="text-3xl font-bold tracking-tight text-zinc-950">{getAuctionTitle(auction)}</h2>
									<p className="max-w-2xl text-sm leading-6 text-zinc-600">{summary}</p>
								</div>
							</div>
							<Link to={`/auctions/${auction.id}`}>
								<Button variant="outline" className="gap-2 rounded-lg border-black/15 bg-white/80">
									<ExternalLink className="h-4 w-4" />
									Public View
								</Button>
							</Link>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<StatCard label="Current price" value={formatSats(currentPrice)} eyebrow="Live pulse" />
							<StatCard label="Reserve" value={formatSats(reserve)} eyebrow={reserveMet ? 'Ready to settle' : 'Threshold'} />
							<StatCard label="Opening bid" value={formatSats(startingBid)} />
							<AuctionCountdown endAt={effectiveEndAt} countdown={countdown} showSeconds variant="panel" label="Ends in" showAbsoluteTime />
						</div>

						<div className="grid gap-3 md:grid-cols-2">
							<OverviewItem label="Auction type" value={auctionType} helper="Primary format shown to buyers." />
							<OverviewItem label="Currency" value={currency} helper="Display currency for bidding." />
							<OverviewItem label="Bid increment" value={formatSats(bidIncrement)} helper="Minimum raise between bids." />
							<OverviewItem label="Schedule" value={`${formatMaybeDate(startAt)} to ${formatMaybeDate(effectiveEndAt)}`} />
						</div>
					</div>
				</div>
			</Card>

			<div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_360px]">
				<div className="space-y-6">
					<Card className="border-black/10 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="flex items-center gap-2 text-xl">
								<Gavel className="h-5 w-5" />
								Auction Snapshot
							</CardTitle>
							<CardDescription>
								Only the seller-facing information stays visible by default. Event IDs and key material are tucked into Advanced details.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3 md:grid-cols-2">
							<OverviewItem label="Status" value={status} helper={ended ? 'Bidding has closed.' : 'Auction is still collecting bids.'} />
							<OverviewItem
								label="Bid activity"
								value={`${bidCount} ${bidCount === 1 ? 'bid' : 'bids'}`}
								helper={topBid ? `Highest bid is ${formatSats(getBidAmount(topBid))}.` : 'No bids placed yet.'}
							/>
							<OverviewItem
								label="Reserve position"
								value={reserveLabel}
								helper={reserveMet ? 'Eligible for winner settlement.' : 'Auction cannot settle to winner yet.'}
							/>
							<OverviewItem
								label="Settlement lock"
								value={settlementLocked ? 'Published' : 'Open'}
								helper={settlementLocked ? 'A settlement record already exists.' : 'You can still publish a settlement.'}
							/>
						</CardContent>
					</Card>

					<Card className="border-black/10 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="flex items-center gap-2 text-xl">
								<Clock className="h-5 w-5" />
								Live Bids
							</CardTitle>
							<CardDescription>
								Amounts stay front and center. Bidder keys, bid event IDs, and mint wiring live behind each bid&apos;s technical panel.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{bidsQuery.isLoading && <div className="text-sm text-zinc-500">Loading bids...</div>}
							{!bidsQuery.isLoading && bidsByNewest.length === 0 && <div className="text-sm text-zinc-500">No bids yet.</div>}
							{bidsByNewest.length > 0 && (
								<div className="space-y-4">
									{topBid && (
										<div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4">
											<p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Leading bid</p>
											<div className="mt-2 flex flex-wrap items-end justify-between gap-3">
												<div>
													<p className="text-2xl font-bold text-emerald-950">{formatSats(getBidAmount(topBid))}</p>
													<p className="mt-1 text-sm text-emerald-800">
														Placed {topBid.created_at ? new Date(topBid.created_at * 1000).toLocaleString() : 'at an unknown time'}
													</p>
												</div>
												<Badge className="border-emerald-200 bg-white text-emerald-800" variant="outline">
													Highest offer
												</Badge>
											</div>
										</div>
									)}

									<div className="space-y-3">
										{bidsByNewest.map((bidEvent) => {
											const amount = getBidAmount(bidEvent)
											const isTop = !!topBid && bidEvent.id === topBid.id
											const locktime = bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1]
											const keyScheme = bidEvent.tags.find((tag) => tag[0] === 'key_scheme')?.[1] || 'hd_p2pk'
											const createdAt = bidEvent.created_at ? new Date(bidEvent.created_at * 1000).toLocaleString() : 'N/A'

											return (
												<div key={bidEvent.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
													<div className="flex flex-wrap items-start justify-between gap-3">
														<div>
															<p className="text-xl font-semibold text-zinc-950">{formatSats(amount)}</p>
															<p className="mt-1 text-sm text-zinc-500">
																{isTop ? 'Currently leading the auction.' : 'Recorded bid in the live auction feed.'}
															</p>
														</div>
														<div className="flex flex-wrap gap-2">
															{isTop && (
																<Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">
																	Top bid
																</Badge>
															)}
															<Badge className="border-zinc-200 bg-zinc-100 text-zinc-700" variant="outline">
																{getBidStatus(bidEvent)}
															</Badge>
														</div>
													</div>

													<div className="mt-4 grid gap-3 sm:grid-cols-2">
														<OverviewItem label="Recorded at" value={createdAt} />
														<OverviewItem label="Reserve check" value={amount >= reserve ? 'Meets reserve' : 'Below reserve'} />
													</div>

													<Accordion type="single" collapsible className="mt-4 rounded-xl border border-zinc-200 px-4">
														<AccordionItem value={`bid-${bidEvent.id}`} className="border-none">
															<AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 hover:no-underline">
																Technical bid data
															</AccordionTrigger>
															<AccordionContent className="space-y-3 pb-4">
																<TechnicalRow label="Bidder pubkey" value={bidEvent.pubkey} copyValue={bidEvent.pubkey} />
																<TechnicalRow
																	label="Mint"
																	value={getBidMint(bidEvent) || 'N/A'}
																	copyValue={getBidMint(bidEvent) || undefined}
																/>
																<TechnicalRow label="Key scheme" value={keyScheme} />
																<TechnicalRow
																	label="Locktime"
																	value={locktime ? new Date(parseInt(locktime, 10) * 1000).toLocaleString() : 'N/A'}
																/>
																<TechnicalRow label="Bid event ID" value={bidEvent.id} copyValue={bidEvent.id} />
															</AccordionContent>
														</AccordionItem>
													</Accordion>
												</div>
											)
										})}
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				<div className="space-y-6">
					<Card className="border-black/10 bg-[linear-gradient(180deg,_rgba(249,250,251,0.96),_rgba(244,244,245,0.86))] shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="flex items-center gap-2 text-xl">
								<Shield className="h-5 w-5" />
								Settlement
							</CardTitle>
							<CardDescription>
								Keep the operational state visible. Escrow keys, xpubs, and event wiring stay in Advanced details.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="rounded-2xl border border-zinc-200 bg-white p-4">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="text-sm font-medium text-zinc-600">Current state</p>
									<Badge
										className={
											latestSettlement
												? SETTLEMENT_STATUS_STYLES[latestSettlementStatus]
												: ended
													? 'border-amber-200 bg-amber-50 text-amber-800'
													: 'border-sky-200 bg-sky-50 text-sky-800'
										}
										variant="outline"
									>
										{latestSettlement ? latestSettlementStatus.replaceAll('_', ' ') : ended ? 'Ready to settle' : 'Awaiting close'}
									</Badge>
								</div>
								<div className="mt-4 space-y-3">
									<OverviewItem label="Reserve status" value={reserveLabel} />
									<OverviewItem
										label="Latest settlement"
										value={
											latestSettlement
												? latestSettlementStatus === 'settled'
													? 'Winning bidder selected'
													: latestSettlementStatus.replaceAll('_', ' ')
												: 'No settlement published yet'
										}
										helper={
											latestSettlement
												? getAuctionSettlementFinalAmount(latestSettlement) > 0
													? `Final amount: ${formatSats(getAuctionSettlementFinalAmount(latestSettlement))}`
													: 'No final amount recorded.'
												: ended
													? 'You can publish a settlement once you decide the outcome.'
													: 'Settlement options unlock after the auction ends.'
										}
									/>
								</div>
							</div>

							<div className="space-y-2">
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Settlement actions</p>
								<Button
									className="w-full"
									disabled={!isOwner || settlementLocked || !ended || !topBid || !reserveMet || settlementMutation.isPending}
									onClick={() => void submitSettlement('settled')}
								>
									Settle Winner
								</Button>
								<Button
									variant="outline"
									className="w-full"
									disabled={!isOwner || settlementLocked || !ended || settlementMutation.isPending}
									onClick={() => void submitSettlement('reserve_not_met')}
								>
									Reserve Not Met
								</Button>
							</div>

							<div className="rounded-xl border border-dashed border-zinc-300 bg-white/70 p-3 text-xs text-zinc-600">
								{!isOwner && 'Only the auction owner can publish a settlement.'}
								{isOwner && !ended && 'Settlement to a winner or reserve outcome unlocks after the auction ends.'}
								{isOwner && ended && settlementLocked && 'A settlement event already exists for this auction.'}
								{isOwner && ended && !settlementLocked && 'Review the latest bid state, then publish the final auction outcome.'}
							</div>

							<Accordion type="multiple" className="rounded-2xl border border-zinc-200 bg-white px-4">
								<AccordionItem value="settlement-config">
									<AccordionTrigger className="text-sm font-semibold hover:no-underline">Advanced settlement wiring</AccordionTrigger>
									<AccordionContent className="space-y-3">
										<TechnicalRow
											label="Path issuer"
											value={getAuctionPathIssuer(auction) || 'N/A'}
											copyValue={getAuctionPathIssuer(auction) || undefined}
										/>
										<TechnicalRow label="Key scheme" value={getAuctionKeyScheme(auction)} />
										{p2pkXpub && <TechnicalRow label="P2PK xpub" value={p2pkXpub} copyValue={p2pkXpub} />}
										<TechnicalRow label="Settlement policy" value={getAuctionSettlementPolicy(auction) || 'N/A'} />
										<TechnicalRow label="Schema" value={getAuctionSchema(auction) || 'N/A'} />
										<TechnicalRow label="Trusted mints" value={trustedMints.length > 0 ? trustedMints.join('\n') : 'N/A'} stacked={true} />
									</AccordionContent>
								</AccordionItem>

								<AccordionItem value="settlement-record">
									<AccordionTrigger className="text-sm font-semibold hover:no-underline">Published settlement record</AccordionTrigger>
									<AccordionContent className="space-y-3">
										{latestSettlement ? (
											<>
												<TechnicalRow label="Settlement status" value={getAuctionSettlementStatus(latestSettlement).replaceAll('_', ' ')} />
												<TechnicalRow
													label="Winner pubkey"
													value={getAuctionSettlementWinner(latestSettlement) || 'N/A'}
													copyValue={getAuctionSettlementWinner(latestSettlement) || undefined}
												/>
												<TechnicalRow
													label="Winning bid event"
													value={getAuctionSettlementWinningBid(latestSettlement) || 'N/A'}
													copyValue={getAuctionSettlementWinningBid(latestSettlement) || undefined}
												/>
												<TechnicalRow label="Final amount" value={formatSats(getAuctionSettlementFinalAmount(latestSettlement))} />
											</>
										) : (
											<p className="text-sm text-zinc-500">No settlement has been published yet.</p>
										)}
									</AccordionContent>
								</AccordionItem>

								<AccordionItem value="auction-metadata">
									<AccordionTrigger className="text-sm font-semibold hover:no-underline">Auction event metadata</AccordionTrigger>
									<AccordionContent className="space-y-3">
										<TechnicalRow label="Auction event ID" value={auction.id} copyValue={auction.id} />
										<TechnicalRow
											label="Auction coordinate"
											value={auctionCoordinates || 'N/A'}
											copyValue={auctionCoordinates || undefined}
										/>
										<TechnicalRow label="d tag" value={getAuctionId(auction) || 'N/A'} copyValue={getAuctionId(auction) || undefined} />
										<TechnicalRow label="Seller pubkey" value={auction.pubkey} copyValue={auction.pubkey} />
										<TechnicalRow
											label="Created at"
											value={auction.created_at ? new Date(auction.created_at * 1000).toLocaleString() : 'N/A'}
										/>
									</AccordionContent>
								</AccordionItem>
							</Accordion>
						</CardContent>
					</Card>

					{/* Fulfilment — only visible once settled with a winner */}
					{latestSettlementStatus === 'settled' && settlementWinner && (
						<Card className="border-black/10 shadow-sm">
							<CardHeader className="pb-4">
								<CardTitle className="flex items-center gap-2 text-xl">
									<Package className="h-5 w-5" />
									Fulfilment
								</CardTitle>
								<CardDescription>
									Post-settlement delivery flow. Once the winner submits their address you can process and ship the item using the same
									controls as regular orders.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="rounded-2xl border border-zinc-200 bg-white p-4">
									<div className="flex items-center justify-between gap-2">
										<p className="text-sm font-medium text-zinc-600">Winner</p>
										<AvatarUser pubkey={settlementWinner} />
									</div>
									<div className="mt-3">
										<OverviewItem
											label="Final amount"
											value={`${getAuctionSettlementFinalAmount(latestSettlement).toLocaleString()} sats`}
										/>
									</div>
								</div>

								{!winnerClaimOrder && (
									<div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-800">
										Waiting for the winner to submit their shipping address.
									</div>
								)}

								{winnerClaimOrder && !claimOrderWithEvents && (
									<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">Loading order details...</div>
								)}

								{claimOrderWithEvents && user?.pubkey && (
									<div className="space-y-3">
										{/* Shipping address from the claim order */}
										{(() => {
											const addressTag = claimOrderWithEvents.order.tags.find((t) => t[0] === 'address')?.[1]
											if (!addressTag) return null
											return (
												<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
													<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Shipping address</p>
													<p className="mt-2 whitespace-pre-wrap text-sm text-zinc-900">{addressTag}</p>
												</div>
											)
										})()}

										{/* Email if provided */}
										{(() => {
											const email = claimOrderWithEvents.order.tags.find((t) => t[0] === 'email')?.[1]
											if (!email) return null
											return <OverviewItem label="Contact email" value={email} />
										})()}

										{/* Order actions — reuses the standard confirm → process → ship flow */}
										<div className="rounded-xl border border-zinc-200 bg-white p-4">
											<p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Order progress</p>
											<OrderActions order={claimOrderWithEvents} userPubkey={user.pubkey} />
										</div>
									</div>
								)}
							</CardContent>
						</Card>
					)}

					<Card className="border-black/10 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="text-lg">Operational checks</CardTitle>
							<CardDescription>High-signal details for the seller without exposing raw identifiers.</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<OverviewItem
								label="Settlement policy"
								value={getAuctionSettlementPolicy(auction) || 'Not configured'}
								helper="The raw settlement wiring remains in Advanced settlement details."
							/>
							<OverviewItem
								label="Trusted mints"
								value={trustedMints.length > 0 ? `${trustedMints.length} configured` : 'None configured'}
								helper={trustedMints.length > 0 ? 'Full mint URLs are hidden in Advanced settlement wiring.' : undefined}
							/>
							<OverviewItem
								label="Metadata visibility"
								value="Hidden by default"
								helper="Auction IDs, coordinates, keys, and settlement records live behind the advanced accordions."
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}
