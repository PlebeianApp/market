import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { productFormActions } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { FeaturedSections } from '@/components/FeaturedSections'
import { InfiniteProductList } from '@/components/InfiniteProductList'
import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { getProductCategories } from '@/queries/products'
import { useQuery } from '@tanstack/react-query'
import { productsQueryOptions } from '@/queries/products'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { z } from 'zod'
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

const homeSearchSchema = z.object({
	tag: z.string().optional(),
})

export const Route = createFileRoute('/')({
	component: Index,
	validateSearch: homeSearchSchema,
})

function Index() {
	const navigate = useNavigate()
	const { tag } = Route.useSearch()
	const { isAuthenticated } = useStore(authStore)
	// Fetch all products without tag filter to extract all available tags
	// Using useQuery (not useSuspenseQuery) for progressive loading - page renders immediately
	const productsQuery = useQuery({
		...productsQueryOptions(500),
		// Retry every 3 seconds if we got empty results (NDK wasn't ready)
		refetchInterval: (query) => (query.state.data?.length ? false : 3000),
	})
	const products = (productsQuery.data ?? []) as NDKEvent[]

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
		navigate({ to: '/' })
	}

	// Use the market image for homepage background
	const marketBackgroundImageUrl = '/images/market-background.jpg'
	const marketHeroClassName = 'hero-bg-market'
	useHeroBackground(marketBackgroundImageUrl, marketHeroClassName)

	const handleStartSelling = () => {
		if (isAuthenticated) {
			productFormActions.openCreateProductDrawer()
		} else {
			uiActions.openDialog('login')
		}
	}

	return (
		<div>
			{/* Hero Section */}
			<div className={`relative hero-container ${marketBackgroundImageUrl ? `bg-hero-image ${marketHeroClassName}` : 'bg-gray-700'}`}>
				<div className="hero-overlays">
					<div className="z-10 absolute inset-0 bg-radial-overlay opacity-40" />
					<div className="z-10 absolute inset-0 bg-dots-overlay opacity-20" />
				</div>

				<div className="hero-content">
					<div className="z-20 relative flex flex-col justify-center items-center lg:col-span-2 mt-16 lg:mt-0 text-white text-center">
						<div className="flex justify-center items-center h-24 lg:h-32">
							<h1 className="font-theylive text-4xl lg:text-5xl transition-opacity duration-500">Buy & Sell Stuff with sats</h1>
						</div>

						<Button variant="secondary" size="lg" onClick={handleStartSelling} className="bg-focus rounded hover:bg-focus-foreground-hover">
							<span className="flex items-center gap-2">
								<span className="size-6 i-nostr" />
								Start Selling
							</span>
						</Button>
					</div>
				</div>
			</div>
			{/* Tag Filter Bar */}
			{defaultTags.length > 0 && (
				<div className="top-0 z-20 sticky bg-off-black shadow-sm border-b">
					<div className="px-4 py-3 overflow-x-auto">
						<div className="flex items-center gap-2 min-w-max">
							<SelectableBadge isSelected className="transition-colors cursor-pointer" onClick={handleClearFilter}>
								All
							</SelectableBadge>
							{defaultTags.map((tagName) => (
								<SelectableBadge key={tagName} className="transition-colors cursor-pointer" onClick={() => handleTagClick(tagName)}>
									{tagName}
								</SelectableBadge>
							))}
						</div>
					</div>
				</div>
			)}

			<FeaturedSections maxItemsPerSection={5} />

			{/* Infinite Product List */}
			<div className="px-8 py-4">
				<InfiniteProductList title="All Products" scrollKey="homepage-products" chunkSize={20} threshold={1000} autoLoad={true} tag={tag} />
			</div>
		</div>
	)
}
