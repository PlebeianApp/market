import { AuctionCard } from '@/components/AuctionCard'
import { AuctionClaimDialog } from '@/components/AuctionClaimDialog'
import { AuctionCountdown, useAuctionCountdown } from '@/components/AuctionCountdown'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { ImageCarousel } from '@/components/ImageCarousel'
import { ImageViewerModal } from '@/components/ImageViewerModal'
import { ItemGrid } from '@/components/ItemGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ndkActions } from '@/lib/stores/ndk'
import { uiStore } from '@/lib/stores/ui'
import { usePublishAuctionBidMutation } from '@/publish/auctions'
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
	getAuctionEffectiveEndAt,
	getAuctionCurrency,
	getAuctionEndAt,
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
	useAuctionBids,
	useAuctionClaimOrders,
	useAuctionSettlements,
} from '@/queries/auctions'
import { getShippingInfo, shippingOptionByCoordinatesQueryOptions } from '@/queries/shipping'
import { useQueries } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Gavel, Trophy, Truck, UserRound } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AvatarUser } from '@/components/AvatarUser'

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
		<div className="rounded-xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
			<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
			<p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">{value}</p>
			{helper && <p className="mt-2 text-sm leading-6 text-zinc-500">{helper}</p>}
		</div>
	)
}

function ShopperInfoRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-4 border-b border-zinc-200/80 py-3 last:border-b-0">
			<span className="text-sm font-medium text-zinc-500">{label}</span>
			<span className="text-sm font-semibold text-right text-zinc-950">{value}</span>
		</div>
	)
}

function TechnicalDataRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
			<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
			<div className="mt-1 break-all text-sm font-medium text-zinc-900">{value}</div>
		</div>
	)
}

export const Route = createFileRoute('/auctions/$auctionId')({
	component: AuctionDetailRoute,
})

function AuctionDetailRoute() {
	const { auctionId } = Route.useParams()
	const { showNSFWContent } = useStore(uiStore)
	const [selectedImageIndex, setSelectedImageIndex] = useState(0)
	const [imageViewerOpen, setImageViewerOpen] = useState(false)
	const [bidAmountInput, setBidAmountInput] = useState('')
	const [isOwnAuction, setIsOwnAuction] = useState(false)
	const [currentUserPubkey, setCurrentUserPubkey] = useState('')
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
	const endAt = getAuctionEndAt(auction)
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
	const auctionDTag = getAuctionId(auction)
	const auctionRootEventId = getAuctionRootEventId(auction)
	const auctionCoordinates = auctionDTag && auction ? `30408:${auction.pubkey}:${auctionDTag}` : ''

	const parsedShippingRefs = useMemo(
		() =>
			shippingOptions.map((item) => {
				const parts = item.shippingRef.split(':')
				if (parts.length === 3 && parts[0] === '30406') {
					return { ...item, pubkey: parts[1], dTag: parts[2] }
				}
				return { ...item, pubkey: '', dTag: '' }
			}),
		[shippingOptions],
	)

	const shippingQueryResults = useQueries({
		queries: parsedShippingRefs.map(({ pubkey, dTag }) => ({
			...shippingOptionByCoordinatesQueryOptions(pubkey, dTag),
			enabled: !!pubkey && !!dTag,
		})),
	})

	const resolvedShippingOptions = useMemo(
		() =>
			parsedShippingRefs.map((entry, index) => {
				const event = shippingQueryResults[index]?.data ?? null
				const info = event ? getShippingInfo(event) : null
				return { ...entry, info }
			}),
		[parsedShippingRefs, shippingQueryResults],
	)

	const bidsQuery = useAuctionBids(auctionRootEventId || auctionId, 500, auctionCoordinates)
	const bids = bidsQuery.data ?? []
	const effectiveEndAt = getAuctionEffectiveEndAt(auction, bids) || endAt
	const countdown = useAuctionCountdown(effectiveEndAt, { showSeconds: true })
	const ended = countdown.isEnded
	const currentPrice = getAuctionCurrentPriceFromBids(auction, bids, startingBid)
	const bidsCount = getAuctionBidCountFromBids(auction, bids)
	const minBid = Math.max(startingBid, currentPrice + Math.max(1, bidIncrement))
	const parsedBidAmount = parseInt(bidAmountInput || '0', 10)
	const newestBids = useMemo(() => [...bids].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)), [bids])

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

	const handleSubmitBid = async () => {
		if (!auction || !auctionCoordinates || ended || isOwnAuction) return

		const parsedAmount = parseInt(bidAmountInput || '0', 10)
		if (!Number.isFinite(parsedAmount) || parsedAmount < minBid) {
			toast.error(`Bid must be at least ${minBid.toLocaleString()} sats`)
			return
		}

		try {
			if (!pathIssuerPubkey) {
				toast.error('This auction is missing a path_issuer pubkey and cannot accept bids.')
				return
			}
			if (!p2pkXpub) {
				toast.error('This auction is missing a p2pk_xpub and cannot accept bids.')
				return
			}
			await bidMutation.mutateAsync({
				auctionEventId: auctionRootEventId || auction.id,
				auctionCoordinates,
				amount: parsedAmount,
				auctionEffectiveEndAt: effectiveEndAt,
				auctionLocktimeAt: getAuctionMaxEndAt(auction) || effectiveEndAt,
				sellerPubkey: auction.pubkey,
				pathIssuerPubkey,
				p2pkXpub,
				mint: trustedMints[0],
			})
		} catch {
			// Error toast is handled by mutation onError.
		}
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
				<div className={`relative hero-container-product ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}>
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

						<div className="flex flex-col gap-4 text-white w-full max-w-[600px] mx-auto lg:max-w-none">
							<div className="flex items-center justify-between gap-4">
								<h1 className="text-3xl font-semibold">{title}</h1>
								<div className={`text-xs font-bold px-2 py-1 rounded ${ended ? 'bg-zinc-700' : 'bg-green-600'}`}>
									{ended ? 'ENDED' : 'LIVE'}
								</div>
							</div>

							<div className="text-lg">{summary || 'No summary provided.'}</div>

							<div className="grid grid-cols-2 gap-3 text-sm">
								<div className="bg-black/35 border border-white/20 rounded p-2">
									<div className="text-white/70 text-xs">Current price</div>
									<div className="font-semibold">{currentPrice.toLocaleString()} sats</div>
								</div>
								<div className="bg-black/35 border border-white/20 rounded p-2">
									<div className="text-white/70 text-xs">Bids</div>
									<div className="font-semibold">{bidsCount}</div>
								</div>
								<div className="bg-black/35 border border-white/20 rounded p-2">
									<div className="text-white/70 text-xs">Ends at</div>
									<div className="font-semibold">{effectiveEndAt ? new Date(effectiveEndAt * 1000).toLocaleString() : 'N/A'}</div>
								</div>
								<AuctionCountdown endAt={effectiveEndAt} countdown={countdown} showSeconds variant="panel" label="Ends in" />
							</div>

							<div className="flex gap-2 items-center">
								<Input
									type="number"
									min={minBid}
									step={Math.max(1, bidIncrement)}
									value={bidAmountInput}
									onChange={(e) => setBidAmountInput(e.target.value)}
									className="bg-white text-black"
									disabled={ended || bidMutation.isPending}
								/>
								<Button
									onClick={() => void handleSubmitBid()}
									disabled={ended || isOwnAuction || bidMutation.isPending || !Number.isFinite(parsedBidAmount) || parsedBidAmount < minBid}
								>
									{isOwnAuction ? 'Your Auction' : ended ? 'Auction Ended' : bidMutation.isPending ? 'Submitting...' : 'Place Bid'}
								</Button>
							</div>
							<div className="text-xs text-white/80">Minimum allowed bid: {minBid.toLocaleString()} sats</div>
						</div>
					</div>
				</div>
			</div>

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
								<div className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-800">
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
							value="bids"
							className="rounded-none px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black"
						>
							Bids
						</TabsTrigger>
						<TabsTrigger
							value="seller"
							className="rounded-none px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black"
						>
							Seller
						</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="space-y-6 rounded-lg bg-white p-6 shadow-md">
							<div className="grid gap-4 lg:grid-cols-[1.25fr_0.95fr]">
								<div className="space-y-4">
									<div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
										<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Auction snapshot</p>
										<p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-700">{summary || 'No summary provided.'}</p>
										<div className="mt-4 flex flex-wrap gap-2">
											<Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700">
												{auctionType}
											</Badge>
											<Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700">
												{currency}
											</Badge>
											<Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700">
												{bidsCount} {bidsCount === 1 ? 'bid' : 'bids'}
											</Badge>
										</div>
									</div>

									<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
										<ShopperStat label="Current price" value={formatSats(currentPrice)} helper="The highest valid bid currently visible." />
										<ShopperStat label="Opening bid" value={formatSats(startingBid)} helper="Where the auction started." />
										<ShopperStat label="Bid increment" value={formatSats(bidIncrement)} helper="Minimum raise required between bids." />
										<ShopperStat
											label="Reserve"
											value={formatSats(reserve)}
											helper="Seller threshold that decides whether the winner can settle."
										/>
										<ShopperStat label="Starts" value={formatMaybeDate(startAt)} helper="Bidding window opening time." />
										<ShopperStat label="Ends" value={formatMaybeDate(effectiveEndAt)} helper="Effective bidding close time." />
									</div>
								</div>

								<div className="rounded-xl border border-zinc-200 bg-white px-5 py-5 shadow-sm">
									<div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
										<UserRound className="h-4 w-4" />
										Seller & fulfilment
									</div>
									<div className="mt-4 space-y-1">
										<ShopperInfoRow label="Seller" value={<AvatarUser pubkey={auction.pubkey} />} />
										<ShopperInfoRow
											label="Categories"
											value={
												categories.length > 0 ? (
													<span className="inline-flex flex-wrap justify-end gap-1.5">
														{categories.slice(0, 3).map((category) => (
															<span key={category} className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
																{category}
															</span>
														))}
													</span>
												) : (
													'None listed'
												)
											}
										/>
										<ShopperInfoRow
											label="Shipping options"
											value={shippingOptions.length > 0 ? `${shippingOptions.length} listed` : 'None listed'}
										/>
									</div>

									<Accordion type="single" collapsible className="mt-5 rounded-xl border border-zinc-200 px-4">
										<AccordionItem value="settlement" className="border-none">
											<AccordionTrigger className="py-4 text-sm font-semibold text-zinc-900 hover:no-underline">
												Settlement & technical details
											</AccordionTrigger>
											<AccordionContent className="space-y-3 pb-4">
												<TechnicalDataRow label="Path issuer" value={pathIssuerPubkey || 'N/A'} />
												<TechnicalDataRow label="Key scheme" value={keyScheme} />
												{p2pkXpub && <TechnicalDataRow label="P2PK xpub" value={p2pkXpub} />}
												<TechnicalDataRow label="Settlement policy" value={settlementPolicy || 'N/A'} />
												<TechnicalDataRow label="Schema" value={schema || 'N/A'} />
												<TechnicalDataRow
													label="Trusted mints"
													value={
														trustedMints.length > 0 ? (
															<ul className="space-y-1">
																{trustedMints.map((mint) => (
																	<li key={mint}>{mint}</li>
																))}
															</ul>
														) : (
															'No mints declared'
														)
													}
												/>
											</AccordionContent>
										</AccordionItem>
									</Accordion>
								</div>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="description" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="grid gap-6 rounded-lg bg-white p-6 shadow-md lg:grid-cols-[1.4fr_0.8fr]">
							<div className="space-y-4">
								<div className="rounded-xl border border-zinc-200 bg-white px-5 py-5 shadow-sm">
									<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Description</p>
									{summary && <p className="mt-3 border-b border-zinc-200 pb-4 text-sm italic text-zinc-500">{summary}</p>}
									<p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-700">
										{description || 'No description provided.'}
									</p>
								</div>

								{specs.length > 0 && (
									<div className="rounded-xl border border-zinc-200 bg-white px-5 py-5 shadow-sm">
										<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Specifications</p>
										<dl className="mt-4 divide-y divide-zinc-200">
											{specs.map((spec, index) => (
												<div key={`${spec.key}-${index}`} className="flex items-start justify-between gap-4 py-2">
													<dt className="text-sm font-medium text-zinc-500">{spec.key}</dt>
													<dd className="text-sm font-semibold text-right text-zinc-900 break-words">{spec.value}</dd>
												</div>
											))}
										</dl>
									</div>
								)}
							</div>

							<div className="space-y-4">
								<div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
									<div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
										<Gavel className="h-4 w-4" />
										Categories
									</div>
									<div className="mt-4 flex flex-wrap gap-2">
										{categories.length > 0 ? (
											categories.map((category) => (
												<span
													key={category}
													className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700"
												>
													{category}
												</span>
											))
										) : (
											<p className="text-sm text-zinc-500">No categories listed.</p>
										)}
									</div>
								</div>

								<div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
									<div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
										<Truck className="h-4 w-4" />
										Shipping options
									</div>
									<div className="mt-4">
										{resolvedShippingOptions.length > 0 ? (
											<ul className="space-y-2 text-sm text-zinc-700">
												{resolvedShippingOptions.map((option, index) => {
													const extraCostNumber = option.extraCost ? Number(option.extraCost) : 0
													const hasExtraCost = !Number.isNaN(extraCostNumber) && extraCostNumber > 0
													return (
														<li key={`${option.shippingRef}-${index}`} className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
															{option.info ? (
																<div className="space-y-1">
																	<p className="font-medium text-zinc-900">{option.info.title}</p>
																	<p className="text-xs text-zinc-600">
																		Base: {option.info.price.amount} {option.info.price.currency}
																		{option.info.service ? ` · ${option.info.service}` : ''}
																		{option.info.carrier ? ` · ${option.info.carrier}` : ''}
																	</p>
																	{hasExtraCost && <p className="text-xs text-zinc-600">Auction extra cost: {extraCostNumber}</p>}
																</div>
															) : (
																<p className="break-all text-xs text-zinc-500">{option.shippingRef}</p>
															)}
														</li>
													)
												})}
											</ul>
										) : (
											<p className="text-sm text-zinc-500">No shipping options listed.</p>
										)}
									</div>
								</div>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="bids" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="space-y-5 rounded-lg bg-white p-6 shadow-md">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<h2 className="text-xl font-semibold text-zinc-950">Live bids</h2>
									<p className="mt-1 text-sm text-zinc-500">
										Updates every 5 seconds. Bid amounts stay up front; event wiring lives behind each bid&apos;s details toggle.
									</p>
								</div>
								<Badge variant="outline" className="border-zinc-300 bg-zinc-50 text-zinc-700">
									{newestBids.length} recorded
								</Badge>
							</div>

							{newestBids.length === 0 ? (
								<div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6 text-sm text-zinc-500">
									No bids yet.
								</div>
							) : (
								<div className="space-y-4">
									{newestBids.map((bidEvent) => {
										const locktime = bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1]
										const bidKeyScheme = bidEvent.tags.find((tag) => tag[0] === 'key_scheme')?.[1] || 'hd_p2pk'
										return (
											<div key={bidEvent.id} className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-4">
												<div className="flex flex-wrap items-start justify-between gap-3">
													<div>
														<p className="text-2xl font-semibold tracking-tight text-zinc-950">{formatSats(getBidAmount(bidEvent))}</p>
														<p className="mt-1 text-sm text-zinc-500">
															Recorded {bidEvent.created_at ? new Date(bidEvent.created_at * 1000).toLocaleString() : 'at an unknown time'}
														</p>
													</div>
													<Badge variant="outline" className="border-zinc-300 bg-white text-zinc-700">
														{getBidStatus(bidEvent)}
													</Badge>
												</div>

												<div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-700">
													<AvatarUser pubkey={bidEvent.pubkey} />
													<span className="text-zinc-400">•</span>
													<span>{getBidMint(bidEvent) || 'No mint declared'}</span>
												</div>

												<Accordion type="single" collapsible className="mt-4 rounded-xl border border-zinc-200 bg-white px-4">
													<AccordionItem value={`bid-${bidEvent.id}`} className="border-none">
														<AccordionTrigger className="py-4 text-sm font-semibold text-zinc-900 hover:no-underline">
															Bid event details
														</AccordionTrigger>
														<AccordionContent className="space-y-3 pb-4">
															<TechnicalDataRow label="Bidder pubkey" value={bidEvent.pubkey} />
															<TechnicalDataRow label="Mint" value={getBidMint(bidEvent) || 'N/A'} />
															<TechnicalDataRow label="Key scheme" value={bidKeyScheme} />
															<TechnicalDataRow
																label="Locktime"
																value={locktime ? new Date(parseInt(locktime, 10) * 1000).toLocaleString() : 'N/A'}
															/>
															<TechnicalDataRow label="Bid event ID" value={bidEvent.id} />
														</AccordionContent>
													</AccordionItem>
												</Accordion>
											</div>
										)
									})}
								</div>
							)}
						</div>
					</TabsContent>

					<TabsContent value="seller" className="mt-4 border-t-3 border-secondary bg-tertiary">
						<div className="rounded-lg bg-white p-6 shadow-md">
							<div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-5">
								<div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
									<UserRound className="h-4 w-4" />
									Seller
								</div>
								<div className="mt-4">
									<AvatarUser pubkey={auction.pubkey} />
								</div>
								<div className="mt-5 space-y-1">
									<ShopperInfoRow label="Seller key" value={shortenHex(auction.pubkey)} />
									<ShopperInfoRow label="Auction status" value={ended ? 'Ended' : 'Live'} />
									<ShopperInfoRow label="Countdown" value={countdown.displayLabel} />
								</div>
							</div>
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

			{isWinner && latestSettlement && auction && (
				<AuctionClaimDialog
					open={claimDialogOpen}
					onOpenChange={setClaimDialogOpen}
					auctionEventId={auctionRootEventId || auction.id}
					auctionCoordinates={auctionCoordinates}
					settlementEventId={latestSettlement.id}
					sellerPubkey={auction.pubkey}
					finalAmount={settlementFinalAmount}
				/>
			)}
		</div>
	)
}
