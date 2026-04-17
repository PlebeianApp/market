import { InfiniteProductList } from '@/components/InfiniteProductList'
import { ProductFilters, defaultProductFilters, type ProductFilterState } from '@/components/ProductFilters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueries, useQuery } from '@tanstack/react-query'
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
import { SelectableBadge } from '@/components/shared/SelectableBadge'

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
	const [filters, setFilters] = useState<ProductFilterState>(defaultProductFilters)
	// Use streaming via InfiniteProductList, but still need some products for featured slides
	// Fetch ALL products (without tag filter) to ensure tag bar remains consistent
	const productsQuery = useQuery({
		...productsQueryOptions(500),
		// Retry every 3 seconds if we got empty results (NDK wasn't ready)
		refetchInterval: (query) => (query.state.data?.length ? false : 3000),
	})
	const products = (productsQuery.data ?? []) as NDKEvent[]

	const { isAuthenticated } = useStore(authStore)

	// Fetch featured products for slides
	const { data: config, isLoading: isLoadingConfig } = useConfigQuery()
	const { data: featuredProductsData, isLoading: isLoadingFeatured } = useFeaturedProducts(config?.appPublicKey || '')
	const featuredProductEvents = useFeaturedProductEvents(featuredProductsData?.featuredProducts)
	const isFeaturedLoading = isLoadingConfig || isLoadingFeatured

	// Use featured products for slides, fallback to recent products only after featured data has loaded
	const productsForSlides =
		featuredProductEvents.length > 0
			? featuredProductEvents
			: isFeaturedLoading
				? [] // Don't flash generic products while featured are still loading
				: products
						.filter((product: NDKEvent) => {
							return product.tags.some((tag: string[]) => tag[0] === 'image' && tag[1])
						})
						.slice(0, 4)

	// Extract all unique tags from ALL products (not filtered)
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
	const defaultTags = PRODUCT_CATEGORIES

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
			productFormActions.openCreateProductDrawer()
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
		<div className="z-20 relative flex flex-col justify-center items-center lg:col-span-2 mt-4 lg:mt-0 text-white text-center">
			{/* Button in same position as product image */}
			<div className="flex justify-center items-center mb-2 h-40 lg:h-48">
				<Button variant="secondary" size="lg" onClick={handleStartSelling}>
					<span className="flex items-center gap-2">
						<span className="size-6 i-nostr"></span>Start Selling
					</span>
				</Button>
			</div>

			<div className="flex justify-center items-center h-16 lg:h-20">
				<h1 className="font-theylive text-2xl lg:text-4xl transition-opacity duration-500">Browse Products</h1>
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
		<div className="z-20 relative flex flex-col justify-center items-center lg:col-span-2 mt-4 lg:mt-0 text-white text-center">
			{/* Featured Product Image - Fixed size container */}
			<div className="mb-2 w-40 lg:w-48 h-40 lg:h-48">
				{backgroundImageUrl && (
					<Link to={`/products/${currentProductId}`} className="block w-full h-full">
						<div className="relative shadow-xl rounded-lg ring-2 ring-white/20 hover:ring-secondary w-full h-full overflow-hidden transition-all">
							<img
								src={backgroundImageUrl}
								alt={displayTitle || 'Featured product'}
								className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
							/>
						</div>
					</Link>
				)}
			</div>

			<div className="flex justify-center items-center h-16 lg:h-20">
				<h1 className="font-theylive text-2xl lg:text-4xl transition-opacity duration-500">{displayTitle || 'Loading...'}</h1>
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
					className={`relative hero-container-carousel ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-gray-700'}`}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="z-10 absolute inset-0 bg-radial-overlay opacity-40" />
						<div className="z-10 absolute inset-0 bg-dots-overlay opacity-20" />
					</div>

					<div className="hero-content">{renderHomepageHero()}</div>
				</div>
			) : (
				// Product hero styling (existing product page style)
				<div
					className={`relative hero-container-carousel ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-gray-700'}`}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="z-10 absolute inset-0 bg-radial-overlay opacity-40" />
						<div className="z-10 absolute inset-0 bg-dots-overlay opacity-20" />
					</div>

					<div className="hero-content">{renderProductHero()}</div>
				</div>
			)}
			{/* Tag Filter Bar */}
			<div className="top-0 z-20 sticky bg-off-black shadow-sm border-b">
				<div className="flex justify-between items-center gap-4 px-4 py-3">
					<div className="flex-1 overflow-x-auto">
						<div className="flex items-center gap-2 min-w-max">
							<SelectableBadge isSelected={!tag} className="transition-colors cursor-pointer" onClick={handleClearFilter}>
								All
							</SelectableBadge>
							{defaultTags.map((tagName) => (
								<SelectableBadge
									key={tagName}
									isSelected={tag === tagName}
									className="transition-colors cursor-pointer"
									onClick={() => handleTagClick(tagName)}
								>
									{tagName}
								</SelectableBadge>
							))}
						</div>
					</div>
					<ProductFilters filters={filters} onFiltersChange={setFilters} />
				</div>
			</div>

			<div className="px-8 py-4">
				{/* Single Infinite Product List with streaming */}
				<InfiniteProductList
					title="All Products"
					scrollKey="products-page"
					chunkSize={20}
					threshold={1000}
					autoLoad={true}
					tag={tag}
					showOutOfStock={filters.showOutOfStock}
					hidePreorder={filters.hidePreorder}
					sort={filters.sort}
					country={filters.country}
				/>
			</div>
		</div>
	)
}
