import { AuctionCard } from '@/components/AuctionCard'
import { ImageCarousel } from '@/components/ImageCarousel'
import { ImageViewerModal } from '@/components/ImageViewerModal'
import { ItemGrid } from '@/components/ItemGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { ndkActions } from '@/lib/stores/ndk'
import { uiStore } from '@/lib/stores/ui'
import { usePublishAuctionBidMutation } from '@/publish/auctions'
import {
	auctionQueryOptions,
	auctionsByPubkeyQueryOptions,
	filterNSFWAuctions,
	getBidAmount,
	getBidMint,
	getBidStatus,
	getAuctionBidIncrement,
	getAuctionCategories,
	getAuctionCurrency,
	getAuctionEndAt,
	getAuctionEscrowPubkey,
	getAuctionId,
	getAuctionImages,
	getAuctionMints,
	getAuctionReserve,
	getAuctionSchema,
	getAuctionSettlementPolicy,
	getAuctionShippingOptions,
	getAuctionStartAt,
	getAuctionStartingBid,
	getAuctionSummary,
	getAuctionTitle,
	getAuctionType,
	isNSFWAuction,
	useAuctionBids,
	useAuctionBidStats,
} from '@/queries/auctions'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Clock, Gavel, Hash, Shield, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

function formatCountdown(secondsRemaining: number): string {
	if (secondsRemaining <= 0) return 'Ended'
	const days = Math.floor(secondsRemaining / 86400)
	const hours = Math.floor((secondsRemaining % 86400) / 3600)
	const minutes = Math.floor((secondsRemaining % 3600) / 60)
	const seconds = secondsRemaining % 60
	if (days > 0) return `${days}d ${hours}h ${minutes}m`
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
	return `${minutes}m ${seconds}s`
}

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
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
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
	const secondsRemaining = Math.max(0, endAt - now)
	const startingBid = getAuctionStartingBid(auction)
	const bidIncrement = getAuctionBidIncrement(auction)
	const reserve = getAuctionReserve(auction)
	const currency = getAuctionCurrency(auction)
	const auctionType = getAuctionType(auction)
	const categories = getAuctionCategories(auction)
	const trustedMints = getAuctionMints(auction)
	const escrowPubkey = getAuctionEscrowPubkey(auction)
	const settlementPolicy = getAuctionSettlementPolicy(auction)
	const schema = getAuctionSchema(auction)
	const shippingOptions = getAuctionShippingOptions(auction)
	const auctionDTag = getAuctionId(auction)
	const auctionCoordinates = auctionDTag && auction ? `30408:${auction.pubkey}:${auctionDTag}` : ''

	const ended = endAt > 0 ? now >= endAt : false
	const { data: bidStats } = useAuctionBidStats(auctionId, startingBid)
	const currentPrice = bidStats?.currentPrice ?? startingBid
	const bidsCount = bidStats?.count ?? 0
	const minBid = Math.max(startingBid, currentPrice + Math.max(1, bidIncrement))
	const parsedBidAmount = parseInt(bidAmountInput || '0', 10)

	const bidsQuery = useAuctionBids(auctionId, 500)
	const bids = bidsQuery.data ?? []
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

	useEffect(() => {
		const timer = window.setInterval(() => {
			setNow(Math.floor(Date.now() / 1000))
		}, 1000)
		return () => window.clearInterval(timer)
	}, [])

	useEffect(() => {
		setBidAmountInput(String(minBid))
	}, [minBid])

	useEffect(() => {
		const checkIfOwnAuction = async () => {
			if (!auction) return
			const user = await ndkActions.getUser()
			if (!user?.pubkey) return
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

		await bidMutation.mutateAsync({
			auctionEventId: auction.id,
			auctionCoordinates,
			amount: parsedAmount,
			mint: trustedMints[0],
		})
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
									<div className="font-semibold">{endAt ? new Date(endAt * 1000).toLocaleString() : 'N/A'}</div>
								</div>
								<div className="bg-black/35 border border-white/20 rounded p-2">
									<div className="text-white/70 text-xs">Countdown</div>
									<div className="font-semibold">{formatCountdown(secondsRemaining)}</div>
								</div>
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

			<div className="px-4 lg:px-8 py-4 space-y-6">
				<div className="bg-white border border-zinc-800 rounded-lg p-4">
					<h2 className="text-lg font-semibold mb-3">Description</h2>
					<p className="text-sm text-gray-700 whitespace-pre-wrap">{description || 'No description provided.'}</p>
				</div>

				<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					<div className="bg-white border border-zinc-800 rounded-lg p-4">
						<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
							<Hash className="w-4 h-4" />
							Auction Details
						</h2>
						<div className="space-y-2 text-sm">
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Type</span>
								<span className="font-medium">{auctionType}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Currency</span>
								<span className="font-medium">{currency}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Starting bid</span>
								<span className="font-medium">{startingBid.toLocaleString()} sats</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Bid increment</span>
								<span className="font-medium">{bidIncrement.toLocaleString()} sats</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Reserve</span>
								<span className="font-medium">{reserve.toLocaleString()} sats</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Start time</span>
								<span className="font-medium">{startAt ? new Date(startAt * 1000).toLocaleString() : 'N/A'}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">End time</span>
								<span className="font-medium">{endAt ? new Date(endAt * 1000).toLocaleString() : 'N/A'}</span>
							</div>
						</div>
					</div>

					<div className="bg-white border border-zinc-800 rounded-lg p-4">
						<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
							<Shield className="w-4 h-4" />
							Settlement & Metadata
						</h2>
						<div className="space-y-2 text-sm">
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Escrow pubkey</span>
								<span className="font-medium break-all">{escrowPubkey || 'N/A'}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Settlement policy</span>
								<span className="font-medium">{settlementPolicy || 'N/A'}</span>
							</div>
							<div className="flex justify-between gap-3">
								<span className="text-gray-500">Schema</span>
								<span className="font-medium">{schema || 'N/A'}</span>
							</div>
							<div className="pt-2">
								<div className="text-gray-500 mb-1 flex items-center gap-2">
									<Wallet className="w-4 h-4" />
									Trusted mints
								</div>
								{trustedMints.length === 0 ? (
									<div className="text-gray-600">No mints declared</div>
								) : (
									<ul className="list-disc list-inside space-y-1 text-gray-700">
										{trustedMints.map((mint) => (
											<li key={mint} className="break-all">
												{mint}
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					</div>
				</div>

				<div className="bg-white border border-zinc-800 rounded-lg p-4">
					<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
						<Clock className="w-4 h-4" />
						Live Bids
					</h2>
					<p className="text-xs text-gray-500 mb-3">Updates every 5 seconds.</p>
					{newestBids.length === 0 ? (
						<div className="text-sm text-gray-600">No bids yet.</div>
					) : (
						<div className="space-y-2">
							{newestBids.map((bidEvent) => (
								<div key={bidEvent.id} className="border rounded p-3 bg-zinc-50">
									<div className="flex items-center justify-between gap-2">
										<div className="font-semibold">{getBidAmount(bidEvent).toLocaleString()} sats</div>
										<div className="text-xs uppercase bg-zinc-200 px-2 py-0.5 rounded">{getBidStatus(bidEvent)}</div>
									</div>
									<div className="mt-2 text-xs text-gray-600 flex flex-col gap-1">
										<div className="flex items-center gap-2">
											<span className="text-gray-500">Bidder:</span>
											<UserWithAvatar pubkey={bidEvent.pubkey} size="sm" disableLink={true} />
										</div>
										<div>
											<span className="text-gray-500">Mint:</span> {getBidMint(bidEvent) || 'N/A'}
										</div>
										<div>
											<span className="text-gray-500">Time:</span>{' '}
											{bidEvent.created_at ? new Date(bidEvent.created_at * 1000).toLocaleString() : 'N/A'}
										</div>
										<div className="break-all">
											<span className="text-gray-500">Bid event:</span> {bidEvent.id}
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				<div className="bg-white border border-zinc-800 rounded-lg p-4">
					<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
						<Gavel className="w-4 h-4" />
						Other Info
					</h2>
					<div className="space-y-3 text-sm">
						<div>
							<div className="text-gray-500 mb-1">Categories</div>
							<div className="flex flex-wrap gap-2">
								{categories.length > 0
									? categories.map((category) => (
											<span key={category} className="px-2 py-1 bg-gray-100 rounded">
												{category}
											</span>
										))
									: 'No categories'}
							</div>
						</div>
						<div>
							<div className="text-gray-500 mb-1">Shipping options</div>
							{shippingOptions.length > 0 ? (
								<ul className="list-disc list-inside text-gray-700">
									{shippingOptions.map((option) => (
										<li key={option} className="break-all">
											{option}
										</li>
									))}
								</ul>
							) : (
								<div className="text-gray-600">No shipping options listed</div>
							)}
						</div>
						<div>
							<div className="text-gray-500 mb-1">Seller</div>
							<UserWithAvatar pubkey={auction.pubkey} />
						</div>
					</div>
				</div>

				{moreFromSeller.length > 0 && (
					<div>
						<h2 className="text-xl font-semibold mb-4">More from this seller</h2>
						<ItemGrid className="gap-4 sm:gap-8">
							{moreFromSeller.map((item) => (
								<AuctionCard key={item.id} auction={item} />
							))}
						</ItemGrid>
					</div>
				)}
			</div>

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
