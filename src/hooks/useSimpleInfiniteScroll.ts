import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { productsQueryOptions } from '@/queries/products'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

interface UseSimpleInfiniteScrollOptions {
	chunkSize?: number
	maxProducts?: number
	threshold?: number
	autoLoad?: boolean
	tag?: string
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
 * Simplified infinite scroll hook that preloads all products and displays them in chunks
 * @param options Configuration options
 * @returns Infinite scroll state and controls
 */
export const useSimpleInfiniteScroll = ({
	chunkSize = 20,
	maxProducts = 500,
	threshold = 1000,
	autoLoad = true,
	tag,
}: UseSimpleInfiniteScrollOptions = {}): UseSimpleInfiniteScrollReturn => {
	// Fetch all products at once
	const { data: allProducts = [], isLoading, isError, error } = useQuery(productsQueryOptions(maxProducts, tag))

	// Track current chunk (page)
	const [currentChunk, setCurrentChunk] = useState(1)

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
		if (hasMore && !isLoading) {
			setCurrentChunk((prev) => prev + 1)
		}
	}, [hasMore, isLoading])

	// Auto-load on scroll
	useEffect(() => {
		if (!autoLoad) return

		const handleScroll = () => {
			const scrollTop = window.pageYOffset || document.documentElement.scrollTop
			const scrollHeight = document.documentElement.scrollHeight
			const clientHeight = window.innerHeight
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight

			if (distanceFromBottom <= threshold && hasMore && !isLoading) {
				loadMore()
			}
		}

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => window.removeEventListener('scroll', handleScroll)
	}, [autoLoad, threshold, hasMore, isLoading, loadMore])

	return {
		products,
		hasMore,
		isLoading,
		isError,
		error,
		loadMore,
		totalProducts: allProducts.length,
		currentChunk,
		totalChunks,
	}
}
