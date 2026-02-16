import { useSimpleInfiniteScroll } from '@/hooks/useSimpleInfiniteScroll'
import { useScrollRestoration } from '@/hooks/useScrollRestoration'
import { ProductCard } from '@/components/ProductCard'
import { ItemGrid } from '@/components/ItemGrid'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface InfiniteProductListProps {
	/** Title to display above the product grid */
	title?: ReactNode
	/** Number of products to load per chunk */
	chunkSize?: number
	/** Maximum number of products to preload */
	maxProducts?: number
	/** Threshold in pixels from bottom to trigger auto-load */
	threshold?: number
	/** Whether to enable automatic loading on scroll */
	autoLoad?: boolean
	/** Additional CSS classes */
	className?: string
	/** Unique key for scroll restoration */
	scrollKey: string
	/** Optional tag to filter products by */
	tag?: string
}

export function InfiniteProductList({
	title,
	chunkSize = 20,
	maxProducts = 500,
	threshold = 1000,
	autoLoad = true,
	className,
	scrollKey,
	tag,
}: InfiniteProductListProps) {
	const containerRef = useRef<HTMLDivElement>(null)

	// Use simplified infinite scroll hook
	const { products, isLoading, isError, error, hasMore, loadMore, totalProducts, currentChunk } = useSimpleInfiniteScroll({
		chunkSize,
		maxProducts,
		threshold,
		autoLoad,
		tag,
	})

	// Use scroll restoration hook
	const { scrollElementRef, saveScrollPosition, restoreScrollPosition } = useScrollRestoration({
		key: scrollKey,
		ttl: 30 * 60 * 1000, // 30 minutes
	})

	// Note: scrollElementRef is not used since we're using window-level scrolling

	// Only restore scroll position on initial load
	useEffect(() => {
		if (products.length && !isLoading) {
			// Only restore on first chunk
			if (currentChunk === 1) {
				const timer = setTimeout(() => {
					restoreScrollPosition()
				}, 100)
				return () => clearTimeout(timer)
			}
		}
	}, [products.length, isLoading, currentChunk, restoreScrollPosition])

	// Save scroll position periodically
	useEffect(() => {
		if (!isLoading) {
			const timer = setTimeout(() => {
				saveScrollPosition()
			}, 100)
			return () => clearTimeout(timer)
		}
	}, [products.length, saveScrollPosition, isLoading])

	if (isError && error) {
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

	if (isLoading && products.length === 0) {
		return (
			<div className={cn('w-full max-w-full overflow-hidden', className)} ref={containerRef}>
				{title && (
					<div className="mb-4">
						{typeof title === 'string' ? <h1 className="text-xl sm:text-2xl font-heading text-center sm:text-left">{title}</h1> : title}
					</div>
				)}

				<div className="flex flex-col items-center justify-center py-12 min-h-[60vh]">
					<Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
					<p className="text-sm text-gray-500">Loading products...</p>
				</div>
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
		<div className={cn('w-full max-w-full overflow-hidden', className)} ref={containerRef} data-testid="infinite-product-list">
			{/* Title */}
			{title && (
				<div className="mb-4">
					{typeof title === 'string' ? <h1 className="text-xl sm:text-2xl font-heading text-center sm:text-left">{title}</h1> : title}
				</div>
			)}

			{/* Product Grid */}
			<ItemGrid className="gap-4 sm:gap-8">
				{products.map((product) => (
					<ProductCard key={product.id} product={product} />
				))}
			</ItemGrid>

			{/* Load more button */}
			{hasMore && (
				<div className="flex justify-center py-8 min-h-[80px] items-center">
					<Button
						onClick={loadMore}
						variant="outline"
						size="lg"
						className="min-w-[200px] h-12"
						disabled={isLoading}
						data-testid="load-more-button"
					>
						{isLoading ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
								Loading...
							</>
						) : (
							'Load More Products'
						)}
					</Button>
				</div>
			)}

			{/* End of results message */}
			{!hasMore && products.length > 0 && (
				<div className="flex justify-center py-8">
					<p className="text-gray-500 text-sm">
						Showing {products.length} of {totalProducts} products
					</p>
				</div>
			)}
		</div>
	)
}
