import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { productsQueryOptions, useProductTitle, useProductImages, getProductTitle } from '../queries/products'
import { ProductCard } from '@/components/ProductCard'
import { ItemGrid } from '@/components/ItemGrid'
import { getQueryClient } from '@/lib/router-utils'
import { Button } from '@/components/ui/button'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useState, useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { Pattern } from '@/components/pattern'
import { useAutoAnimate } from '@formkit/auto-animate/react'

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
	const [animationParent] = useAutoAnimate()

	const handleStartSelling = () => {
		if (!isAuthenticated) {
			uiActions.openDialog('login')
		} else {
			uiActions.openDrawer('createProduct')
		}
	}

	return (
		<div className="flex flex-col min-h-screen">
			<div className="flex-grow flex flex-col">
				<div className="flex-grow flex flex-col items-center justify-center text-center px-4 py-16 bg-gradient-to-b from-black to-transparent">
					<div className="max-w-3xl mx-auto">
						<h1 className="text-4xl sm:text-6xl font-bold mb-6 text-white">
							Browse Products
						</h1>
						<p className="text-lg sm:text-xl mb-8 text-white/80">
							Discover unique items from Bitcoiners around the world.
						</p>
						<div className="flex flex-col sm:flex-row gap-4 justify-center">
							<Button variant="focus" size="lg" onClick={handleStartSelling}>
								<span className="flex items-center gap-2" ref={animationParent}>
									<span className="i-nostr w-6 h-6"></span>
									{isAuthenticated ? 'Add A Product' : 'Start Selling'}
								</span>
							</Button>
						</div>
					</div>
				</div>
				{products.length > 0 ? (
					<ItemGrid>
						{products.map((product) => (
							<ProductCard key={product.id} product={product} />
						))}
					</ItemGrid>
				) : (
					<div className="flex flex-col items-center justify-center h-full py-16">
						<span className="text-2xl font-heading">No products found</span>
					</div>
				)}
			</div>
		</div>
	)
}
