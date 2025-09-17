import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { productsPaginatedQueryOptions } from '@/queries/products'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { fetchProductsPaginated } from '@/queries/products'

interface UseInfiniteScrollOptions {
	/** Number of products to load per page */
	limit?: number
	/** Threshold in pixels from bottom to trigger auto-load */
	threshold?: number
	/** Whether to enable automatic loading on scroll */
	autoLoad?: boolean
}

interface UseInfiniteScrollReturn {
	/** All loaded products */
	products: NDKEvent[]
	/** Whether initial data is loading */
	isLoading: boolean
	/** Whether more data is being fetched */
	isFetchingNextPage: boolean
	/** Whether there are more pages to load */
	hasNextPage: boolean
	/** Function to manually load more products */
	loadMore: () => void
	/** Whether auto-loading is currently active */
	isAutoLoading: boolean
	/** Error state */
	error: Error | null
}

export function useInfiniteScroll({
	limit = 20,
	threshold = 1000,
	autoLoad = true,
}: UseInfiniteScrollOptions = {}): UseInfiniteScrollReturn {
	const [isAutoLoading, setIsAutoLoading] = useState(false)
	const scrollListenerRef = useRef<(() => void) | null>(null)

	// Infinite query for products
	const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } = useInfiniteQuery({
		queryKey: ['products', 'infinite', limit],
		queryFn: ({ pageParam }) => {
			return fetchProductsPaginated(limit, pageParam)
		},
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage, allPages) => {
			if (!lastPage || lastPage.length < limit) {
				return undefined // No more pages
			}

			// Get all product IDs we've already fetched to avoid duplicates
			const fetchedIds = new Set(allPages.flat().map((p) => p.id))

			// Use the oldest timestamp from the last page as the next page param
			// But subtract 1 second to avoid including products with the exact same timestamp
			const oldestProduct = lastPage[lastPage.length - 1]
			const nextTimestamp = oldestProduct?.created_at ? oldestProduct.created_at - 1 : undefined

			return nextTimestamp
		},
		staleTime: 300000, // 5 minutes
	})

	// Flatten all pages into a single array and deduplicate by event ID
	const products = useMemo(() => {
		if (!data?.pages) return []

		const allProducts = data.pages.flat()
		const uniqueProducts = new Map<string, NDKEvent>()

		// Deduplicate by event ID, keeping the first occurrence
		for (const product of allProducts) {
			if (!uniqueProducts.has(product.id)) {
				uniqueProducts.set(product.id, product)
			}
		}

		return Array.from(uniqueProducts.values())
	}, [data?.pages])

	// Manual load more function
	const loadMore = useCallback(() => {
		// Load more manually
		if (hasNextPage && !isFetchingNextPage) {
			fetchNextPage()
		}
	}, [hasNextPage, isFetchingNextPage, fetchNextPage])

	// Auto-scroll detection
	const handleScroll = useCallback(() => {
		if (!autoLoad || !hasNextPage || isFetchingNextPage) {
			return
		}

		const scrollTop = window.pageYOffset || document.documentElement.scrollTop
		const windowHeight = window.innerHeight
		const documentHeight = document.documentElement.scrollHeight

		// Check if we're near the bottom
		if (scrollTop + windowHeight >= documentHeight - threshold) {
			setIsAutoLoading(true)
			fetchNextPage().finally(() => {
				setIsAutoLoading(false)
			})
		}
	}, [autoLoad, hasNextPage, isFetchingNextPage, threshold, fetchNextPage])

	// Set up scroll listener
	useEffect(() => {
		if (!autoLoad) return

		scrollListenerRef.current = handleScroll
		window.addEventListener('scroll', handleScroll, { passive: true })

		return () => {
			window.removeEventListener('scroll', handleScroll)
		}
	}, [handleScroll, autoLoad])

	return {
		products,
		isLoading,
		isFetchingNextPage,
		hasNextPage: hasNextPage ?? false,
		loadMore,
		isAutoLoading,
		error: error as Error | null,
	}
}
