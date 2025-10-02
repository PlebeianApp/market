import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ItemGrid } from '@/components/ItemGrid'
import { Button } from '@/components/ui/button'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState, useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { collectionsQueryOptions } from '@/queries/collections.tsx'
import { useCollectionTitle, useCollectionImages, getCollectionTitle, getCollectionId } from '@/queries/collections'
import { CollectionCard } from '@/components/CollectionCard'

// Hook to inject dynamic CSS for background image
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

export const Route = createFileRoute('/community/')({
	component: CommunityRoute,
})

function CommunityRoute() {
	const collectionsQuery = useSuspenseQuery(collectionsQueryOptions)
	const collections = collectionsQuery.data

	const { isAuthenticated } = useStore(authStore)
	const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

	// Touch/swipe handling
	const touchStartX = useRef<number>(0)
	const touchEndX = useRef<number>(0)
	const minSwipeDistance = 50

	// Filter colections that have images, then limit to 4 for pagination
	const collectionsWithImages = collections.filter((collection) => {
		return collection.tags.some((tag) => tag[0] === 'image' && tag[1])
	})

	const recentCollections = collectionsWithImages.slice(0, 4) // Limit to 4 collections
	const totalSlides = 1 + recentCollections.length // Homepage + collections

	// Auto-slide functionality - change slide every 8 seconds
	useEffect(() => {
		if (totalSlides <= 1) return // Don't auto-slide if there's only one slide

		const interval = setInterval(() => {
			setCurrentSlideIndex((prev) => (prev + 1) % totalSlides)
		}, 8000) // 8 seconds

		return () => clearInterval(interval)
	}, [totalSlides])

	// Current slide data - homepage banner is now at index 1
	const isHomepageSlide = currentSlideIndex === 1
	const currentCollection = isHomepageSlide
		? null
		: currentSlideIndex === 0
			? recentCollections[0]
			: recentCollections[currentSlideIndex - 1]
	const currentCollectionId = currentCollection ? getCollectionId(currentCollection) : undefined

	// Get current collections data (only if not homepage slide)
	const { data: currentTitle } = useCollectionTitle(currentCollectionId || '')
	const { data: currentImages = [] } = useCollectionImages(currentCollectionId || '')

	// Get the actual title from the collection or fallback to empty string to avoid "Latest Collection"
	const displayTitle = currentTitle || (currentCollection ? getCollectionTitle(currentCollection) : '')

	// Get background image from current collection (only if not homepage slide)
	const backgroundImageUrl = !isHomepageSlide && currentImages.length > 0 ? currentImages[0][1] : ''

	// Use the market image for homepage background instead of random collection
	const marketBackgroundImageUrl = '/images/market-background.jpg'

	// Use the hook to inject dynamic CSS for the background image
	const heroClassName = currentCollectionId
		? `hero-bg-collections-${currentCollectionId.replace(/[^a-zA-Z0-9]/g, '')}`
		: 'hero-bg-collectionss-default'
	const marketHeroClassName = 'hero-bg-market'
	useHeroBackground(backgroundImageUrl, heroClassName)
	useHeroBackground(marketBackgroundImageUrl, marketHeroClassName)

	const handleStartSelling = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createCollection')
		} else {
			uiActions.openDialog('login')
		}
	}

	const handleDotClick = (index: number) => {
		setCurrentSlideIndex(index)
	}

	// Touch event handlers for swipe functionality
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
			// Swipe left - go to next slide
			setCurrentSlideIndex((prev) => prev + 1)
		}

		if (isRightSwipe && currentSlideIndex > 0) {
			// Swipe right - go to previous slide
			setCurrentSlideIndex((prev) => prev - 1)
		}

		// Reset touch positions
		touchStartX.current = 0
		touchEndX.current = 0
	}

	// Render homepage hero content
	const renderHomepageHero = () => (
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-16 lg:mt-0">
			<div className="flex items-center justify-center h-24 lg:h-32">
				<h1 className="text-4xl lg:text-5xl font-theylive transition-opacity duration-500">Browse Collections</h1>
			</div>

			<div className="flex flex-col gap-6">
				<Button variant="focus" size="lg" onClick={handleStartSelling}>
					<span className="flex items-center gap-2">
						<span className="i-nostr w-6 h-6"></span>Start Selling
					</span>
				</Button>

				{/* Pagination dots */}
				{totalSlides > 1 && (
					<div className="flex justify-center gap-2">
						{Array.from({ length: totalSlides }).map((_, index) => (
							<button
								key={index}
								onClick={() => handleDotClick(index)}
								className={`w-3 h-3 rounded-full transition-all duration-300 ${
									index === currentSlideIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
								}`}
								aria-label={`View ${index === 1 ? 'homepage' : `collection ${index === 0 ? 1 : index}`}`}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)

	// Render collections hero content
	const renderCollectionsHero = () => (
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-16 lg:mt-0">
			<div className="flex items-center justify-center h-24 lg:h-32">
				<h1 className="text-4xl lg:text-5xl font-theylive transition-opacity duration-500">{displayTitle || 'Loading...'}</h1>
			</div>

			<div className="flex flex-col gap-6">
				<Link to={`/collection/${currentCollectionId}`}>
					<Button variant="secondary" size="lg">
						View Collection
					</Button>
				</Link>

				{/* Pagination dots */}
				{totalSlides > 1 && (
					<div className="flex justify-center gap-2">
						{Array.from({ length: totalSlides }).map((_, index) => (
							<button
								key={index}
								onClick={() => handleDotClick(index)}
								className={`w-3 h-3 rounded-full transition-all duration-300 ${
									index === currentSlideIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
								}`}
								aria-label={`View ${index === 1 ? 'homepage' : `collection ${index === 0 ? 1 : index}`}`}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)

	return (
		<div>
			{isHomepageSlide ? (
				// Homepage hero styling with random collection background
				<div
					className={`relative hero-container ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-black'}`}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">{renderHomepageHero()}</div>
				</div>
			) : (
				// Collection hero styling (existing collection page style)
				<div
					className={`relative hero-container ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">{renderCollectionsHero()}</div>
				</div>
			)}

			<div className="px-8 py-4">
				<ItemGrid title="Collections">
					{collections.map((collection) => (
						<CollectionCard key={collection.id} collection={collection} />
					))}
				</ItemGrid>
				<ItemGrid title="Merchants">insert merchants here</ItemGrid>
			</div>
		</div>
	)
}
