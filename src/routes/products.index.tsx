import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { productsQueryOptions, useProductTitle, useProductImages } from '../queries/products'
import { ProductCard } from '@/components/ProductCard'
import { ItemGrid } from '@/components/ItemGrid'
import { getQueryClient } from '@/lib/router-utils'
import { Button } from '@/components/ui/button'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Pattern } from '@/components/pattern'

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
	loader: ({ context }) => getQueryClient(context).ensureQueryData(productsQueryOptions),
	component: ProductsRoute,
})

function ProductsRoute() {
	const productsQuery = useSuspenseQuery(productsQueryOptions)
	const products = productsQuery.data

	const { isAuthenticated } = useStore(authStore)
	const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

	// Filter products that have images, then limit to 4 for pagination
	const productsWithImages = products.filter(product => {
		// Check if product has image tags
		const hasImages = product.tags.some(tag => tag[0] === 'image' && tag[1])
		return hasImages
	})
	const recentProducts = productsWithImages.slice(0, 4) // Limit to 4 products since homepage hero takes first slot
	const totalSlides = 1 + recentProducts.length // Homepage + products
	
	// Current slide data
	const isHomepageSlide = currentSlideIndex === 0
	const currentProduct = isHomepageSlide ? null : recentProducts[currentSlideIndex - 1]
	const currentProductId = currentProduct?.id

	// Get current product data (only if not homepage slide)
	const { data: currentTitle = 'Latest Product' } = useProductTitle(currentProductId || '')
	const { data: currentImages = [] } = useProductImages(currentProductId || '')

	// Get background image from current product (only if not homepage slide)
	const backgroundImageUrl = !isHomepageSlide && currentImages.length > 0 ? currentImages[0][1] : ''

	// Get random product image for homepage background
	const randomProduct = productsWithImages.length > 0 ? productsWithImages[Math.floor(Math.random() * productsWithImages.length)] : null
	const randomProductImages = randomProduct?.tags.filter(tag => tag[0] === 'image') || []
	const randomBackgroundImageUrl = randomProductImages.length > 0 ? randomProductImages[0][1] : ''

	// Use the hook to inject dynamic CSS for the background image
	const heroClassName = currentProductId ? `hero-bg-products-${currentProductId.replace(/[^a-zA-Z0-9]/g, '')}` : 'hero-bg-products-default'
	const randomHeroClassName = `hero-bg-random-${randomProduct?.id?.replace(/[^a-zA-Z0-9]/g, '') || 'default'}`
	useHeroBackground(backgroundImageUrl, heroClassName)
	useHeroBackground(randomBackgroundImageUrl, randomHeroClassName)

	// Debug logging
	console.log('Total products:', products.length)
	console.log('Products with images:', productsWithImages.length)
	console.log('Recent products for banner:', recentProducts.length)
	console.log('Random product for homepage:', randomProduct)
	console.log('Random background image:', randomBackgroundImageUrl)
	console.log('Current slide index:', currentSlideIndex)
	console.log('Is homepage slide:', isHomepageSlide)
	console.log('Current product:', currentProduct)
	console.log('Current images:', currentImages)
	console.log('Background image URL:', backgroundImageUrl)
	console.log('Hero class name:', heroClassName)

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

	// Render homepage hero content
	const renderHomepageHero = () => (
		<div className="flex flex-col items-center justify-center text-white text-center gap-8 lg:col-span-2 relative z-20 mt-16">
			<div className="space-y-4">
				<h1 className="text-4xl lg:text-6xl font-heading">Buy & Sell Stuff with sats</h1>
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
									index === currentSlideIndex 
										? 'bg-white scale-125' 
										: 'bg-white/40 hover:bg-white/60'
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
		<div className="flex flex-col items-center justify-center text-white text-center gap-8 lg:col-span-2 relative z-20 mt-16">
			<div className="space-y-4">
				<h1 className="text-4xl lg:text-6xl font-heading">{currentTitle}</h1>
			</div>
			
			<div className="flex flex-col gap-6">
				<Link to={`/products/${currentProductId}`}>
					<Button variant="focus" size="lg">
						View Product
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
									index === currentSlideIndex 
										? 'bg-white scale-125' 
										: 'bg-white/40 hover:bg-white/60'
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
				<div className={`relative hero-container ${randomBackgroundImageUrl ? `bg-hero-image ${randomHeroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">
						{renderHomepageHero()}
					</div>
				</div>
			) : (
				// Product hero styling (existing product page style)
				<div className={`relative hero-container ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">
						{renderProductHero()}
					</div>
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
