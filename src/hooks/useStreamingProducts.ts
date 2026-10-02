import { useState, useEffect, useRef, useCallback } from 'react'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { testLabelStore } from '@/lib/stores/testLabels'
import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'
import { filterDeletedProducts, isProductInStock } from '@/queries/products'
import { collectTestLabelCoordinates, filterTestLabeledEvents } from '@/lib/utils/testLabelFilters'
import { fetchTestLabels } from '@/queries/testLabels'
import { buildProductStreamFilter } from '@/lib/utils/productStreamFilter'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'

interface UseStreamingProductsOptions {
	/** Maximum number of products to stream */
	limit?: number
	/** Optional tag to filter products by */
	tag?: string
	/** Whether to include hidden products */
	includeHidden?: boolean
	/** Whether to show out of stock products */
	showOutOfStock?: boolean
	/** Whether to hide pre-order products */
	hidePreorder?: boolean
	/** Country name to filter products by location */
	country?: string
	/**
	 * Restrict the stream to these authors (e.g. one seller's profile).
	 * Invalid entries are dropped; an empty result streams nothing rather than
	 * matching every author on the relay. See buildProductStreamFilter.
	 */
	authors?: string[]
	/** Bump to re-open the subscription (the profile's "Try again"). */
	reloadToken?: number
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

/** Buffer window for batching test-label checks during streaming (ms) */
const TEST_LABEL_STREAM_FLUSH_MS = 250

/**
 * Hook that streams products progressively as they arrive from relays.
 * Products appear in small batches as events are received, rather than waiting
 * for all — each batch gets a batched test-label check before rendering
 * (ADR-0009), so labeled items never flash into the feed.
 */
export function useStreamingProducts({
	limit = 500,
	tag,
	includeHidden = false,
	showOutOfStock = false,
	hidePreorder = false,
	country = '',
	authors,
	reloadToken,
}: UseStreamingProductsOptions = {}): UseStreamingProductsReturn {
	const [products, setProducts] = useState<NDKEvent[]>([])
	const [isStreaming, setIsStreaming] = useState(true)
	const isConnected = useStore(ndkStore, (s) => s.isConnected)
	const showTestListings = useStore(testLabelStore, (s) => s.showTestListings)

	// Track seen event IDs to prevent duplicates
	const seenIds = useRef(new Set<string>())
	const subscriptionRef = useRef<NDKSubscription | null>(null)

	// Buffer incoming events so test-label checks can be batched per flush
	// window instead of issuing one relay query per event (ADR-0009).
	const pendingBufferRef = useRef<NDKEvent[]>([])
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const flushLockRef = useRef(false)

	// Stable per-event business filters (blacklist, visibility, stock, country)
	const passesBusinessFilters = useCallback(
		(event: NDKEvent): boolean => {
			// Filter out blacklisted products and authors
			if (filterBlacklistedEvents([event]).length === 0) return false

			// Filter out locally-deleted products. The one-shot product reads
			// always applied this (src/queries/products.tsx); without it here a
			// streamed surface would resurrect a product the merchant deleted.
			if (filterDeletedProducts([event]).length === 0) return false

			// Check visibility
			const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
			const visibility = visibilityTag?.[1] || 'on-sale'

			// Filter hidden products (unless includeHidden is true)
			if (!includeHidden && visibility === 'hidden') return false

			// Filter pre-order products (if hidePreorder is true)
			if (hidePreorder && visibility === 'pre-order') return false

			// Filter out-of-stock products (unless showOutOfStock is true)
			if (!showOutOfStock && !isProductInStock(event)) return false

			// Filter by country (match against location tag)
			if (country) {
				const location = event.tags.find((t) => t[0] === 'location')?.[1] || ''
				if (!location.toLowerCase().includes(country.toLowerCase())) return false
			}

			return true
		},
		[includeHidden, showOutOfStock, hidePreorder, country],
	)

	/**
	 * Drain the pending buffer: batch-fetch test labels for the buffered
	 * coordinates, then release the non-labeled events into the product list.
	 * Batching keeps feeds N+1-free; buffering until the flush avoids the
	 * appear-then-disappear flicker of per-event label checks.
	 */
	const flushPendingEvents = useCallback(async () => {
		if (flushLockRef.current) return
		flushLockRef.current = true
		try {
			while (pendingBufferRef.current.length > 0) {
				const buffered = pendingBufferRef.current
				pendingBufferRef.current = []

				const eligible = buffered.filter(passesBusinessFilters)
				if (eligible.length === 0) continue

				// Batch label check for this flush window, then sync store filter.
				// Skipped entirely when the user opted to reveal test listings.
				let nonLabeled = eligible
				if (!showTestListings) {
					const coordinates = collectTestLabelCoordinates(eligible)
					if (coordinates.length > 0) {
						try {
							await fetchTestLabels(coordinates)
						} catch (error) {
							console.warn('Test label fetch failed during streaming:', error)
						}
					}
					nonLabeled = filterTestLabeledEvents(eligible)
				}
				if (nonLabeled.length === 0) continue

				setProducts((prev) => {
					const updated = [...prev, ...nonLabeled]
					updated.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
					return updated.slice(0, limit)
				})
			}
		} finally {
			flushLockRef.current = false
		}
	}, [limit, passesBusinessFilters, showTestListings])

	// Stable callback to buffer a product for the next flush window
	const addProduct = useCallback(
		(event: NDKEvent) => {
			const key = event.deduplicationKey()
			if (seenIds.current.has(key)) return
			seenIds.current.add(key)

			// Buffer the event; the flush window batches the label check
			pendingBufferRef.current.push(event)
			if (!flushTimerRef.current) {
				flushTimerRef.current = setTimeout(() => {
					flushTimerRef.current = null
					void flushPendingEvents()
				}, TEST_LABEL_STREAM_FLUSH_MS)
			}
		},
		[flushPendingEvents],
	)

	const authorsKey = (authors ?? []).join(',')

	useEffect(() => {
		const ndk = ndkActions.getNDK()
		if (!ndk) {
			// NDK not ready yet - will re-run when connected
			return
		}

		// Reset state when filter changes
		setProducts([])
		seenIds.current.clear()
		pendingBufferRef.current = []
		if (flushTimerRef.current) {
			clearTimeout(flushTimerRef.current)
			flushTimerRef.current = null
		}
		setIsStreaming(true)

		const filter = buildProductStreamFilter({ limit, tag, authors })
		if (!filter) {
			// Author scoping was requested (authors !== undefined) but no valid author
			// is available yet -- typically a profile page that rendered before its
			// pubkey resolved. Subscribing here would ask every relay for every
			// author and then label the results as that seller's products, so we
			// stream nothing until the caller has an author to scope by.
			setProducts([])
			setIsStreaming(false)
			return
		}

		// An author-scoped read must reach every relay we are connected to. NDK picks
		// relays per filter, and for an `authors` filter that selection can be a
		// subset holding none of that author's products (measured on a seller
		// profile: the subscription reached 2 relays while her products sat on 2
		// others), which renders as "this seller has no products". The unscoped feed
		// read keeps the library's default selection.
		const scopedRelaySet = filter.authors ? ndkActions.getConnectedRelaySet() : null
		const subscription = scopedRelaySet
			? ndk.subscribe(filter, { closeOnEose: true }, scopedRelaySet)
			: ndk.subscribe(filter, {
					closeOnEose: true,
				})

		subscriptionRef.current = subscription

		subscription.on('event', (event: NDKEvent) => {
			addProduct(event)
		})

		subscription.on('eose', () => {
			// Flush whatever is still buffered before declaring the stream done
			void flushPendingEvents().finally(() => setIsStreaming(false))
		})

		subscription.on('close', () => {
			void flushPendingEvents().finally(() => setIsStreaming(false))
		})

		// Timeout fallback - stop streaming after 10s even if no EOSE
		const timeout = setTimeout(() => {
			void flushPendingEvents().finally(() => setIsStreaming(false))
		}, 10000)

		return () => {
			clearTimeout(timeout)
			if (flushTimerRef.current) {
				clearTimeout(flushTimerRef.current)
				flushTimerRef.current = null
			}
			pendingBufferRef.current = []
			subscription.stop()
			subscriptionRef.current = null
		}
		// `authorsKey` keeps the dependency on author *content*, so a caller that
		// rebuilds the array on every render does not re-open the subscription
		// in a loop.
	}, [isConnected, tag, limit, addProduct, showOutOfStock, hidePreorder, country, flushPendingEvents, authorsKey, reloadToken])

	return {
		products,
		isStreaming,
		isConnected,
		count: products.length,
	}
}
