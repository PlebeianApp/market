import { AuctionCard } from '@/components/AuctionCard'
import { AuctionFilters, defaultAuctionFilters, type AuctionFilterState } from '@/components/AuctionFilters'
import { ItemGrid } from '@/components/ItemGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { uiStore } from '@/lib/stores/ui'
import { uiActions } from '@/lib/stores/ui'
import {
	auctionByATagQueryOptions,
	auctionsQueryOptions,
	filterNSFWAuctions,
	getAuctionCategories,
	getAuctionEndAt,
	getAuctionImages,
	getAuctionStartingBid,
	getAuctionTitle,
} from '@/queries/auctions'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedAuctions } from '@/queries/featured'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

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

function useFeaturedAuctionEvents(featuredAuctions: string[] | undefined) {
	const queries = (featuredAuctions || []).map((auctionCoords) => {
		const [, pubkey, dTag] = auctionCoords.split(':')
		return {
			...auctionByATagQueryOptions(pubkey, dTag),
			enabled: !!(pubkey && dTag),
		}
	})

	const results = useQueries({ queries })

	return results
		.filter((result) => !result.isLoading && result.data)
		.map((result) => result.data as NDKEvent)
		.filter((auction) => getAuctionImages(auction).length > 0)
}

const auctionsSearchSchema = z.object({
	tag: z.string().optional(),
})

export const Route = createFileRoute('/auctions/')({
	component: AuctionsRoute,
	validateSearch: auctionsSearchSchema,
})

function AuctionsRoute() {
	const navigate = useNavigate()
	const { tag } = Route.useSearch()
	const { isAuthenticated } = useStore(authStore)
	const { showNSFWContent } = useStore(uiStore)
	const [filters, setFilters] = useState<AuctionFilterState>(defaultAuctionFilters)

	const auctionsQuery = useQuery({
		...auctionsQueryOptions(500),
		// Match products behavior: keep retrying quickly until we have data,
		// then stop interval polling and rely on normal invalidation/refetch.
		refetchInterval: (query) => (query.state.data?.length ? false : 3000),
	})

	const auctions = filterNSFWAuctions((auctionsQuery.data ?? []) as NDKEvent[], showNSFWContent)

	const { data: config } = useConfigQuery()
	const { data: featuredAuctionsData } = useFeaturedAuctions(config?.appPublicKey || '')
	const featuredAuctionEvents = useFeaturedAuctionEvents(featuredAuctionsData?.featuredAuctions)

	const auctionsForSlides =
		featuredAuctionEvents.length > 0
			? featuredAuctionEvents
			: auctions.filter((auction) => getAuctionImages(auction).length > 0).slice(0, 4)

	const allTags = useMemo(() => {
		const tagSet = new Set<string>()
		auctions.forEach((auction) => {
			getAuctionCategories(auction).forEach((category) => tagSet.add(category))
		})
		return Array.from(tagSet)
	}, [auctions])

	const defaultTags: string[] = PRODUCT_CATEGORIES.filter((category) => allTags.includes(category))

	const filteredAndSortedAuctions = useMemo(() => {
		const now = Math.floor(Date.now() / 1000)
		let filtered = auctions

		if (tag) {
			filtered = filtered.filter((auction) => getAuctionCategories(auction).includes(tag))
		}

		if (!filters.showEnded) {
			filtered = filtered.filter((auction) => {
				const endAt = getAuctionEndAt(auction)
				return endAt > 0 && endAt > now
			})
		}

		const sorted = [...filtered]
		switch (filters.sort) {
			case 'oldest':
				sorted.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
				break
			case 'ending-soon':
				sorted.sort((a, b) => {
					const aEnd = getAuctionEndAt(a)
					const bEnd = getAuctionEndAt(b)
					const aEnded = aEnd > 0 && aEnd <= now
					const bEnded = bEnd > 0 && bEnd <= now
					if (aEnded !== bEnded) return aEnded ? 1 : -1
					return aEnd - bEnd
				})
				break
			case 'highest-starting-bid':
				sorted.sort((a, b) => getAuctionStartingBid(b) - getAuctionStartingBid(a))
				break
			case 'title-a-z':
				sorted.sort((a, b) => getAuctionTitle(a).localeCompare(getAuctionTitle(b)))
				break
			case 'newest':
			default:
				sorted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
				break
		}

		return sorted
	}, [auctions, filters, tag])

	const handleTagClick = (selectedTag: string) => {
		if (tag === selectedTag) {
			navigate({ to: '/auctions' })
		} else {
			navigate({ to: '/auctions', search: (prev: any) => ({ ...prev, tag: selectedTag }) })
		}
	}

	const handleClearFilter = () => {
		navigate({ to: '/auctions' })
	}

	const handleCreateAuction = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createAuction')
		} else {
			uiActions.openDialog('login')
		}
	}

	const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
	const touchStartX = useRef<number>(0)
	const touchEndX = useRef<number>(0)
	const minSwipeDistance = 50
	const totalSlides = 1 + auctionsForSlides.length

	useEffect(() => {
		if (totalSlides <= 1) return

		const interval = setInterval(() => {
			setCurrentSlideIndex((prev) => (prev + 1) % totalSlides)
		}, 8000)

		return () => clearInterval(interval)
	}, [totalSlides])

	const isHomepageSlide = currentSlideIndex === 0
	const currentAuction = isHomepageSlide ? null : auctionsForSlides[currentSlideIndex - 1]
	const currentAuctionId = currentAuction?.id
	const displayTitle = currentAuction ? getAuctionTitle(currentAuction) : 'Browse Auctions'
	const currentImages = currentAuction ? getAuctionImages(currentAuction) : []
	const backgroundImageUrl = !isHomepageSlide && currentImages.length > 0 ? currentImages[0][1] : ''
	const marketBackgroundImageUrl = '/images/market-background.jpg'

	const heroClassName = currentAuctionId ? `hero-bg-auctions-${currentAuctionId.replace(/[^a-zA-Z0-9]/g, '')}` : 'hero-bg-auctions-default'
	const marketHeroClassName = 'hero-bg-market-auctions'
	useHeroBackground(backgroundImageUrl, heroClassName)
	useHeroBackground(marketBackgroundImageUrl, marketHeroClassName)

	const handleDotClick = (index: number) => {
		setCurrentSlideIndex(index)
	}

	const handleTouchStart = (e: React.TouchEvent) => {
		touchStartX.current = e.targetTouches[0].clientX
	}

	const handleTouchMove = (e: React.TouchEvent) => {
		touchEndX.current = e.targetTouches[0].clientX
	}

	const handleTouchEnd = () => {
		if (!touchStartX.current || !touchEndX.current) return

		const distance = touchStartX.current - touchEndX.current
		const isLeftSwipe = distance > minSwipeDistance
		const isRightSwipe = distance < -minSwipeDistance

		if (isLeftSwipe && currentSlideIndex < totalSlides - 1) {
			setCurrentSlideIndex((prev) => prev + 1)
		}

		if (isRightSwipe && currentSlideIndex > 0) {
			setCurrentSlideIndex((prev) => prev - 1)
		}

		touchStartX.current = 0
		touchEndX.current = 0
	}

	const renderHomepageHero = () => (
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-4 lg:mt-0">
			<div className="mb-2 h-40 lg:h-48 flex items-center justify-center">
				<Button variant="focus" size="lg" onClick={handleCreateAuction}>
					Create Auction
				</Button>
			</div>

			<div className="flex items-center justify-center h-16 lg:h-20">
				<h1 className="text-2xl lg:text-4xl font-theylive transition-opacity duration-500">Browse Auctions</h1>
			</div>

			{totalSlides > 1 && (
				<div className="flex justify-center gap-2">
					{Array.from({ length: totalSlides }).map((_, index) => (
						<button
							key={index}
							onClick={() => handleDotClick(index)}
							className={`w-3 h-3 rounded-full transition-all duration-300 ${
								index === currentSlideIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
							}`}
							aria-label={`View ${index === 0 ? 'homepage' : `auction ${index}`}`}
						/>
					))}
				</div>
			)}
		</div>
	)

	const renderAuctionHero = () => (
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-4 lg:mt-0">
			<div className="mb-2 w-40 h-40 lg:w-48 lg:h-48">
				{backgroundImageUrl && (
					<div className="relative w-full h-full overflow-hidden rounded-lg shadow-xl ring-2 ring-white/20">
						<img src={backgroundImageUrl} alt={displayTitle} className="w-full h-full object-cover" />
					</div>
				)}
			</div>

			<div className="flex items-center justify-center h-16 lg:h-20">
				<h1 className="text-2xl lg:text-4xl font-theylive transition-opacity duration-500">{displayTitle}</h1>
			</div>

			{totalSlides > 1 && (
				<div className="flex justify-center gap-2">
					{Array.from({ length: totalSlides }).map((_, index) => (
						<button
							key={index}
							onClick={() => handleDotClick(index)}
							className={`w-3 h-3 rounded-full transition-all duration-300 ${
								index === currentSlideIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
							}`}
							aria-label={`View ${index === 0 ? 'homepage' : `auction ${index}`}`}
						/>
					))}
				</div>
			)}
		</div>
	)

	return (
		<div>
			{isHomepageSlide ? (
				<div
					className={`relative hero-container-carousel ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-gray-700'}`}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10 opacity-40" />
						<div className="absolute inset-0 opacity-20 bg-dots-overlay z-10" />
					</div>
					<div className="hero-content">{renderHomepageHero()}</div>
				</div>
			) : (
				<div
					className={`relative hero-container-carousel ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-gray-700'}`}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10 opacity-40" />
						<div className="absolute inset-0 opacity-20 bg-dots-overlay z-10" />
					</div>
					<div className="hero-content">{renderAuctionHero()}</div>
				</div>
			)}

			<div className="sticky top-0 z-20 bg-off-black border-b shadow-sm">
				<div className="px-4 py-3 flex items-center justify-between gap-4">
					<div className="overflow-x-auto flex-1">
						<div className="flex items-center gap-2 min-w-max">
							<Badge variant={!tag ? 'primaryActive' : 'primary'} className="cursor-pointer transition-colors" onClick={handleClearFilter}>
								All
							</Badge>
							{defaultTags.map((tagName) => (
								<Badge
									key={tagName}
									variant={tag === tagName ? 'primaryActive' : 'primary'}
									className="cursor-pointer transition-colors"
									onClick={() => handleTagClick(tagName)}
								>
									{tagName}
								</Badge>
							))}
							{allTags
								.filter((tagName) => !defaultTags.includes(tagName))
								.slice(0, 12)
								.map((tagName) => (
									<Badge
										key={tagName}
										variant={tag === tagName ? 'primaryActive' : 'primary'}
										className="cursor-pointer transition-colors"
										onClick={() => handleTagClick(tagName)}
									>
										{tagName}
									</Badge>
								))}
						</div>
					</div>
					<AuctionFilters filters={filters} onFiltersChange={setFilters} />
				</div>
			</div>

			<div className="px-8 py-4">
				{auctionsQuery.isError && auctions.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-center gap-4 min-h-[40vh]">
						<h2 className="text-xl font-semibold">Unable to load auctions</h2>
						<p className="text-muted-foreground max-w-md">
							{auctionsQuery.error instanceof Error
								? auctionsQuery.error.message
								: 'There was a problem loading auctions. Please try again.'}
						</p>
						<Button variant="secondary" onClick={() => auctionsQuery.refetch()}>
							Retry
						</Button>
					</div>
				) : auctionsQuery.isLoading && auctions.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 min-h-[40vh]">
						<Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
						<p className="text-sm text-gray-500">Loading auctions...</p>
					</div>
				) : filteredAndSortedAuctions.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-center gap-2 min-h-[40vh]">
						<h2 className="text-xl font-semibold">No auctions found</h2>
						<p className="text-muted-foreground">Try adjusting your filters or check back soon.</p>
					</div>
				) : (
					<ItemGrid className="gap-4 sm:gap-8">
						{filteredAndSortedAuctions.map((auction) => (
							<AuctionCard key={auction.id} auction={auction} />
						))}
					</ItemGrid>
				)}
			</div>
		</div>
	)
}
