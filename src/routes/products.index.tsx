import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { productsQueryOptions, useProductTitle, useProductImages, getProductTitle } from '../queries/products'
import { ProductCard } from '@/components/ProductCard'
import { ItemGrid } from '@/components/ItemGrid'
import { Button } from '@/components/ui/button'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState, useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'

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

export const Route = createFileRoute('/products/')({
	component: ProductsRoute,
})

function ProductsRoute() {
	const productsQuery = useSuspenseQuery(productsQueryOptions)
	const products = productsQuery.data

	const { isAuthenticated } = useStore(authStore)
	const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

	// Touch/swipe handling
	const touchStartX = useRef<number>(0)
	const touchEndX = useRef<number>(0)
	const minSwipeDistance = 50

	// Filter products that have images, then limit to 4 for pagination
	const productsWithImages = products.filter((product) => {
		return product.tags.some((tag) => tag[0] === 'image' && tag[1])
	})

	const recentProducts = productsWithImages.slice(0, 4) // Limit to 4 products
	const totalSlides = 1 + recentProducts.length // Homepage + products

	// Auto-slide functionality - change slide every 5 seconds
	useEffect(() => {
		if (totalSlides <= 1) return // Don't auto-slide if there's only one slide

		const interval = setInterval(() => {
			setCurrentSlideIndex((prev) => (prev + 1) % totalSlides)
		}, 5000) // 5 seconds

		return () => clearInterval(interval)
	}, [totalSlides])

	// Current slide data - homepage banner is now at index 1
	const isHomepageSlide = currentSlideIndex === 1
	const currentProduct = isHomepageSlide ? null : currentSlideIndex === 0 ? recentProducts[0] : recentProducts[currentSlideIndex - 1]
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
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-16 lg:mt-0">
			<div className="flex items-center justify-center h-32">
				<h1 className="text-3xl lg:text-5xl font-theylive transition-opacity duration-500">Browse Products</h1>
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
								aria-label={`View ${index === 1 ? 'homepage' : `product ${index === 0 ? 1 : index}`}`}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)

	// Render product hero content
	const renderProductHero = () => (
		<div className="flex flex-col items-center justify-center text-white text-center lg:col-span-2 relative z-20 mt-16 lg:mt-0">
			<div className="flex items-center justify-center h-32">
				<h1 className="text-3xl lg:text-5xl font-theylive transition-opacity duration-500">{displayTitle || 'Loading...'}</h1>
			</div>

			<div className="flex flex-col gap-6">
				<Link to={`/products/${currentProductId}`}>
					<Button variant="secondary" size="lg">
						View Product
					</Button>
				</Link>

				{/* Pagination dots */}
				{totalSlides > 1 && (
					<div className="flex justify-center gap-3">
						{Array.from({ length: totalSlides }).map((_, index) => (
							<button
								key={index}
								onClick={() => handleDotClick(index)}
								className={`relative group transition-all duration-500 ease-out ${
									index === currentSlideIndex 
										? 'w-8 h-3' 
										: 'w-3 h-3 hover:scale-110'
								}`}
								aria-label={`View ${index === 1 ? 'homepage' : `product ${index === 0 ? 1 : index}`}`}
							>
								<div className={`w-full h-full rounded-full transition-all duration-500 ease-out ${
									index === currentSlideIndex
										? 'bg-white shadow-lg shadow-white/50'
										: 'bg-white/30 group-hover:bg-white/60 backdrop-blur-sm'
								}`} />
								{index === currentSlideIndex && (
									<div className="absolute inset-0 rounded-full bg-gradient-to-r from-white/80 to-white animate-pulse" />
								)}
								<div className={`absolute inset-0 rounded-full border transition-all duration-500 ${
									index === currentSlideIndex
										? 'border-white/80 shadow-md'
										: 'border-white/20 group-hover:border-white/40'
								}`} />
							</button>
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
				// Product hero styling (existing product page style)
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

					<div className="hero-content">{renderProductHero()}</div>
				</div>
			)}

			<div className="px-8 py-4">
				<ItemGrid title="All Products">
					{products.map((product) => (
						<ProductCard key={product.id} product={product} />
					))}
				</ItemGrid>
			</div>
		</div>
	)
}
