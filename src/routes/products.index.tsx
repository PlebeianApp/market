import { InfiniteProductList } from '@/components/InfiniteProductList'
import { ItemGrid } from '@/components/ItemGrid'
import { ProductCard } from '@/components/ProductCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { uiActions } from '@/lib/stores/ui'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import {
	getProductCategories,
	getProductTitle,
	productByATagQueryOptions,
	productsQueryOptions,
	useProductImages,
	useProductTitle,
} from '../queries/products'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedProducts } from '@/queries/featured'

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

// Hook to fetch featured product events using useQueries
function useFeaturedProductEvents(featuredProducts: string[] | undefined) {
	const queries = (featuredProducts || []).map((productCoords) => {
		const [, pubkey, dTag] = productCoords.split(':')
		return {
			...productByATagQueryOptions(pubkey, dTag),
			enabled: !!(pubkey && dTag),
		}
	})

	const results = useQueries({ queries })

	// Filter out loading and null products, return only loaded products
	return results
		.filter((result) => !result.isLoading && result.data)
		.map((result) => result.data as NDKEvent)
		.filter((product) => {
			// Only include products with images
			return product.tags.some((tag: string[]) => tag[0] === 'image' && tag[1])
		})
}

const productsSearchSchema = z.object({
	tag: z.string().optional(),
})

export const Route = createFileRoute('/products/')({
	component: ProductsRoute,
	validateSearch: productsSearchSchema,
})

function ProductsRoute() {
	const navigate = useNavigate()
	const { tag } = Route.useSearch()
	const productsQuery = useSuspenseQuery(productsQueryOptions(500, tag))
	const products = productsQuery.data as NDKEvent[]

	const { isAuthenticated } = useStore(authStore)

	// Fetch featured products for slides
	const { data: config } = useConfigQuery()
	const { data: featuredProductsData } = useFeaturedProducts(config?.appPublicKey || '')
	const featuredProductEvents = useFeaturedProductEvents(featuredProductsData?.featuredProducts)

	// Use featured products for slides, fallback to recent products if no featured products
	const productsForSlides =
		featuredProductEvents.length > 0
			? featuredProductEvents
			: products
					.filter((product: NDKEvent) => {
						return product.tags.some((tag: string[]) => tag[0] === 'image' && tag[1])
					})
					.slice(0, 4)

	// Extract all unique tags from products
	const allTags = useMemo(() => {
		const tagSet = new Set<string>()
		products.forEach((product) => {
			const categories = getProductCategories(product)
			categories.forEach((cat) => {
				if (cat[1]) tagSet.add(cat[1])
			})
		})
		return Array.from(tagSet)
	}, [products])

	// Separate default categories and other tags
	const defaultTags = PRODUCT_CATEGORIES.filter((cat) => allTags.includes(cat))

	const handleTagClick = (selectedTag: string) => {
		if (tag === selectedTag) {
			// If clicking the same tag, clear the filter
			navigate({ to: '/products' })
		} else {
			navigate({ to: '/products', search: (prev: any) => ({ ...prev, tag: selectedTag }) })
		}
	}

	const handleClearFilter = () => {
		navigate({ to: '/products' })
	}
	const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

	// Touch/swipe handling
	const touchStartX = useRef<number>(0)
	const touchEndX = useRef<number>(0)
	const minSwipeDistance = 50

	const totalSlides = 1 + productsForSlides.length // Homepage + featured products

	// Auto-slide functionality - change slide every 8 seconds
	useEffect(() => {
		if (totalSlides <= 1) return // Don't auto-slide if there's only one slide

		const interval = setInterval(() => {
			setCurrentSlideIndex((prev) => (prev + 1) % totalSlides)
		}, 8000) // 8 seconds

		return () => clearInterval(interval)
	}, [totalSlides])

	// Current slide data - homepage banner is at index 0
	const isHomepageSlide = currentSlideIndex === 0
	const currentProduct = isHomepageSlide ? null : productsForSlides[currentSlideIndex - 1]
	const currentProductId = currentProduct?.id

	// Get current product data (only if not homepage slide)
	const { data: currentTitle } = useProductTitle(currentProductId || '')
	const { data: currentImages = [] } = useProductImages(currentProductId || '')

	// Get the actual title from the product or fallback to empty string to avoid "Latest Product"
	const displayTitle = currentTitle || (currentProduct ? getProductTitle(currentProduct) : '')

	// Get background image from current product (only if not homepage slide)
	const backgroundImageUrl = !isHomepageSlide && currentImages.length > 0 ? currentImages[0][1] : ''

	// Use the market image for homepage background instead of random product
	const marketBackgroundImageUrl = '/images/market-background.jpg'

	// Use the hook to inject dynamic CSS for the background image
	const heroClassName = currentProductId ? `hero-bg-products-${currentProductId.replace(/[^a-zA-Z0-9]/g, '')}` : 'hero-bg-products-default'
	const marketHeroClassName = 'hero-bg-market'
	useHeroBackground(backgroundImageUrl, heroClassName)
	useHeroBackground(marketBackgroundImageUrl, marketHeroClassName)

	const handleStartSelling = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createProduct')
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
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-4 lg:mt-0">
			{/* Button in same position as product image */}
			<div className="mb-2 h-40 lg:h-48 flex items-center justify-center">
				<Button variant="focus" size="lg" onClick={handleStartSelling}>
					<span className="flex items-center gap-2">
						<span className="i-nostr w-6 h-6"></span>Start Selling
					</span>
				</Button>
			</div>

			<div className="flex items-center justify-center h-16 lg:h-20">
				<h1 className="text-2xl lg:text-4xl font-theylive transition-opacity duration-500">Browse Products</h1>
			</div>

			<div className="flex flex-col gap-4">
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
								aria-label={`View ${index === 0 ? 'homepage' : `product ${index}`}`}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)

	// Render product hero content
	const renderProductHero = () => (
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-4 lg:mt-0">
			{/* Featured Product Image - Fixed size container */}
			<div className="mb-2 w-40 h-40 lg:w-48 lg:h-48">
				{backgroundImageUrl && (
					<Link to={`/products/${currentProductId}`} className="block w-full h-full">
						<div className="relative w-full h-full overflow-hidden rounded-lg shadow-xl ring-2 ring-white/20 hover:ring-secondary transition-all">
							<img
								src={backgroundImageUrl}
								alt={displayTitle || 'Featured product'}
								className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
							/>
						</div>
					</Link>
				)}
			</div>

			<div className="flex items-center justify-center h-16 lg:h-20">
				<h1 className="text-2xl lg:text-4xl font-theylive transition-opacity duration-500">{displayTitle || 'Loading...'}</h1>
			</div>

			<div className="flex flex-col gap-4">
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
								aria-label={`View ${index === 0 ? 'homepage' : `product ${index}`}`}
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
				// Homepage hero styling with random product background
				<div
					className={`relative hero-container-carousel ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-black'}`}
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
				// Product hero styling (existing product page style)
				<div
					className={`relative hero-container-carousel ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">{renderProductHero()}</div>
				</div>
			)}
			{/* Tag Filter Bar */}
			{defaultTags.length > 0 && (
				<div className="sticky top-0 z-20 bg-off-black border-b shadow-sm">
					<div className="px-4 py-3 overflow-x-auto">
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
						</div>
					</div>
				</div>
			)}

			<div className="px-8 py-4">
				<ItemGrid title="All Products" className="gap-4 sm:gap-8">
					{products.map((product) => (
						<ProductCard key={product.id} product={product} />
					))}
				</ItemGrid>

				{/* Infinite Product List */}
				<div className="mt-8">
					<InfiniteProductList title="More Products" scrollKey="products-page" chunkSize={20} threshold={1000} autoLoad={true} />
				</div>
			</div>
		</div>
	)
}
