import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useScrollRestoration } from '@/hooks/useScrollRestoration'
import { ProductCard } from '@/components/ProductCard'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface InfiniteProductListProps {
	/** Title to display above the product grid */
	title?: ReactNode
	/** Number of products to load per page */
	limit?: number
	/** Threshold in pixels from bottom to trigger auto-load */
	threshold?: number
	/** Whether to enable automatic loading on scroll */
	autoLoad?: boolean
	/** Additional CSS classes */
	className?: string
	/** Unique key for scroll restoration */
	scrollKey: string
}

export function InfiniteProductList({
	title,
	limit = 20,
	threshold = 1000,
	autoLoad = true,
	className,
	scrollKey,
}: InfiniteProductListProps) {
	const containerRef = useRef<HTMLDivElement>(null)

	// Use infinite scroll hook
	const { products, isLoading, isFetchingNextPage, hasNextPage, loadMore, isAutoLoading, error } = useInfiniteScroll({
		limit,
		threshold,
		autoLoad,
	})

	// Use scroll restoration hook
	const { scrollElementRef, saveScrollPosition } = useScrollRestoration({
		key: scrollKey,
		ttl: 30 * 60 * 1000, // 30 minutes
	})

	// Set the scroll element ref to the container
	useEffect(() => {
		if (containerRef.current) {
			scrollElementRef.current = containerRef.current
		}
	}, [])

	// Save scroll position when products change (user might be navigating)
	useEffect(() => {
		const timer = setTimeout(() => {
			saveScrollPosition()
		}, 100)
		return () => clearTimeout(timer)
	}, [products.length, saveScrollPosition])

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<div className="text-red-500 mb-4">
					<h3 className="text-lg font-semibold">Error loading products</h3>
					<p className="text-sm">{error.message}</p>
				</div>
				<Button onClick={() => window.location.reload()} variant="outline">
					Try Again
				</Button>
			</div>
		)
	}

	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-12">
				<Loader2 className="w-8 h-8 animate-spin mb-4" />
				<p className="text-gray-600">Loading products...</p>
			</div>
		)
	}

	if (products.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<h3 className="text-lg font-semibold text-gray-900 mb-2">No products found</h3>
				<p className="text-gray-600">There are no products available at the moment.</p>
			</div>
		)
	}

	return (
		<div className={cn('w-full', className)} ref={containerRef}>
			{/* Title */}
			{title && (
				<div className="mb-4">
					{typeof title === 'string' ? <h1 className="text-2xl font-heading text-center sm:text-left">{title}</h1> : title}
				</div>
			)}

			{/* Product Grid */}
			<div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-16">
				{products.map((product) => (
					<ProductCard key={product.id} product={product} />
				))}
			</div>

			{/* Loading indicator for fetching next page */}
			{isFetchingNextPage && (
				<div className="flex justify-center items-center py-8">
					<Loader2 className="w-6 h-6 animate-spin mr-2" />
					<span className="text-gray-600">{isAutoLoading ? 'Loading more products...' : 'Loading...'}</span>
				</div>
			)}

			{/* Load More Button */}
			{hasNextPage && (
				<div className="flex justify-center py-8">
					<Button onClick={loadMore} disabled={isFetchingNextPage} variant="outline" size="lg" className="min-w-[200px]">
						{isFetchingNextPage ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
								{isAutoLoading ? 'Auto Loading...' : 'Loading...'}
							</>
						) : (
							'Load More Products'
						)}
					</Button>
				</div>
			)}

			{/* End of results message */}
			{!hasNextPage && products.length > 0 && (
				<div className="flex justify-center py-8">
					<p className="text-gray-500 text-sm">You've reached the end of the product list</p>
				</div>
			)}
		</div>
	)
}
