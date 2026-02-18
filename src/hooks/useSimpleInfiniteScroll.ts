import { useState, useMemo, useCallback, useEffect } from 'react'
import { useStreamingProducts } from './useStreamingProducts'
import { getProductTitle } from '@/queries/products'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { SortOption } from '@/components/ProductFilters'

interface UseSimpleInfiniteScrollOptions {
	chunkSize?: number
	maxProducts?: number
	threshold?: number
	autoLoad?: boolean
	tag?: string
	showOutOfStock?: boolean
	hidePreorder?: boolean
	sort?: SortOption
}

interface UseSimpleInfiniteScrollReturn {
	products: NDKEvent[]
	hasMore: boolean
	isLoading: boolean
	isError: boolean
	error: Error | null
	loadMore: () => void
	totalProducts: number
	currentChunk: number
	totalChunks: number
}

/**
 * Infinite scroll hook that uses streaming products for progressive loading.
 * Products appear immediately as they arrive from relays, then are chunked for display.
 */
export const useSimpleInfiniteScroll = ({
	chunkSize = 20,
	maxProducts = 500,
	threshold = 1000,
	autoLoad = true,
	tag,
	showOutOfStock = false,
	hidePreorder = false,
	sort = 'newest',
}: UseSimpleInfiniteScrollOptions = {}): UseSimpleInfiniteScrollReturn => {
	// Use streaming products - these arrive progressively
	const {
		products: streamedProducts,
		isStreaming,
		isConnected,
	} = useStreamingProducts({
		limit: maxProducts,
		tag,
		showOutOfStock,
		hidePreorder,
	})

	// Apply sorting to streamed products
	const allProducts = useMemo(() => {
		const sorted = [...streamedProducts]
		switch (sort) {
			case 'oldest':
				sorted.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
				break
			case 'a-z':
				sorted.sort((a, b) => {
					const titleA = getProductTitle(a)?.toLowerCase() || ''
					const titleB = getProductTitle(b)?.toLowerCase() || ''
					return titleA.localeCompare(titleB)
				})
				break
			case 'z-a':
				sorted.sort((a, b) => {
					const titleA = getProductTitle(a)?.toLowerCase() || ''
					const titleB = getProductTitle(b)?.toLowerCase() || ''
					return titleB.localeCompare(titleA)
				})
				break
			case 'newest':
			default:
				sorted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
				break
		}
		return sorted
	}, [streamedProducts, sort])

	// Track current chunk (page) - start showing products immediately
	const [currentChunk, setCurrentChunk] = useState(1)

	// Auto-expand chunks as products stream in during initial load
	useEffect(() => {
		if (isStreaming && allProducts.length > 0) {
			// Show all currently available products while streaming
			const neededChunks = Math.ceil(allProducts.length / chunkSize)
			if (neededChunks > currentChunk) {
				setCurrentChunk(neededChunks)
			}
		}
	}, [allProducts.length, isStreaming, chunkSize, currentChunk])

	// Calculate visible products based on current chunk
	const products = useMemo(() => {
		const endIndex = currentChunk * chunkSize
		return allProducts.slice(0, endIndex)
	}, [allProducts, currentChunk, chunkSize])

	// Calculate if there are more products to load
	const hasMore = useMemo(() => {
		return products.length < allProducts.length
	}, [products.length, allProducts.length])

	// Calculate total chunks
	const totalChunks = useMemo(() => {
		return Math.ceil(allProducts.length / chunkSize)
	}, [allProducts.length, chunkSize])

	// Load more function
	const loadMore = useCallback(() => {
		if (hasMore && !isStreaming) {
			setCurrentChunk((prev) => prev + 1)
		}
	}, [hasMore, isStreaming])

	// Auto-load on scroll
	useEffect(() => {
		if (!autoLoad) return

		const handleScroll = () => {
			const scrollTop = window.pageYOffset || document.documentElement.scrollTop
			const scrollHeight = document.documentElement.scrollHeight
			const clientHeight = window.innerHeight
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight

			if (distanceFromBottom <= threshold && hasMore && !isStreaming) {
				loadMore()
			}
		}

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => window.removeEventListener('scroll', handleScroll)
	}, [autoLoad, threshold, hasMore, isStreaming, loadMore])

	// Show loading only when we have no products yet and are still connecting/streaming
	const isLoading = allProducts.length === 0 && (isStreaming || !isConnected)

	return {
		products,
		hasMore,
		isLoading,
		isError: false,
		error: null,
		loadMore,
		totalProducts: allProducts.length,
		currentChunk,
		totalChunks,
	}
}
