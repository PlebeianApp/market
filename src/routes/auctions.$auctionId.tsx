import { AuctionCard } from '@/components/AuctionCard'
import { AuctionClaimDialog } from '@/components/AuctionClaimDialog'
import { AuctionCountdown, useAuctionCountdown } from '@/components/AuctionCountdown'
import { Comments } from '@/components/Comments'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { ImageCarousel } from '@/components/ImageCarousel'
import { ImageViewerModal } from '@/components/ImageViewerModal'
import { ItemGrid } from '@/components/ItemGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getAuctionBidderStatus, type AuctionBidderStatusKind } from '@/lib/auctionBidderStatus'
import { getUniqueAuctionShippingRefs } from '@/lib/auctionShippingRefs'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { getAuctionSettlementGraceSeconds, nip60Actions } from '@/lib/stores/nip60'
import { uiStore } from '@/lib/stores/ui'
import { usePublishAuctionBidMutation } from '@/publish/auctions'
import { findBidderRecord } from '@/lib/auction/bidderRecords'
import { useQueryClient } from '@tanstack/react-query'
import { auctionKeys } from '@/queries/queryKeyFactory'
import {
	auctionQueryOptions,
	auctionsByPubkeyQueryOptions,
	filterNSFWAuctions,
	getAuctionBidCountFromBids,
	getAuctionSettlementFinalAmount,
	getAuctionSettlementStatus,
	getAuctionSettlementWinner,
	getBidAmount,
	getBidMint,
	getBidStatus,
	getAuctionBidIncrement,
	getAuctionCategories,
	getAuctionCurrentPriceFromBids,
	getAuctionBiddingCutoffAt,
	getAuctionCurrency,
	getAuctionId,
	getAuctionPathIssuer,
	getAuctionImages,
	getAuctionKeyScheme,
	getAuctionMaxEndAt,
	getAuctionMints,
	getAuctionP2pkXpub,
	getAuctionReserve,
	getAuctionRootEventId,
	getAuctionSchema,
	getAuctionSettlementPolicy,
	getAuctionShippingOptions,
	getAuctionSpecs,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionSummary,
	getAuctionTitle,
	getAuctionType,
	isNSFWAuction,
	useStreamingAuctionBids,
	useAuctionClaimOrders,
	useAuctionPathReleases,
	useAuctionSettlements,
	getAuctionSettlementGrace,
} from '@/queries/auctions'
import { getShippingInfo, shippingOptionByCoordinatesQueryOptions } from '@/queries/shipping'
import { useProfileName } from '@/queries/profiles'
import { useQueries } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Check, Gavel, Landmark, Radio, Trophy, Truck, UserRound } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AvatarUser } from '@/components/AvatarUser'
import { AuctionBidder } from '@/components/AuctionBidder'
import { LiveChatPanel } from '@/components/LiveChatPanel'
import { UserCard } from '@/components/UserCard'
import { AuctionVerdictPanel } from '@/components/AuctionVerdictPanel'
import { formatAuctionEndTimeLabel } from '@/lib/auctionCountdownLabels'
import AuctionTimelineChart from '@/components/AuctionTimelineChart'
import { AuctionBidsContainer } from '@/components/AuctionBidsContainer'
import { AuctionSettlement } from '@/components/AuctionSettlement'

function useHeroBackground(imageUrl: string, className: string) {
	useEffect(() => {
		if (!imageUrl) return

		const style = document.createElement('style')
		style.textContent = `
      .${className} {
        background-image: url(${imageUrl}) !important;
      }
    `
		document.head.appendChild(style)

		return () => {
			document.head.removeChild(style)
		}
	}, [imageUrl, className])
}

function formatSats(value: number): string {
	return `${value.toLocaleString()} sats`
}

function formatMaybeDate(timestamp: number): string {
	if (!timestamp) return 'N/A'
	return new Date(timestamp * 1000).toLocaleString()
}

function shortenHex(value: string, left: number = 10, right: number = 8): string {
	if (!value) return 'N/A'
	if (value.length <= left + right + 1) return value
	return `${value.slice(0, left)}...${value.slice(-right)}`
}

function ShopperStat({ label, value, helper }: { label: string; value: string; helper?: string }) {
	return (
		<div className="rounded-xl border border-zinc-200 bg-background px-4 py-4 shadow-sm">
			<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
			<p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
			{helper && <p className="mt-2 text-sm leading-6 text-muted-foreground">{helper}</p>}
		</div>
	)
}

function ShopperInfoRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-4 border-b border-zinc-200/80 py-3 last:border-b-0">
			<span className="text-sm font-medium text-muted-foreground">{label}</span>
			<span className="text-sm font-semibold text-right text-foreground">{value}</span>
		</div>
	)
}

type ShippingInfo = NonNullable<ReturnType<typeof getShippingInfo>>

type ShippingTagSource = {
	tags: string[][]
}

type AuctionShippingOptionDisplay = {
	shippingRef: string
	extraCost: string
	status: 'valid' | 'invalid'
	info: ShippingInfo | null
	event: ShippingTagSource | null
	isLoading: boolean
	isNotFound: boolean
}

type AuctionParticipantSummary = {
	pubkey: string
	visibleBidCount: number
	highestVisibleBidAmount: number
	latestVisibleBidTimestamp: number
	latestBidEventId: string
	isCurrentLeader: boolean
	isSettlementWinner: boolean
}

function AuctionEmptyState({ title, description }: { title: string; description?: string }) {
	return (
		<div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
			<p className="text-sm font-medium text-zinc-900">{title}</p>
			{description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}
		</div>
	)
}

function getShippingTagValues(event: ShippingTagSource | null, tagName: string): string[] {
	return (
		event?.tags
			.find((tag) => tag[0] === tagName)
			?.slice(1)
			.filter(Boolean) ?? []
	)
}

function getShippingTagValue(event: ShippingTagSource | null, tagName: string): string {
	return getShippingTagValues(event, tagName)[0] || ''
}

function getShippingCurrency(info: ShippingInfo | null, event: ShippingTagSource | null, fallbackCurrency: string): string {
	const priceTagValues = getShippingTagValues(event, 'price')
	return info?.price.currency || priceTagValues[1] || fallbackCurrency
}

function formatShippingPrice(info: ShippingInfo | null, event: ShippingTagSource | null, fallbackCurrency: string): string {
	const priceTagValues = getShippingTagValues(event, 'price')
	const amount = info?.price.amount || priceTagValues[0] || ''
	const currency = getShippingCurrency(info, event, fallbackCurrency)

	if (!amount) return 'Price unavailable'
	return currency ? `${amount} ${currency}` : amount
}

function formatShippingExtraCost(extraCost: string, currency: string): string | null {
	const extraCostNumber = extraCost ? Number(extraCost) : 0
	if (Number.isNaN(extraCostNumber) || extraCostNumber <= 0) return null

	return currency ? `${extraCostNumber} ${currency}` : `${extraCostNumber}`
}

function formatShippingDestination(info: ShippingInfo | null, event: ShippingTagSource | null): string | null {
	const countries = info?.countries.length ? info.countries : getShippingTagValues(event, 'country')
	const regions = getShippingTagValues(event, 'region')
	const destinationParts = [
		countries.length > 0 ? `Countries: ${countries.join(', ')}` : '',
		regions.length > 0 ? `Regions: ${regions.join(', ')}` : '',
	].filter(Boolean)

	return destinationParts.length > 0 ? destinationParts.join(' · ') : null
}

function formatShippingDuration(info: ShippingInfo | null, event: ShippingTagSource | null): string | null {
	const durationTagValues = getShippingTagValues(event, 'duration')
	const min = info?.duration?.min || durationTagValues[0] || ''
	const max = info?.duration?.max || durationTagValues[1] || ''
	const unit = info?.duration?.unit || durationTagValues[2] || ''
	const unitSuffix = unit ? ` ${unit}` : ''

	if (min && max) return `${min}-${max}${unitSuffix}`
	if (min) return `${min}${unitSuffix}`
	if (max) return `Up to ${max}${unitSuffix}`
	return null
}

function formatShippingPickup(event: ShippingTagSource | null): string | null {
	const structuredAddress = [
		getShippingTagValue(event, 'pickup-street'),
		getShippingTagValue(event, 'pickup-city'),
		getShippingTagValue(event, 'pickup-state'),
		getShippingTagValue(event, 'pickup-postal-code'),
		getShippingTagValue(event, 'pickup-country'),
	].filter(Boolean)

	if (structuredAddress.length > 0) return structuredAddress.join(', ')
	return getShippingTagValue(event, 'pickup-address') || null
}

function ShippingDetailRow({ label, value }: { label: string; value?: ReactNode }) {
	if (value === null || value === undefined || value === '') return null

	return (
		<div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
			<dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
			<dd className="mt-1 break-words text-sm font-medium text-zinc-900">{value}</dd>
		</div>
	)
}

function AuctionShippingOptionCard({ option, auctionCurrency }: { option: AuctionShippingOptionDisplay; auctionCurrency: string }) {
	if (option.status === 'invalid') {
		return (
			<li className="rounded-xl border border-zinc-200 bg-background px-5 py-5 shadow-sm">
				<h3 className="text-sm font-semibold text-foreground">Invalid shipping reference</h3>
				{option.info?.description && <p className="mt-2 break-all text-xs text-muted-foreground">{option.info?.description}</p>}
			</li>
		)
	}

	if (option.isLoading) {
		return (
			<li className="rounded-xl border border-zinc-200 bg-background px-5 py-5 shadow-sm">
				<p className="text-sm text-muted-foreground">Loading shipping details...</p>
			</li>
		)
	}

	if (!option.event && !option.info) {
		return (
			<li className="rounded-xl border border-zinc-200 bg-background px-5 py-5 shadow-sm">
				<h3 className="text-sm font-semibold text-foreground">Shipping option unavailable</h3>
			</li>
		)
	}

	const title = option.info?.title || getShippingTagValue(option.event, 'title') || 'Untitled shipping option'
	const shippingCurrency = getShippingCurrency(option.info, option.event, auctionCurrency)
	const extraCost = formatShippingExtraCost(option.extraCost, shippingCurrency)
	const service = option.info?.service || getShippingTagValue(option.event, 'service')
	const carrier = option.info?.carrier || getShippingTagValue(option.event, 'carrier')
	const location = option.info?.location || getShippingTagValue(option.event, 'location')
	const pickup = formatShippingPickup(option.event)
	const hasPartialShippingInfo = !!option.event && !option.info

	return (
		<li className="rounded-xl border border-zinc-200 bg-background px-5 py-5 shadow-sm">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold text-foreground">{title}</h3>
					{option.info?.description && <p className="mt-2 break-all text-xs text-muted-foreground">{option.info?.description}</p>}
				</div>
				<Badge variant="outline" className="border-zinc-300 bg-zinc-50 text-zinc-700">
					{formatShippingPrice(option.info, option.event, auctionCurrency)}
				</Badge>
			</div>

			{hasPartialShippingInfo && (
				<div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-600">
					Some shipping details are missing or malformed.
				</div>
			)}

			<dl className="mt-4 grid gap-3 sm:grid-cols-2">
				<ShippingDetailRow label="Base price" value={formatShippingPrice(option.info, option.event, auctionCurrency)} />
				<ShippingDetailRow label="Service" value={service} />
				<ShippingDetailRow label="Carrier" value={carrier} />
				<ShippingDetailRow label="Destination" value={formatShippingDestination(option.info, option.event)} />
				<ShippingDetailRow label="Duration" value={formatShippingDuration(option.info, option.event)} />
				<ShippingDetailRow label="Location" value={location} />
				<ShippingDetailRow label="Pickup" value={pickup} />
				<ShippingDetailRow label="Auction extra cost" value={extraCost} />
			</dl>
		</li>
	)
}

const detailBidderStatusClassName = (status: AuctionBidderStatusKind): string => {
	switch (status) {
		case 'winning':
		case 'won':
			return 'border-emerald-300 bg-emerald-100 text-emerald-950'
		case 'outbid':
		case 'was_outbid':
			return 'border-amber-300 bg-amber-100 text-amber-950'
	}
}

export const Route = createFileRoute('/auctions/$auctionId')({
	component: AuctionDetailRoute,
})

function AuctionDetailRoute() {
	const { auctionId } = Route.useParams()
	const { showNSFWContent } = useStore(uiStore)
	const { user: authUser } = useStore(authStore)
	const [selectedImageIndex, setSelectedImageIndex] = useState(0)
	const [imageViewerOpen, setImageViewerOpen] = useState(false)
	const [bidAmountInput, setBidAmountInput] = useState('')
	const [isOwnAuction, setIsOwnAuction] = useState(false)
	const [currentUserPubkey, setCurrentUserPubkey] = useState('')
	const activeUserPubkey = authUser?.pubkey || currentUserPubkey
	const [claimDialogOpen, setClaimDialogOpen] = useState(false)
	const bidMutation = usePublishAuctionBidMutation()

	const auctionQuery = useQuery({
		...auctionQueryOptions(auctionId),
		retry: (failureCount) => failureCount < 30,
		retryDelay: (attemptIndex) => Math.min(500 + attemptIndex * 500, 4000),
	})

	const auction = auctionQuery.data ?? null

	const title = getAuctionTitle(auction)
	const summary = getAuctionSummary(auction)
	const description = auction?.content || ''
	const images = getAuctionImages(auction)
	const formattedImages = images.map((image) => ({
		url: image[1],
		dimensions: image[2],
		order: image[3] ? parseInt(image[3], 10) : undefined,
	}))
	const imageViewerItems = formattedImages.map((image, index) => ({
		url: image.url,
		title: `${title} - ${index + 1}`,
	}))

	const backgroundImageUrl = formattedImages[0]?.url || ''
	const heroClassName = `hero-bg-auction-detail-${auctionId.replace(/[^a-zA-Z0-9]/g, '')}`
	useHeroBackground(backgroundImageUrl, heroClassName)

	const startAt = getAuctionStartAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const reserve = getAuctionReserve(auction)
	const currency = getAuctionCurrency(auction)
	const auctionType = getAuctionType(auction)
	const categories = getAuctionCategories(auction)
	const trustedMints = getAuctionMints(auction)
	const pathIssuerPubkey = getAuctionPathIssuer(auction)
	const keyScheme = getAuctionKeyScheme(auction)
	const p2pkXpub = getAuctionP2pkXpub(auction)
	const settlementPolicy = getAuctionSettlementPolicy(auction)
	const schema = getAuctionSchema(auction)
	const shippingOptions = getAuctionShippingOptions(auction)
	const specs = getAuctionSpecs(auction)
	const refundTime = getAuctionMaxEndAt(auction) + getAuctionSettlementGrace(auction)
	const auctionDTag = getAuctionId(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = auctionDTag && auction ? `30408:${auction.pubkey}:${auctionDTag}` : ''

	const parsedShippingRefs = useMemo(() => getUniqueAuctionShippingRefs(shippingOptions), [shippingOptions])

	const shippingQueryResults = useQueries({
		queries: parsedShippingRefs.map((entry) => ({
			...shippingOptionByCoordinatesQueryOptions(entry.pubkey, entry.dTag),
			enabled: entry.status === 'valid',
		})),
	})

	const resolvedShippingOptions = useMemo(
		() =>
			parsedShippingRefs.map((entry, index) => {
				if (entry.status !== 'valid') {
					return { ...entry, event: null, info: null as ReturnType<typeof getShippingInfo> | null, isLoading: false, isNotFound: false }
				}
				const queryResult = shippingQueryResults[index]
				const event = queryResult?.data ?? null
				const info = event ? getShippingInfo(event) : null
				return {
					...entry,
					event,
					info,
					isLoading: (queryResult?.isLoading ?? false) && !queryResult?.data,
					isNotFound: !queryResult?.isLoading && !queryResult?.data,
				}
			}),
		[parsedShippingRefs, shippingQueryResults],
	)

	const { bids } = useStreamingAuctionBids(auctionRootEventId || auctionId, 500, auctionCoordinates)
	const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
	const countdown = useAuctionCountdown(biddingCutoffAt, { showSeconds: true })
	const ended = countdown.isEnded
	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const bidsCount = getAuctionBidCountFromBids(auction, bids)
	const minBid = Math.max(startingBid, currentPrice + Math.max(1, bidIncrement))
	const parsedBidAmount = parseInt(bidAmountInput || '0', 10)
	const newestBids = useMemo(() => [...bids].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)), [bids])
	const bidderStatus = useMemo(
		() =>
			getAuctionBidderStatus({
				currentUserPubkey: activeUserPubkey,
				auction,
				bids,
				isEnded: ended,
			}),
		[activeUserPubkey, auction, bids, ended],
	)

	const { data: oracleName } = useProfileName(pathIssuerPubkey || '')

	const sellerAuctionsQuery = useQuery({
		...auctionsByPubkeyQueryOptions(auction?.pubkey || '', 20),
		enabled: !!auction?.pubkey,
	})
	const moreFromSeller = useMemo(() => {
		const sellerEvents = sellerAuctionsQuery.data || []
		return filterNSFWAuctions(sellerEvents, true)
			.filter((item) => item.id !== auctionId)
			.slice(0, 5)
	}, [auctionId, sellerAuctionsQuery.data])

	// Settlement and claim order state
	const settlementsQuery = useAuctionSettlements(auctionRootEventId || auctionId, 10, auctionCoordinates)
	const latestSettlement = (settlementsQuery.data ?? [])[0] || null
	const settlementStatus = getAuctionSettlementStatus(latestSettlement)
	const settlementWinner = getAuctionSettlementWinner(latestSettlement)
	const settlementFinalAmount = getAuctionSettlementFinalAmount(latestSettlement)
	const isWinner = !!(currentUserPubkey && settlementWinner && currentUserPubkey === settlementWinner)

	const claimOrdersQuery = useAuctionClaimOrders(auctionCoordinates)
	const claimOrders = claimOrdersQuery.data ?? []
	const hasClaimOrder = claimOrders.some((order) => order.pubkey === currentUserPubkey)

	// -- Bidder-held-path settlement state -------------------------------
	// Under cashu_p2pk_bidder_path_v1 the bidder publishes a kind-1025
	// path release to enable the seller's redemption. We surface a
	// "Release path / Settle" button when the current user is the top
	// bidder, the auction has ended, and they haven't already released
	// (no kind-1025 from them on this auction yet).
	const pathReleasesQuery = useAuctionPathReleases(auctionRootEventId || auctionId, 200, auctionCoordinates)
	const pathReleases = pathReleasesQuery.data ?? []
	const queryClient = useQueryClient()

	const myTopBidEvent = useMemo(() => {
		if (!activeUserPubkey) return null
		const mine = bids.filter((b) => b.pubkey === activeUserPubkey)
		if (!mine.length) return null
		return mine.reduce(
			(best, bid) => {
				if (!best) return bid
				const delta = getBidAmount(bid) - getBidAmount(best)
				if (delta > 0) return bid
				if (delta < 0) return best
				return (bid.created_at ?? 0) < (best.created_at ?? 0) ? bid : best
			},
			mine[0] as (typeof mine)[0] | null,
		)
	}, [bids, activeUserPubkey])

	const topBidOverall = useMemo(() => {
		if (!bids.length) return null
		return bids.reduce(
			(best, bid) => {
				if (!best) return bid
				const delta = getBidAmount(bid) - getBidAmount(best)
				if (delta > 0) return bid
				if (delta < 0) return best
				return (bid.created_at ?? 0) < (best.created_at ?? 0) ? bid : best
			},
			bids[0] as (typeof bids)[0] | null,
		)
	}, [bids])

	const bidderSummaries = useMemo(() => {
		const summariesByPubkey = new Map<string, AuctionParticipantSummary>()
		const currentLeaderPubkey = topBidOverall?.pubkey || ''

		for (const bid of newestBids) {
			if (!bid.pubkey) continue

			const amount = getBidAmount(bid)
			const timestamp = bid.created_at || 0
			const existing = summariesByPubkey.get(bid.pubkey)

			if (!existing) {
				summariesByPubkey.set(bid.pubkey, {
					pubkey: bid.pubkey,
					visibleBidCount: 1,
					highestVisibleBidAmount: amount,
					latestVisibleBidTimestamp: timestamp,
					latestBidEventId: bid.id,
					isCurrentLeader: bid.pubkey === currentLeaderPubkey,
					isSettlementWinner: bid.pubkey === settlementWinner,
				})
				continue
			}

			existing.visibleBidCount += 1
			existing.highestVisibleBidAmount = Math.max(existing.highestVisibleBidAmount, amount)

			const isNewerBid =
				timestamp > existing.latestVisibleBidTimestamp ||
				(timestamp === existing.latestVisibleBidTimestamp && bid.id > existing.latestBidEventId)
			if (isNewerBid) {
				existing.latestVisibleBidTimestamp = timestamp
				existing.latestBidEventId = bid.id
			}
		}

		return [...summariesByPubkey.values()].sort((a, b) => {
			if (a.isCurrentLeader !== b.isCurrentLeader) return a.isCurrentLeader ? -1 : 1

			const latestBidDelta = b.latestVisibleBidTimestamp - a.latestVisibleBidTimestamp
			if (latestBidDelta !== 0) return latestBidDelta

			return a.pubkey.localeCompare(b.pubkey)
		})
	}, [newestBids, settlementWinner, topBidOverall?.pubkey])

	const isMyBidTop = !!(myTopBidEvent && topBidOverall && myTopBidEvent.id === topBidOverall.id)
	const myAlreadyReleased = useMemo(() => {
		if (!myTopBidEvent) return false
		return pathReleases.some((pr) => pr.tags.find((t) => t[0] === 'e')?.[1] === myTopBidEvent.id)
	}, [pathReleases, myTopBidEvent])
	const canReleaseNow = !!(isMyBidTop && ended && !myAlreadyReleased && myTopBidEvent && findBidderRecord(myTopBidEvent.id))
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
			await queryClient.invalidateQueries({ queryKey: auctionKeys.pathReleases(auctionRootEventId || auctionId) })
		} catch (err) {
			toast.error(`Failed to release path: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			setIsReleasing(false)
		}
	}

	useEffect(() => {
		setBidAmountInput(String(minBid))
	}, [minBid])

	useEffect(() => {
		const checkIfOwnAuction = async () => {
			if (!auction) return
			const user = await ndkActions.getUser()
			if (!user?.pubkey) return
			setCurrentUserPubkey(user.pubkey)
			setIsOwnAuction(user.pubkey === auction.pubkey)
		}

		checkIfOwnAuction()
	}, [auction])

	const handleImageClick = (index: number) => {
		setSelectedImageIndex(index)
		setImageViewerOpen(true)
	}

	if (!auction && (auctionQuery.isLoading || auctionQuery.isFetching)) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
				<div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
				<p className="text-muted-foreground">Loading auction...</p>
			</div>
		)
	}

	if (!auction && auctionQuery.isError) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
				<h1 className="text-2xl font-bold">Still loading auction</h1>
				<p className="text-gray-600">{auctionQuery.error instanceof Error ? auctionQuery.error.message : 'Please try again.'}</p>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button variant="secondary" onClick={() => auctionQuery.refetch()}>
						Retry
					</Button>
					<Link to="/auctions" className="inline-flex">
						<Button variant="outline">Back to auctions</Button>
					</Link>
				</div>
			</div>
		)
	}

	if (!auction) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
				<h1 className="text-2xl font-bold">Auction Not Found</h1>
				<p className="text-gray-600">The auction you are looking for does not exist yet on connected relays.</p>
				<Link to="/auctions" className="inline-flex">
					<Button variant="outline">Back to auctions</Button>
				</Link>
			</div>
		)
	}

	if (isNSFWAuction(auction) && !showNSFWContent) {
		return (
			<div className="flex h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
				<h1 className="text-2xl font-bold">Adult Content</h1>
				<p className="text-gray-600 max-w-md">This auction is marked as adult content. Enable adult content to view it.</p>
				<Link to="/auctions" className="inline-flex">
					<Button variant="outline">Back to auctions</Button>
				</Link>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="relative z-10">
				<div className={`relative dark hero-container-product ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay" />
					</div>

					<div className="hero-content-product">
						<Link to="/auctions" className="back-button col-span-full">
							<ArrowLeft className="h-4 w-6" />
							<span>Back to auctions</span>
						</Link>

						<div className="hero-image-container">
							<ImageCarousel images={formattedImages} title={title} onImageClick={handleImageClick} />
						</div>

						<div className="flex flex-col gap-2 text-white w-full max-w-[600px] mx-auto lg:max-w-none">
							<div className="flex items-center justify-between gap-4">
								<h1 className="text-3xl font-semibold">{title}</h1>
								<div className="flex items-center gap-2 flex-shrink-0">
									<div className={`flex items-center text-xs font-bold px-2 h-6 rounded ${ended ? 'bg-zinc-700' : 'bg-green-600'}`}>
										{ended ? 'ENDED' : 'LIVE'}
									</div>
									{trustedMints.length > 0 && (
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="relative flex items-center text-white/80 bg-black/30 border border-white/20 rounded px-2 h-6 cursor-default">
													<Landmark className="h-3 w-3 text-primary" />
													<span className="absolute -bottom-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-pink-500 text-[9px] font-bold leading-none text-white">
														{trustedMints.length}
													</span>
												</div>
											</TooltipTrigger>
											<TooltipContent side="top">
												<p className="font-semibold mb-1">
													{trustedMints.length} trusted {trustedMints.length === 1 ? 'mint' : 'mints'}
												</p>
												<ul className="list-disc pl-4 space-y-0.5">
													{trustedMints.map((mint) => (
														<li key={mint} className="text-xs opacity-80 break-all">
															{mint}
														</li>
													))}
												</ul>
											</TooltipContent>
										</Tooltip>
									)}
									{pathIssuerPubkey && (
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="relative cursor-default">
													<AvatarUser pubkey={pathIssuerPubkey} />
													<span className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-blue-500">
														<Check className="h-2 w-2 text-white stroke-[3]" />
													</span>
												</div>
											</TooltipTrigger>
											<TooltipContent side="top">
												<p className="text-[10px] font-semibold uppercase tracking-wide opacity-60 mb-1">Validator</p>
												{oracleName && <p className="font-semibold">{oracleName}</p>}
												<p className="text-xs opacity-70 font-mono break-all">{shortenHex(pathIssuerPubkey, 10, 8)}</p>
											</TooltipContent>
										</Tooltip>
									)}
								</div>
							</div>

							<span>Posted by</span>
							<UserCard pubkey={auction.pubkey} size="md" />

							<div className="text-lg">{summary || 'No summary provided.'}</div>

							<div className="grid grid-cols-2 gap-3 text-sm">
								<div className="bg-black/35 border border-white/20 rounded p-2">
									<div className="text-white/70 text-xs">{ended ? 'Final price' : 'Current price'}</div>
									<div className="font-semibold">{currentPrice.toLocaleString()} sats</div>
								</div>
								<div className="bg-black/35 border border-white/20 rounded p-2">
									<div className="text-white/70 text-xs">Bids</div>
									<div className="font-semibold">{bidsCount}</div>
								</div>
							</div>
							<div className="w-full">
								<AuctionCountdown auction={auction} bids={bids} />
							</div>

							<div className="flex flex-row justify-between">
								{bidderStatus && (
									<div
										aria-live="polite"
										className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-semibold ${detailBidderStatusClassName(
											bidderStatus.status,
										)}`}
									>
										{bidderStatus.label}
									</div>
								)}
								{!ended && <span className="text-foreground/80 text-end">{formatAuctionEndTimeLabel(biddingCutoffAt, false)}</span>}
							</div>
							<AuctionBidder auction={auction} currentUserPubkey={activeUserPubkey} bids={bids} />
							<AuctionSettlement auction={auction} bids={bids} className="mt-2" />
						</div>
					</div>
				</div>
			</div>

			{/* Bidder settle action — shown to the top bidder once the auction ends
			    so they can publish their kind-1025 path release. The seller can't
			    redeem (and therefore can't publish kind-1024) until this lands. */}
			{canReleaseNow && (
				<div className="mx-auto w-full max-w-7xl px-4">
					<div className="rounded-xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
						<div className="flex flex-wrap items-center justify-between gap-4">
							<div className="flex items-center gap-3">
								<div className="rounded-full bg-sky-100 p-2">
									<Gavel className="h-5 w-5 text-sky-700" />
								</div>
								<div>
									<h3 className="text-lg font-semibold text-sky-950">You won — release your path to settle</h3>
									<p className="text-sm text-sky-800">
										Bid: <span className="font-semibold">{getBidAmount(myTopBidEvent!).toLocaleString()} sats</span>. Publishing your
										kind-1025 reveals the derivation path so the seller can redeem your locked proofs.
									</p>
								</div>
							</div>
							<Button onClick={() => void handleReleasePath()} disabled={isReleasing}>
								{isReleasing ? 'Releasing…' : 'Release path & settle'}
							</Button>
						</div>
					</div>
				</div>
			)}
			{isMyBidTop && ended && myAlreadyReleased && settlementStatus !== 'settled' && (
				<div className="mx-auto w-full max-w-7xl px-4">
					<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
						Path release published — waiting for seller to redeem and publish settlement.
					</div>
				</div>
			)}

			{/* Winner banner — shown to the auction winner after settlement */}
			{isWinner && settlementStatus === 'settled' && (
				<div className="mx-auto w-full max-w-7xl px-4">
					<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
						<div className="flex flex-wrap items-center justify-between gap-4">
							<div className="flex items-center gap-3">
								<div className="rounded-full bg-emerald-100 p-2">
									<Trophy className="h-5 w-5 text-emerald-700" />
								</div>
								<div>
									<h3 className="text-lg font-semibold text-emerald-950">You won this auction!</h3>
									<p className="text-sm text-emerald-800">
										Final price: <span className="font-semibold">{settlementFinalAmount.toLocaleString()} sats</span>
									</p>
								</div>
							</div>
							{hasClaimOrder ? (
								<div className="rounded-lg border border-emerald-300 bg-background px-4 py-2 text-sm font-medium text-emerald-800">
									Shipping details submitted — awaiting seller
								</div>
							) : (
								<Button onClick={() => setClaimDialogOpen(true)}>Submit Shipping Address</Button>
							)}
						</div>
					</div>
				</div>
			)}

			<div className="mx-auto w-full max-w-7xl px-4 py-6">
				<Tabs defaultValue="overview" className="w-full">
					<TabsList className="w-full h-auto flex flex-wrap justify-start gap-2 bg-transparent p-0">
						<TabsTrigger
							value="overview"
							className="rounded-none px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black"
						>
							Overview
						</TabsTrigger>
						<TabsTrigger
							value="description"
							className="rounded-none px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black"
						>
							Description
						</TabsTrigger>
						<TabsTrigger
							value="shipping"
							className="rounded-none px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black"
						>
							Shipping
						</TabsTrigger>
						<TabsTrigger
							value="details"
							className="rounded-none px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black"
						>
							Auction Details
						</TabsTrigger>
						<TabsTrigger
							value="comments"
							className="rounded-none px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black"
						>
							Comments
						</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
							{/* Latest Bids Container */}
							<div className="rounded-lg bg-background p-6 shadow-md">
								<h2 className="text-xl font-semibold text-foreground mb-4">Latest Bids</h2>

								<AuctionBidsContainer
									auctionRootEventId={auctionRootEventId || auctionId}
									auctionCoordinates={auctionCoordinates}
									currentUserPubkey={activeUserPubkey}
									isEnded={ended}
									className="max-h-[500px]"
								/>

								{/* <AuctionVerdictPanel auctionRootEventId={auctionRootEventId || auctionId} auctionCoordinate={auctionCoordinates} /> */}
							</div>

							{/* Live Chat Panel */}
							<div className="rounded-lg bg-background p-6 shadow-md">
								<div className="flex items-center">
									<Radio className="mr-2 size-6" />
									<h2 className="text-xl font-semibold text-foreground">Live Chat</h2>
								</div>
								<div className="h-125">
									<LiveChatPanel auctionEvent={auction} />
								</div>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="description" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="space-y-6 rounded-lg bg-background p-6 shadow-md">
							<h2 className="text-xl font-semibold text-foreground mb-4">Description</h2>
							<section className="rounded-xl border border-zinc-200 bg-background px-5 py-5 shadow-sm">
								<h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Description</h2>
								{summary && <p className="mt-3 border-b border-zinc-200 pb-4 text-sm italic text-muted-foreground">{summary}</p>}
								{description ? (
									<p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-700">{description}</p>
								) : (
									<div className="mt-4">
										<AuctionEmptyState
											title="No description provided."
											description="The seller has not added a full description for this auction."
										/>
									</div>
								)}
							</section>

							<div className="grid gap-4 lg:grid-cols-2">
								<section className="rounded-xl border border-zinc-200 bg-background px-5 py-5 shadow-sm">
									<h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Specifications</h2>
									{specs.length > 0 ? (
										<dl className="mt-4 divide-y divide-zinc-200">
											{specs.map((spec, index) => (
												<div key={`${spec.key}-${index}`} className="flex items-start justify-between gap-4 py-2">
													<dt className="text-sm font-medium text-muted-foreground">{spec.key}</dt>
													<dd className="text-sm font-semibold text-right text-zinc-900 break-words">{spec.value}</dd>
												</div>
											))}
										</dl>
									) : (
										<div className="mt-4">
											<AuctionEmptyState title="No specifications listed." />
										</div>
									)}
								</section>

								<section className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
									<div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
										<Gavel className="h-4 w-4" />
										<h2>Categories</h2>
									</div>
									<div className="mt-4 flex flex-wrap gap-2">
										{categories.length > 0 ? (
											categories.map((category) => (
												<span
													key={category}
													className="rounded-full border border-zinc-300 bg-background px-3 py-1.5 text-xs font-semibold text-zinc-700"
												>
													{category}
												</span>
											))
										) : (
											<p className="text-sm text-muted-foreground">No categories listed.</p>
										)}
									</div>
								</section>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="shipping" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="space-y-5 rounded-lg bg-background p-6 shadow-md">
							<h2 className="text-xl font-semibold text-foreground mb-4">Shipping</h2>
							{resolvedShippingOptions.length > 0 ? (
								<ul className="space-y-4">
									{resolvedShippingOptions.map((option, index) => (
										<AuctionShippingOptionCard key={`${option.shippingRef}-${index}`} option={option} auctionCurrency={currency} />
									))}
								</ul>
							) : (
								<AuctionEmptyState
									title="No shipping options listed."
									description="The seller has not attached any shipping options to this auction."
								/>
							)}
						</div>
					</TabsContent>

					<TabsContent value="details" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="space-y-5 rounded-lg bg-background p-6 shadow-md">
							<h2 className="text-xl font-semibold text-foreground mb-4">Auction Details</h2>
							<AuctionTimelineChart bids={bids} auction={auction} />

							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<h2 className="text-xl font-semibold text-foreground">Participants</h2>
									<p className="mt-1 text-sm text-muted-foreground">Read-only identities visible from this auction and its visible bids.</p>
								</div>
								<Badge variant="outline" className="border-zinc-300 bg-zinc-50 text-zinc-700">
									{bidderSummaries.length} visible {bidderSummaries.length === 1 ? 'bidder' : 'bidders'}
								</Badge>
							</div>

							<div className="grid gap-4 lg:grid-cols-2">
								<section className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
									<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Seller</p>
									<div className="mt-4 flex flex-wrap items-center gap-3">
										<UserCard pubkey={auction.pubkey} />
									</div>
								</section>

								<section className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
									<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current leading bidder</p>
									{topBidOverall ? (
										<div className="mt-4 space-y-3">
											<div className="flex flex-wrap items-center gap-3">
												<UserCard pubkey={topBidOverall.pubkey} />
											</div>
											<ShopperInfoRow label="Highest visible bid" value={formatSats(getBidAmount(topBidOverall))} />
										</div>
									) : (
										<div className="mt-4">
											<AuctionEmptyState title="No visible bidders yet" />
										</div>
									)}
								</section>
							</div>

							{settlementWinner && (
								<section className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-5">
									<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Settlement winner</p>
									<div className="mt-4 flex flex-wrap items-center gap-3">
										<UserCard pubkey={settlementWinner} />
									</div>
									{settlementFinalAmount > 0 && (
										<div className="mt-4">
											<ShopperInfoRow label="Final amount" value={formatSats(settlementFinalAmount)} />
										</div>
									)}
								</section>
							)}

							<section className="space-y-4">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<h3 className="text-lg font-semibold text-foreground">Visible bidders</h3>
									<span className="text-sm text-muted-foreground">{bidderSummaries.length} unique</span>
								</div>

								{bidderSummaries.length === 0 ? (
									<AuctionEmptyState title="No visible bidders yet" />
								) : (
									<div className="grid gap-4 lg:grid-cols-2">
										{bidderSummaries.map((summary) => (
											<div key={summary.pubkey} className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-4">
												<div className="flex flex-wrap items-start justify-between gap-3">
													<div className="flex flex-wrap items-center gap-3">
														<UserCard pubkey={summary.pubkey} />
													</div>
													<div className="flex flex-wrap justify-end gap-2">
														{summary.isCurrentLeader && (
															<Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
																Current leading bidder
															</Badge>
														)}
														{summary.isSettlementWinner && (
															<Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
																Settlement winner
															</Badge>
														)}
													</div>
												</div>

												<div className="mt-4 space-y-1">
													<ShopperInfoRow label="Highest visible bid" value={formatSats(summary.highestVisibleBidAmount)} />
													<ShopperInfoRow label="Visible bids" value={String(summary.visibleBidCount)} />
													<ShopperInfoRow label="Latest visible bid" value={formatMaybeDate(summary.latestVisibleBidTimestamp)} />
												</div>
											</div>
										))}
									</div>
								)}
							</section>
						</div>
					</TabsContent>

					<TabsContent value="comments" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="rounded-lg bg-background p-6 shadow-md">
							<h2 className="text-xl font-semibold text-foreground mb-4">Comments</h2>
							<Comments targetEvent={auction} entityLabel="auction" testId="auction-comments" />
						</div>
					</TabsContent>
				</Tabs>
			</div>

			{moreFromSeller.length > 0 && (
				<div className="flex flex-col gap-4 p-4">
					<h2 className="font-heading text-2xl text-center lg:text-left">More from this seller</h2>
					<ItemGrid className="gap-4 sm:gap-6">
						{moreFromSeller.map((item) => (
							<AuctionCard key={item.id} auction={item} />
						))}
					</ItemGrid>
				</div>
			)}

			<ImageViewerModal
				isOpen={imageViewerOpen}
				onClose={() => setImageViewerOpen(false)}
				images={imageViewerItems}
				currentIndex={selectedImageIndex}
				onIndexChange={setSelectedImageIndex}
			/>
		</div>
	)
}
