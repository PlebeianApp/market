import { AuctionClaimDialog } from '@/components/AuctionClaimDialog'
import { AuctionCountdown, useAuctionCountdown } from '@/components/AuctionCountdown'
import { AuctionVerdictPanel } from '@/components/AuctionVerdictPanel'
import { AvatarUser } from '@/components/AvatarUser'
import { ProfileName } from '@/components/ProfileName'
import { OrderActions } from '@/components/orders/OrderActions'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { authStore } from '@/lib/stores/auth'
import { getAuctionBidAmount, getAuctionWindowValidBids } from '@/lib/auctionSettlement'
import { nip60Actions } from '@/lib/stores/nip60'
import { findBidderRecord } from '@/lib/auction/bidderRecords'
import { usePublishAuctionSettlementMutation } from '@/publish/auctions'
import { auctionKeys } from '@/queries/queryKeyFactory'
import { useQueryClient } from '@tanstack/react-query'
import {
	auctionQueryOptions,
	getAuctionBiddingCutoffAt,
	getAuctionBidCountFromBids,
	getAuctionBidIncrement,
	getAuctionCurrentPriceFromBids,
	getAuctionCurrency,
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
	getAuctionSettlementGrace,
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
	useAuctionBids,
	useAuctionClaimOrders,
	useAuctionPathReleases,
	useAuctionSettlements,
	usePrivateAuctionClaimForOrder,
	getAuctionTopBidValid,
} from '@/queries/auctions'
import { type OrderWithRelatedEvents, useOrderById } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Clock, Copy, ExternalLink, Gavel, MapPin, Package, Shield, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
	getLegacyAuctionClaimPublicDetails,
	type LegacyAuctionClaimPublicDetails,
	type PrivateAuctionClaimPayload,
} from '@/lib/auctions/privateAuctionClaimMessage'

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

function OverviewItem({ label, value, helper }: { label: string; value: React.ReactNode; helper?: string }) {
	return (
		<div className="rounded-xl border border-zinc-200 bg-white p-4">
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
			<div className="mt-2 text-sm font-medium text-zinc-950">{value}</div>
			{helper && <p className="mt-1 text-xs text-zinc-500">{helper}</p>}
		</div>
	)
}

function formatPrivateClaimAddress(payload: PrivateAuctionClaimPayload): string {
	const { shippingAddress } = payload
	return [
		shippingAddress.name,
		shippingAddress.firstLineOfAddress,
		shippingAddress.additionalInformation,
		[shippingAddress.city, shippingAddress.zipPostcode].filter(Boolean).join(' '),
		shippingAddress.country,
	]
		.filter(Boolean)
		.join('\n')
}

function privateClaimUnavailableMessage(status?: string, reason?: string): string {
	if (status === 'unavailable' && reason === 'no_signer') {
		return 'Private shipping details unavailable until the seller signing session is connected.'
	}
	if (status === 'unavailable' && reason === 'not_seller') {
		return 'Private shipping details are only available to the auction seller.'
	}
	if (status === 'unavailable' && reason === 'missing_marker_fields') {
		return 'Private shipping details unavailable because the public claim marker is missing required references.'
	}
	return 'Private shipping details are not available from the encrypted claim path yet.'
}

function shouldUseLegacyPublicClaimDetails(isOwner: boolean, result: ReturnType<typeof usePrivateAuctionClaimForOrder>['data']): boolean {
	return isOwner && result?.status === 'unavailable' && result.reason === 'missing_marker_fields'
}

function formatLegacyPublicClaimAddress(details: LegacyAuctionClaimPublicDetails): string {
	return details.address ?? ''
}

function PartyRow({ label, pubkey, helper }: { label: string; pubkey: string; helper?: string }) {
	return (
		<div className="rounded-xl border border-zinc-200 bg-white p-4">
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
			<div className="mt-2 flex items-center gap-2">
				<AvatarUser pubkey={pubkey} colored className="h-7 w-7" />
				{pubkey ? (
					<ProfileName pubkey={pubkey} className="text-sm font-medium text-zinc-950" />
				) : (
					<span className="text-sm font-medium text-zinc-950">N/A</span>
				)}
			</div>
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
	const [isClaimDialogOpen, setIsClaimDialogOpen] = useState(false)

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
	const auctionType = getAuctionType(auction)
	const currency = getAuctionCurrency(auction)
	const trustedMints = getAuctionMints(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const summary = getAuctionSummary(auction) || auction?.content || 'No summary provided yet.'
	const previewImage = getAuctionImages(auction)[0]?.[1]

	const bidsQuery = useAuctionBids(auctionRootEventId || auctionId, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const countdown = useAuctionCountdown(biddingCutoffAt, { showSeconds: true })
	const now = countdown.now
	const status = formatAuctionStatus(startAt, biddingCutoffAt, now)
	const ended = status === 'Ended'
	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const bidCount = getAuctionBidCountFromBids(auction, bids)

	const settlementsQuery = useAuctionSettlements(auctionRootEventId || auctionId, 100, auctionCoordinates)
	const settlements = settlementsQuery.data ?? []
	const latestSettlement = settlements[0] || null
	const settlementMutation = usePublishAuctionSettlementMutation()

	const topBid = useMemo(() => getAuctionTopBidValid(auction, bids), [auction, bids])

	const bidsByNewest = useMemo(() => [...bids].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)), [bids])

	const reserveMet = !!topBid && getBidAmount(topBid) >= reserve
	const settlementLocked = !!latestSettlement
	const latestSettlementStatus = latestSettlement ? getAuctionSettlementStatus(latestSettlement) : 'unknown'
	const reserveLabel = bidCount === 0 ? 'Waiting for bids' : reserveMet ? 'Reserve met' : 'Below reserve'

	// Settlement window: bids are Cashu-locked until `max_end_at + settlement_grace`
	// (the per-auction "locktime" — see AUCTIONS.md §4.1). Once now is past the
	// locktime, bidders can reclaim their locked collateral, so the seller can
	// no longer settle this auction.
	const maxEndAt = auction ? getAuctionMaxEndAt(auction) : 0
	const settlementGrace = auction ? getAuctionSettlementGrace(auction) : 0
	const settlementLocktimeAt = maxEndAt > 0 && settlementGrace > 0 ? maxEndAt + settlementGrace : 0
	const settlementWindowExpired = settlementLocktimeAt > 0 && now >= settlementLocktimeAt

	// Bidder-held-path scheme: the seller can only publish kind-1024 after
	// the winning bidder has published a kind-1025 path release. Without
	// the path the seller can't derive `seller_child_privkey` and so
	// can't redeem the locked Cashu — publishing a settlement at that
	// point would be a no-op claim. We surface the gate state in the UI
	// so sellers know what they're waiting on.
	const pathReleasesQuery = useAuctionPathReleases(auctionRootEventId || auctionId, 200, auctionCoordinates)
	const pathReleases = pathReleasesQuery.data ?? []
	const hasPathReleaseForTopBid = useMemo(() => {
		if (!topBid) return false
		return pathReleases.some((pr) => pr.tags.find((t) => t[0] === 'e')?.[1] === topBid.id)
	}, [pathReleases, topBid])
	const canSettleNow = ended && !settlementLocked && !settlementWindowExpired && (hasPathReleaseForTopBid || !reserveMet)

	// Settlement / claim ordering data — needed by both perspectives.
	const settlementWinner = getAuctionSettlementWinner(latestSettlement)
	const isOwner = !!(auction && user?.pubkey && auction.pubkey === user.pubkey)
	const isWinner = !!(user?.pubkey && settlementWinner && user.pubkey === settlementWinner)
	const claimOrdersQuery = useAuctionClaimOrders(auctionCoordinates)
	const claimOrders = claimOrdersQuery.data ?? []
	const winnerClaimOrder = claimOrders.find((order) => order.pubkey === settlementWinner) ?? null
	const winnerClaimOrderId = winnerClaimOrder?.id ?? ''

	const claimOrderDetailQuery = useOrderById(winnerClaimOrderId)
	const claimOrderWithEvents: OrderWithRelatedEvents | null = claimOrderDetailQuery.data ?? null
	const privateClaimQuery = usePrivateAuctionClaimForOrder(winnerClaimOrder, isOwner && !!winnerClaimOrder)
	const privateClaimResult = privateClaimQuery.data
	const privateClaimPayload = privateClaimResult?.status === 'found' ? privateClaimResult.claim.payload : null
	const legacyPublicClaimDetails =
		winnerClaimOrder && shouldUseLegacyPublicClaimDetails(isOwner, privateClaimResult)
			? getLegacyAuctionClaimPublicDetails({ pubkey: winnerClaimOrder.pubkey, tags: winnerClaimOrder.tags })
			: null

	// --- Perspective ----------------------------------------------------------
	// The dashboard auction detail route is consumed by both sellers and buyers
	// (and any logged-in viewer). What's rendered below depends on which role
	// the current user holds. Sellers see settlement + outgoing fulfilment;
	// winners see "submit your address" + incoming fulfilment; viewers see the
	// public state only. OrderActions itself handles per-role action gating.
	const isSettled = latestSettlementStatus === 'settled'
	const winnerHasClaimed = !!winnerClaimOrder
	const winnerNeedsAddress = isSettled && isWinner && !winnerHasClaimed

	// -- Bidder-held-path settlement (bidder side) --------------------------
	// The bidder publishes a kind-1025 path release to unblock the seller's
	// redemption. We surface it here on the dashboard auction detail page
	// for ergonomic access (the public auction page surfaces the same
	// action). The local bidder record (path, refund key, full proofs) is
	// only present if THIS browser placed the bid via `publishAuctionBid`
	// — seeded bids don't show up here because the seed script publishes
	// kind-1023 from a Node process and never writes to localStorage. We
	// distinguish those two states so the user knows why the button isn't
	// available.
	const myTopBidEvent = useMemo(() => {
		if (!user?.pubkey) return null
		const mine = bids.filter((b) => b.pubkey === user.pubkey)
		if (!mine.length) return null
		return mine.reduce<(typeof mine)[0] | null>((best, bid) => {
			if (!best) return bid
			const delta = getBidAmount(bid) - getBidAmount(best)
			if (delta > 0) return bid
			if (delta < 0) return best
			return (bid.created_at ?? 0) < (best.created_at ?? 0) ? bid : best
		}, mine[0])
	}, [bids, user?.pubkey])

	const isMyBidTop = !!(myTopBidEvent && topBid && myTopBidEvent.id === topBid.id)
	const myAlreadyReleased = useMemo(() => {
		if (!myTopBidEvent) return false
		return pathReleases.some((pr) => pr.tags.find((t) => t[0] === 'e')?.[1] === myTopBidEvent.id)
	}, [pathReleases, myTopBidEvent])
	const myBidderRecord = useMemo(() => (myTopBidEvent ? findBidderRecord(myTopBidEvent.id) : null), [myTopBidEvent])
	const canBidderReleaseNow = !!(isMyBidTop && ended && !myAlreadyReleased && !settlementWindowExpired && myTopBidEvent && myBidderRecord)

	const releaseQueryClient = useQueryClient()
	const [isReleasing, setIsReleasing] = useState(false)
	const releasePath = async () => {
		if (!myTopBidEvent) return
		setIsReleasing(true)
		try {
			await nip60Actions.settleAuctionAsWinner({
				bidEventId: myTopBidEvent.id,
				releaseReason: 'settlement',
			})
			toast.success('Path release published — the seller can now redeem and publish the settlement.')
			await releaseQueryClient.invalidateQueries({ queryKey: auctionKeys.pathReleases(auctionRootEventId || auctionId) })
		} catch (err) {
			toast.error(`Failed to release path: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setIsReleasing(false)
		}
	}

	const submitSettlement = async () => {
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

		try {
			// Bidder-held-path scheme: the settlement publisher itself
			// resolves the winning bid + reads the kind-1025 path release
			// + redeems the locked Cashu. The only branch we still
			// pre-decide client-side is `reserve_not_met` — without a
			// reserve-meeting bid there's nothing to redeem and the
			// publisher should write a status=reserve_not_met event
			// straight away (rather than trying to look up a path
			// release for a bid that can't actually win).
			const desiredStatus: 'reserve_not_met' | undefined = topBid && reserveMet ? undefined : 'reserve_not_met'
			await settlementMutation.mutateAsync({
				auctionEventId: auctionRootEventId || auction.id,
				auctionCoordinates,
				status: desiredStatus,
				winningBidEventId: desiredStatus ? undefined : topBid?.id,
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

	const perspectiveLabel = isOwner ? 'Seller view' : isWinner ? 'Winner view' : 'Browsing'

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
								<p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{perspectiveLabel}</p>
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
							<AuctionCountdown auction={auction} />
						</div>

						<div className="grid gap-3 md:grid-cols-2">
							<OverviewItem label="Auction type" value={auctionType} helper="Primary format shown to buyers." />
							<OverviewItem label="Currency" value={currency} helper="Display currency for bidding." />
							<OverviewItem label="Bid increment" value={formatSats(bidIncrement)} helper="Minimum raise between bids." />
							<OverviewItem label="Schedule" value={`${formatMaybeDate(startAt)} to ${formatMaybeDate(biddingCutoffAt)}`} />
						</div>

						{/* Parties — pubkeys resolved via AvatarUser for both perspectives */}
						<div className="grid gap-3 md:grid-cols-2">
							<PartyRow label="Seller" pubkey={auction.pubkey} helper={isOwner ? 'You' : undefined} />
							{isSettled && settlementWinner && <PartyRow label="Winner" pubkey={settlementWinner} helper={isWinner ? 'You' : undefined} />}
						</div>
					</div>
				</div>
			</Card>

			<div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_360px]">
				<div className="space-y-6">
					{/* Public bid feed — visible to all */}
					<Card className="border-black/10 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="flex items-center gap-2 text-xl">
								<Clock className="h-5 w-5" />
								Bids
							</CardTitle>
							<CardDescription>
								Public bid feed for this auction. Bidder pubkeys, bid event IDs, and mint wiring live behind each bid&apos;s technical
								panel.
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
													<div className="mt-1 flex items-center gap-2 text-sm text-emerald-800">
														<AvatarUser pubkey={topBid.pubkey} colored className="h-5 w-5" />
														<span>
															Placed {topBid.created_at ? new Date(topBid.created_at * 1000).toLocaleString() : 'at an unknown time'}
														</span>
													</div>
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
											const isOwnBid = !!user?.pubkey && bidEvent.pubkey === user.pubkey

											return (
												<div key={bidEvent.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
													<div className="flex flex-wrap items-start justify-between gap-3">
														<div className="space-y-1">
															<p className="text-xl font-semibold text-zinc-950">{formatSats(amount)}</p>
															<div className="flex items-center gap-2 text-sm text-zinc-500">
																<AvatarUser pubkey={bidEvent.pubkey} colored className="h-5 w-5" />
																<span className="break-all">{isOwnBid ? 'You' : isTop ? 'Currently leading' : 'Bidder'}</span>
															</div>
														</div>
														<div className="flex flex-wrap gap-2">
															{isTop && (
																<Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">
																	Top bid
																</Badge>
															)}
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

					{/* Operational panel — only the seller sees this */}
					{isOwner && (
						<Card className="border-black/10 shadow-sm">
							<CardHeader className="pb-4">
								<CardTitle className="flex items-center gap-2 text-xl">
									<Gavel className="h-5 w-5" />
									Auction Snapshot
								</CardTitle>
								<CardDescription>Seller-facing operational state. Public viewers see only the bid feed above.</CardDescription>
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
					)}
				</div>

				<div className="space-y-6">
					{/* Settlement card — content depends on perspective */}
					<Card className="border-black/10 bg-[linear-gradient(180deg,_rgba(249,250,251,0.96),_rgba(244,244,245,0.86))] shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="flex items-center gap-2 text-xl">
								<Shield className="h-5 w-5" />
								Settlement
							</CardTitle>
							<CardDescription>
								{isOwner
									? 'Publish the kind-1024 settlement event to close the auction. Operational details stay visible; raw event wiring is in Advanced details.'
									: isWinner
										? 'You won this auction. Submit your shipping address so the seller can fulfil it.'
										: 'Public settlement state for this auction.'}
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
										{latestSettlement ? latestSettlementStatus.replace(/_/g, ' ') : ended ? 'Ready to settle' : 'Awaiting close'}
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
													: latestSettlementStatus.replace(/_/g, ' ')
												: 'No settlement published yet'
										}
										helper={
											latestSettlement
												? getAuctionSettlementFinalAmount(latestSettlement) > 0
													? `Final amount: ${formatSats(getAuctionSettlementFinalAmount(latestSettlement))}`
													: 'No final amount recorded.'
												: ended
													? 'Settlement can be published now.'
													: 'Settlement options unlock after the auction ends.'
										}
									/>
								</div>
							</div>

							{/* Bidder-only path release action — only shown to the top
							    bidder when they hold a valid local record. Surfaces
							    explanatory states for the common failure modes so a
							    stuck bidder knows what's wrong. */}
							{!isOwner && isMyBidTop && ended && !settlementLocked && (
								<div className="space-y-2">
									<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Your action</p>
									{myAlreadyReleased ? (
										<div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
											<p className="font-semibold">Path release published</p>
											<p className="mt-1 text-xs">Waiting for the seller to redeem at the mint and publish the kind-1024 settlement.</p>
										</div>
									) : settlementWindowExpired ? (
										<div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
											<p className="font-semibold">Settlement window expired</p>
											<p className="mt-1 text-xs">
												The locktime passed on {formatMaybeDate(settlementLocktimeAt)}. You can now reclaim your locked Cashu via the refund
												branch from your wallet rather than completing the settlement here.
											</p>
										</div>
									) : !myBidderRecord ? (
										<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
											<p className="font-semibold">Local bidder record missing</p>
											<p className="mt-1 text-xs leading-relaxed">
												This browser doesn't hold the derivation path or locked proofs for this bid, so it can't release. Reasons this can
												happen: (1) the bid was placed in a different browser / profile, (2) localStorage was cleared, or (3) this is a
												seeded fixture (the seed script publishes the bid event from a Node process and the proofs never reach the browser).
												Real bids placed via the bidding UI on this device do not hit this state.
											</p>
										</div>
									) : (
										<>
											<div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
												<p className="text-sm font-semibold text-sky-950">
													You won this auction with {getBidAmount(myTopBidEvent!).toLocaleString()} sats.
												</p>
												<p className="mt-1 text-xs leading-relaxed text-sky-900">
													Publishing your kind-1025 reveals the derivation path so the seller can derive their child privkey and redeem the
													locked Cashu. After this, the seller publishes kind-1024 to close the auction.
												</p>
											</div>
											<Button className="w-full" onClick={() => void releasePath()} disabled={isReleasing || !canBidderReleaseNow}>
												{isReleasing ? 'Releasing…' : 'Release path & settle'}
											</Button>
											<p className="text-[11px] leading-relaxed text-zinc-500">
												Release before {formatMaybeDate(settlementLocktimeAt)} (locktime). After that you can self-refund instead of
												settling.
											</p>
										</>
									)}
								</div>
							)}

							{/* Seller-only settlement publish action */}
							{isOwner && (
								<div className="space-y-2">
									<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Settlement action</p>
									{settlementWindowExpired && !settlementLocked ? (
										<div className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-4">
											<p className="flex items-center gap-2 text-sm font-semibold text-rose-900">
												<Clock className="h-4 w-4" /> Settlement window expired
											</p>
											<p className="text-xs leading-relaxed text-rose-800">
												The Cashu locktime passed on {formatMaybeDate(settlementLocktimeAt)}. Bidders can now reclaim their locked
												collateral, so this auction can no longer be settled. Any bids that haven't been reclaimed yet may still be
												claimable, but you can't bind a winner anymore.
											</p>
										</div>
									) : (
										<>
											<Button
												className="w-full"
												disabled={
													!isOwner || settlementLocked || !ended || settlementWindowExpired || settlementMutation.isPending || !canSettleNow
												}
												onClick={() => void submitSettlement()}
											>
												{settlementMutation.isPending ? 'Publishing…' : 'Publish Settlement'}
											</Button>
											<p className="text-[11px] leading-relaxed text-zinc-500">
												{topBid && reserveMet
													? hasPathReleaseForTopBid
														? `Winner published their path release — clicking settle will redeem ${getBidAmount(topBid).toLocaleString()} sats and publish kind-1024.`
														: `Top bid: ${getBidAmount(topBid).toLocaleString()} sats. Waiting for the winning bidder to publish a kind-1025 path release.`
													: topBid
														? 'Top bid is below the reserve — settlement will record reserve_not_met.'
														: 'No valid bids — settlement will record reserve_not_met.'}
											</p>
											<div className="rounded-xl border border-dashed border-zinc-300 bg-white/70 p-3 text-xs text-zinc-600">
												{!ended && 'Settlement unlocks after the auction ends.'}
												{ended && settlementLocked && 'A settlement event already exists for this auction.'}
												{ended && !settlementLocked && topBid && reserveMet && !hasPathReleaseForTopBid && (
													<>The winning bidder must publish a kind-1025 path release before you can settle.</>
												)}
												{canSettleNow &&
													`Review the latest bid state, then publish the final auction outcome before ${formatMaybeDate(settlementLocktimeAt)} (locktime).`}
											</div>
										</>
									)}
								</div>
							)}

							{/* Winner-only claim address action */}
							{winnerNeedsAddress && (
								<div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
									<p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
										<MapPin className="h-4 w-4" /> Shipping address required
									</p>
									<p className="text-xs leading-relaxed text-amber-800">
										You won this auction at {formatSats(getAuctionSettlementFinalAmount(latestSettlement))}. Submit your shipping address so
										the seller can ship the item to you.
									</p>
									<Button onClick={() => setIsClaimDialogOpen(true)} className="w-full sm:w-auto">
										Submit Shipping Address
									</Button>
								</div>
							)}

							{/* Winner who has already claimed */}
							{isWinner && winnerHasClaimed && (
								<div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
									<p className="flex items-center gap-2 font-semibold">
										<Trophy className="h-4 w-4" /> Address sent
									</p>
									<p className="mt-1 text-xs">Your shipping address was delivered to the seller. Track fulfilment progress below.</p>
								</div>
							)}

							<AuctionVerdictPanel auctionRootEventId={auctionRootEventId || auctionId} auctionCoordinate={auctionCoordinates} />

							{/* Tech accordion — visible to all but only really useful for seller / debugging */}
							<Accordion type="multiple" className="rounded-2xl border border-zinc-200 bg-white px-4">
								<AccordionItem value="settlement-config">
									<AccordionTrigger className="text-sm font-semibold hover:no-underline">Advanced settlement wiring</AccordionTrigger>
									<AccordionContent className="space-y-3">
										<TechnicalRow
											label="Auditor"
											value={getAuctionPathIssuer(auction) || 'N/A'}
											copyValue={getAuctionPathIssuer(auction) || undefined}
										/>
										<TechnicalRow label="Settlement policy" value={getAuctionSettlementPolicy(auction) || 'N/A'} />
										<TechnicalRow label="Lock key derivation" value={getAuctionKeyScheme(auction)} />
										{p2pkXpub && <TechnicalRow label="P2PK xpub" value={p2pkXpub} copyValue={p2pkXpub} />}
										<TechnicalRow label="Schema" value={getAuctionSchema(auction) || 'N/A'} />
										<TechnicalRow label="Trusted mints" value={trustedMints.length > 0 ? trustedMints.join('\n') : 'N/A'} stacked={true} />
									</AccordionContent>
								</AccordionItem>

								<AccordionItem value="settlement-record">
									<AccordionTrigger className="text-sm font-semibold hover:no-underline">Published settlement record</AccordionTrigger>
									<AccordionContent className="space-y-3">
										{latestSettlement ? (
											<>
												<TechnicalRow label="Settlement status" value={getAuctionSettlementStatus(latestSettlement).replace(/_/g, ' ')} />
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
											label="Max end at"
											value={getAuctionMaxEndAt(auction) ? formatMaybeDate(getAuctionMaxEndAt(auction)) : 'N/A'}
										/>
										<TechnicalRow
											label="Created at"
											value={auction.created_at ? new Date(auction.created_at * 1000).toLocaleString() : 'N/A'}
										/>
									</AccordionContent>
								</AccordionItem>
							</Accordion>
						</CardContent>
					</Card>

					{/* Fulfilment — visible to seller and winner, once settled with a winner */}
					{isSettled && settlementWinner && (isOwner || isWinner) && (
						<Card className="border-black/10 shadow-sm">
							<CardHeader className="pb-4">
								<CardTitle className="flex items-center gap-2 text-xl">
									<Package className="h-5 w-5" />
									Fulfilment
								</CardTitle>
								<CardDescription>
									{isOwner
										? "Once the winner submits their address you'll see it here. Use the order controls to confirm, process, and ship."
										: 'Track the seller as they confirm payment, prepare your item, and ship it. You can mark received once it arrives.'}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="rounded-2xl border border-zinc-200 bg-white p-4">
									<div className="grid gap-3 sm:grid-cols-2">
										<PartyRow label="Seller" pubkey={auction.pubkey} helper={isOwner ? 'You' : undefined} />
										<PartyRow label="Winner" pubkey={settlementWinner} helper={isWinner ? 'You' : undefined} />
									</div>
									<div className="mt-3">
										<OverviewItem label="Final amount" value={formatSats(getAuctionSettlementFinalAmount(latestSettlement))} />
									</div>
								</div>

								{!winnerClaimOrder && (
									<div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-800">
										{isOwner
											? 'Waiting for the winner to submit their shipping address.'
											: 'Submit your shipping address above so fulfilment can start.'}
									</div>
								)}

								{winnerClaimOrder && !claimOrderWithEvents && (
									<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">Loading order details...</div>
								)}

								{claimOrderWithEvents && user?.pubkey && (
									<div className="space-y-3">
										{isOwner && (
											<>
												{privateClaimQuery.isLoading && (
													<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
														Loading private shipping details...
													</div>
												)}

												{!privateClaimQuery.isLoading && privateClaimPayload && (
													<div className="space-y-3">
														<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
															<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Private shipping address</p>
															<p className="mt-2 whitespace-pre-wrap text-sm text-zinc-900">
																{formatPrivateClaimAddress(privateClaimPayload)}
															</p>
														</div>

														<div className="grid gap-3 sm:grid-cols-2">
															{privateClaimPayload.email && <OverviewItem label="Contact email" value={privateClaimPayload.email} />}
															{privateClaimPayload.phone && <OverviewItem label="Contact phone" value={privateClaimPayload.phone} />}
														</div>

														{privateClaimPayload.notes && <OverviewItem label="Message to seller" value={privateClaimPayload.notes} />}
													</div>
												)}

												{!privateClaimQuery.isLoading && !privateClaimPayload && legacyPublicClaimDetails && (
													<div className="space-y-3">
														{legacyPublicClaimDetails.address && (
															<div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
																<p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
																	Legacy public shipping details
																</p>
																<p className="mt-2 whitespace-pre-wrap text-sm text-zinc-900">
																	{formatLegacyPublicClaimAddress(legacyPublicClaimDetails)}
																</p>
																<p className="mt-2 text-xs text-amber-700">
																	This immutable legacy claim stored fulfilment data in public tags. New auction claims use encrypted
																	private details.
																</p>
															</div>
														)}

														{legacyPublicClaimDetails.email && (
															<OverviewItem
																label="Legacy public contact email"
																value={legacyPublicClaimDetails.email}
																helper="Shown only to the seller for old immutable auction claims."
															/>
														)}
													</div>
												)}

												{!privateClaimQuery.isLoading && !privateClaimPayload && !legacyPublicClaimDetails && (
													<div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
														{privateClaimUnavailableMessage(
															privateClaimResult?.status,
															privateClaimResult?.status === 'unavailable' ? privateClaimResult.reason : undefined,
														)}
													</div>
												)}
											</>
										)}

										{/* Order controls — perspective-aware via OrderActions itself */}
										<div className="rounded-xl border border-zinc-200 bg-white p-4">
											<p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Order progress</p>
											<OrderActions order={claimOrderWithEvents} userPubkey={user.pubkey} />
										</div>
									</div>
								)}
							</CardContent>
						</Card>
					)}
				</div>
			</div>

			{/* Claim address dialog — opened from the winner's "Submit Shipping Address" button */}
			{auction && latestSettlement && isWinner && (
				<AuctionClaimDialog
					open={isClaimDialogOpen}
					onOpenChange={setIsClaimDialogOpen}
					auctionEventId={auctionRootEventId || auction.id}
					auctionCoordinates={auctionCoordinates}
					settlementEventId={latestSettlement.id}
					sellerPubkey={auction.pubkey}
					finalAmount={getAuctionSettlementFinalAmount(latestSettlement)}
				/>
			)}
		</div>
	)
}
