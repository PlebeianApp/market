import { useState, useEffect, useRef, useCallback } from 'react'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'
import { isProductInStock } from '@/queries/products'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'

interface UseStreamingProductsOptions {
	/** Maximum number of products to stream */
	limit?: number
	/** Optional tag to filter products by */
	tag?: string
	/** Whether to include hidden products */
	includeHidden?: boolean
	/** Status filter: 'pre-order' or 'out-of-stock' */
	statusFilter?: 'pre-order' | 'out-of-stock'
}

interface UseStreamingProductsReturn {
	/** Products received so far, sorted by created_at desc */
	products: NDKEvent[]
	/** Whether we're still actively receiving products */
	isStreaming: boolean
	/** Whether NDK is connected */
	isConnected: boolean
	/** Number of products received */
	count: number
}

/**
 * Hook that streams products progressively as they arrive from relays.
 * Products appear immediately as each event is received, rather than waiting for all.
 */
export function useStreamingProducts({
	limit = 500,
	tag,
	includeHidden = false,
	statusFilter,
}: UseStreamingProductsOptions = {}): UseStreamingProductsReturn {
	const [products, setProducts] = useState<NDKEvent[]>([])
	const [isStreaming, setIsStreaming] = useState(true)
	const isConnected = useStore(ndkStore, (s) => s.isConnected)

	// Track seen event IDs to prevent duplicates
	const seenIds = useRef(new Set<string>())
	const subscriptionRef = useRef<NDKSubscription | null>(null)

	// Stable callback to add a product
	const addProduct = useCallback(
		(event: NDKEvent) => {
			const key = event.deduplicationKey()
			if (seenIds.current.has(key)) return
			seenIds.current.add(key)

			// Check visibility
			const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
			const visibility = visibilityTag?.[1] || 'on-sale'

			// Check stock status
			const inStock = isProductInStock(event)

			// Apply status filter
			if (statusFilter === 'pre-order') {
				// Only show pre-order items
				if (visibility !== 'pre-order') return
			} else if (statusFilter === 'out-of-stock') {
				// Only show out-of-stock items (not pre-order and not in stock)
				if (visibility === 'pre-order' || inStock) return
			} else {
				// Default behavior: hide hidden products and out-of-stock
				if (!includeHidden) {
					if (visibility === 'hidden') return
					if (!inStock) return
				}
			}

			// Add product and sort by created_at (newest first)
			setProducts((prev) => {
				const filtered = filterBlacklistedEvents([event])
				if (filtered.length === 0) return prev

				const newProduct = filtered[0]
				const updated = [...prev, newProduct]
				updated.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
				return updated.slice(0, limit)
			})
		},
		[includeHidden, limit, statusFilter],
	)

	useEffect(() => {
		const ndk = ndkActions.getNDK()
		if (!ndk) {
			// NDK not ready yet - will re-run when connected
			return
		}

		// Reset state when filter changes
		setProducts([])
		seenIds.current.clear()
		setIsStreaming(true)

		const filter: NDKFilter = {
			kinds: [30402],
			limit,
			...(tag && { '#t': [tag] }),
		}

		const subscription = ndk.subscribe(filter, {
			closeOnEose: true,
		})

		subscriptionRef.current = subscription

		subscription.on('event', (event: NDKEvent) => {
			addProduct(event)
		})

		subscription.on('eose', () => {
			setIsStreaming(false)
		})

		subscription.on('close', () => {
			setIsStreaming(false)
		})

		// Timeout fallback - stop streaming after 10s even if no EOSE
		const timeout = setTimeout(() => {
			setIsStreaming(false)
		}, 10000)

		return () => {
			clearTimeout(timeout)
			subscription.stop()
			subscriptionRef.current = null
		}
	}, [isConnected, tag, limit, addProduct, statusFilter])

	return {
		products,
		isStreaming,
		isConnected,
		count: products.length,
	}
}
