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
	const [currentProductIndex, setCurrentProductIndex] = useState(0)

	// Get recent products (up to 5 for pagination)
	const recentProducts = products.slice(0, 5)
	const currentProduct = recentProducts[currentProductIndex]
	const currentProductId = currentProduct?.id

	// Get current product data
	const { data: currentTitle = 'Latest Product' } = useProductTitle(currentProductId || '')
	const { data: currentImages = [] } = useProductImages(currentProductId || '')

	// Get background image from current product
	const backgroundImageUrl = currentImages.length > 0 ? currentImages[0][1] : ''

	// Use the hook to inject dynamic CSS for the background image
	const heroClassName = currentProductId ? `hero-bg-products-${currentProductId.replace(/[^a-zA-Z0-9]/g, '')}` : 'hero-bg-products-default'
	useHeroBackground(backgroundImageUrl, heroClassName)

	// Debug logging
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
		setCurrentProductIndex(index)
	}

	return (
		<div>
			{currentProduct ? (
				<div className={`relative hero-container ${backgroundImageUrl ? `bg-hero-image ${heroClassName}` : 'bg-black'}`}>
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">
						<div className="flex flex-col items-center justify-center text-white text-center gap-8 lg:col-span-2 relative z-20">
							<div className="space-y-4">
								<h1 className="text-4xl lg:text-6xl font-heading">{currentTitle}</h1>
								<p className="text-lg text-gray-300">Latest Addition</p>
							</div>
							
							<div className="flex flex-col gap-6">
								<Link to={`/products/${currentProductId}`}>
									<Button variant="focus" size="lg">
										View Product
									</Button>
								</Link>
								
								{/* Pagination dots */}
								{recentProducts.length > 1 && (
									<div className="flex justify-center gap-2">
										{recentProducts.map((_, index) => (
											<button
												key={index}
												onClick={() => handleDotClick(index)}
												className={`w-3 h-3 rounded-full transition-all duration-300 ${
													index === currentProductIndex 
														? 'bg-white scale-125' 
														: 'bg-white/40 hover:bg-white/60'
												}`}
												aria-label={`View product ${index + 1}`}
											/>
										))}
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			) : (
				<div className="relative hero-container bg-black">
					<div className="hero-overlays">
						<div className="absolute inset-0 bg-radial-overlay z-10" />
						<div className="absolute inset-0 opacity-30 bg-dots-overlay z-10" />
					</div>

					<div className="hero-content">
						<div className="flex flex-col items-center justify-center text-white text-center gap-8 lg:col-span-2 relative z-20">
							<div className="space-y-4">
								<h1 className="text-4xl lg:text-6xl font-heading">Products</h1>
								<p className="text-lg text-gray-300">Discover amazing products for sats</p>
							</div>
							
							<Button variant="focus" size="lg" onClick={handleStartSelling}>
								<span className="flex items-center gap-2">
									<span className="i-nostr w-6 h-6"></span>Start Selling
								</span>
							</Button>
						</div>
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
