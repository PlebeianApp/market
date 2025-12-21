import {
	ProductCategoryTagSchema,
	ProductDimensionsTagSchema,
	ProductImageTagSchema,
	ProductPriceTagSchema,
	ProductSpecTagSchema,
	ProductStockTagSchema,
	ProductTitleTagSchema,
	ProductTypeTagSchema,
	ProductVisibilityTagSchema,
	ProductWeightTagSchema,
} from '@/lib/schemas/productListing'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { productKeys } from './queryKeyFactory'
import { getCoordsFromATag, getATagFromCoords } from '@/lib/utils/coords.ts'
import { discoverNip50Relays } from '@/lib/relays'
import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'

// Re-export productKeys for use in other query files
export { productKeys }

// Helper to check if an ID looks like a Nostr event ID (64-hex characters)
export const isEventId = (id: string): boolean => /^[a-f0-9]{64}$/i.test(id)

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches all product listings
 * @param limit Maximum number of products to fetch (default: 500)
 * @param tag Optional tag to filter products by
 * @param includeHidden Whether to include hidden products (default: false)
 * @returns Array of product events sorted by creation date (blacklist filtered, optionally hidden products excluded)
 */
export const fetchProducts = async (limit: number = 500, tag?: string, includeHidden: boolean = false) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402], // Product listings in Nostr
		limit,
		...(tag && { '#t': [tag] }), // Add tag filter if provided
	}

	const events = await ndk.fetchEvents(filter)
	const allEvents = Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

	// Filter out blacklisted products and authors
	const filteredEvents = filterBlacklistedEvents(allEvents)

	// Filter out hidden products unless explicitly included
	if (includeHidden) {
		return filteredEvents
	}

	return filteredEvents.filter((event) => {
		const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
		const visibility = visibilityTag?.[1] || 'on-sale' // Default to on-sale if not specified
		return visibility !== 'hidden'
	})
}

/**
 * Fetches product listings with pagination support
 * @param limit Number of products to fetch (default: 20)
 * @param until Timestamp to fetch products before (for pagination)
 * @param tag Optional tag to filter products by
 * @param includeHidden Whether to include hidden products (default: false)
 * @returns Array of product events sorted by creation date (blacklist filtered, optionally hidden products excluded)
 */
export const fetchProductsPaginated = async (limit: number = 20, until?: number, tag?: string, includeHidden: boolean = false) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402], // Product listings in Nostr
		limit,
		...(until && { until }),
		...(tag && { '#t': [tag] }), // Add tag filter if provided
	}

	const events = await ndk.fetchEvents(filter)
	const allEvents = Array.from(events).sort((a, b) => b.created_at! - a.created_at!)

	// Filter out blacklisted products and authors
	const filteredEvents = filterBlacklistedEvents(allEvents)

	// Filter out hidden products unless explicitly included
	if (includeHidden) {
		return filteredEvents
	}

	return filteredEvents.filter((event) => {
		const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
		const visibility = visibilityTag?.[1] || 'on-sale' // Default to on-sale if not specified
		return visibility !== 'hidden'
	})
}

/**
 * Fetches a single product listing
 * @param id The ID of the product listing
 * @returns The product listing event
 */
export const fetchProduct = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!id) return null
	const event = await ndk.fetchEvent({
		ids: [id],
	})
	if (!event) {
		throw new Error('Product not found')
	}

	return event
}

/**
 * Fetches all products from a specific pubkey
 * @param pubkey The pubkey of the seller
 * @param includeHidden Whether to include hidden products (default: false, should be true for own products)
 * @param limit Maximum number of products to return (default: 50)
 * @returns Array of product events sorted by creation date (blacklist filtered, optionally hidden products excluded)
 */
export const fetchProductsByPubkey = async (pubkey: string, includeHidden: boolean = false, limit: number = 50) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402],
		authors: [pubkey],
		limit,
	}

	const events = await ndk.fetchEvents(filter)
	const allEvents = Array.from(events)

	// Filter out blacklisted products (author check not needed since we're querying by author)
	const filteredEvents = filterBlacklistedEvents(allEvents)

	// Filter out hidden products unless explicitly included
	if (includeHidden) {
		return filteredEvents
	}

	return filteredEvents.filter((event) => {
		const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
		const visibility = visibilityTag?.[1] || 'on-sale' // Default to on-sale if not specified
		return visibility !== 'hidden'
	})
}

export const fetchProductByATag = async (pubkey: string, dTag: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!pubkey || !dTag) return null
	const filter: NDKFilter = {
		kinds: [30402],
		authors: [pubkey],
		'#d': [dTag],
	}
	return await ndk.fetchEvent(filter)
}

/**
 * Smart product fetching that handles both event IDs and d-tags
 * @param id The product identifier (either event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns The product event or null
 */
export const fetchProductSmart = async (id: string, sellerPubkey?: string): Promise<NDKEvent | null> => {
	if (!id) return null

	// If it looks like an event ID (64 hex chars), fetch by event ID
	if (isEventId(id)) {
		try {
			return await fetchProduct(id)
		} catch (error) {
			// If not found by event ID, it might be a malformed d-tag or truly not found
			console.warn(`Product not found by event ID ${id}:`, error)
			return null
		}
	}

	// Otherwise, it's a d-tag - we need the seller pubkey
	if (sellerPubkey) {
		return await fetchProductByATag(sellerPubkey, id)
	}

	// No seller pubkey provided for a d-tag - can't fetch
	console.warn(`Cannot fetch product by d-tag "${id}" without seller pubkey`)
	return null
}

// --- REACT QUERY OPTIONS ---

/**
 * React Query options for fetching a single product
 * @param id Product ID
 * @returns Query options object
 */
export const productQueryOptions = (id: string) =>
	queryOptions({
		queryKey: productKeys.details(id),
		queryFn: () => fetchProduct(id),
		staleTime: 300000, // Added staleTime of 5 minutes (300,000 ms)
	})

/**
 * React Query options for smart product fetching (handles both event IDs and d-tags)
 * @param id The product identifier (either event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns Query options object
 */
export const productSmartQueryOptions = (id: string, sellerPubkey?: string) =>
	queryOptions({
		queryKey: sellerPubkey ? [...productKeys.details(id), sellerPubkey] : productKeys.details(id),
		queryFn: () => fetchProductSmart(id, sellerPubkey),
		staleTime: 300000,
		enabled: isEventId(id) || !!sellerPubkey, // Only enable if we have enough info to fetch
	})

/**
 * React Query options for fetching all products
 */
export const productsQueryOptions = (limit: number = 500, tag?: string) =>
	queryOptions({
		queryKey: tag ? [...productKeys.all, 'tag', tag] : productKeys.all,
		queryFn: () => fetchProducts(limit, tag),
	})

/**
 * React Query options for fetching products with pagination
 * @param limit Number of products to fetch
 * @param until Timestamp to fetch products before
 * @param tag Optional tag to filter products by
 */
export const productsPaginatedQueryOptions = (limit: number = 20, until?: number, tag?: string) =>
	queryOptions({
		queryKey: tag ? [...productKeys.paginated(limit, until), 'tag', tag] : productKeys.paginated(limit, until),
		queryFn: () => fetchProductsPaginated(limit, until, tag),
		staleTime: 300000, // 5 minutes
	})

/**
 * React Query options for fetching products by pubkey
 * @param pubkey Seller's pubkey
 * @param includeHidden Whether to include hidden products (default: false)
 */
export const productsByPubkeyQueryOptions = (pubkey: string, includeHidden: boolean = false) =>
	queryOptions({
		queryKey: includeHidden ? [...productKeys.byPubkey(pubkey), 'includeHidden'] : productKeys.byPubkey(pubkey),
		queryFn: () => fetchProductsByPubkey(pubkey, includeHidden),
	})

/**
 * React Query options for getting a product seller's pubkey
 * @param id Product ID
 * @returns Query options object
 */
export const productSellerQueryOptions = (id: string) =>
	queryOptions({
		queryKey: productKeys.seller(id),
		queryFn: () => getProductSellerPubkey(id),
	})

/**
 * React Query options for fetching a product by addressable tag (a-tag)
 * @param pubkey The pubkey of the author
 * @param dTag The d-tag identifier
 * @returns Query options object
 */
export const productByATagQueryOptions = (pubkey: string, dTag: string) =>
	queryOptions({
		queryKey: productKeys.byATag(pubkey, dTag),
		queryFn: () => fetchProductByATag(pubkey, dTag),
		staleTime: 300000,
	})

/**
 * Fetches products contained in a collection by parsing a-tags
 * @param collectionEvent The collection event containing a-tags
 * @returns Array of product events (blacklist filtered)
 */
export const fetchProductsByCollection = async (collectionEvent: NDKEvent): Promise<NDKEvent[]> => {
	if (!collectionEvent) return []

	// Get a-tags from the collection event
	const aTags = collectionEvent.getMatchingTags('a')

	// Parse each a-tag and fetch the corresponding product
	const productPromises = aTags.map(async (tag) => {
		const aTagValue = tag[1] // Format: "kind:pubkey:identifier"
		if (!aTagValue) return null

		try {
			// Use the improved coordinate parsing utility
			const coords = getCoordsFromATag(aTagValue)

			// Only process product events (kind 30402)
			if (coords.kind !== 30402) {
				console.warn(`Skipping non-product a-tag: ${aTagValue} (kind: ${coords.kind})`)
				return null
			}

			return await fetchProductByATag(coords.pubkey, coords.identifier)
		} catch (error) {
			console.warn(`Failed to fetch product from a-tag ${aTagValue}:`, error)
			return null
		}
	})

	const results = await Promise.all(productPromises)
	const allProducts = results.filter((event) => event !== null) as NDKEvent[]

	// Filter out blacklisted products and authors
	return filterBlacklistedEvents(allProducts)
}

/**
 * React Query options for fetching products by collection
 * @param collectionEvent The collection event
 * @returns Query options object
 */
export const productsByCollectionQueryOptions = (collectionEvent: NDKEvent | null) => {
	// Generate a consistent query key using coordinate utilities
	const collectionCoords = collectionEvent
		? getATagFromCoords({
				kind: collectionEvent.kind!,
				pubkey: collectionEvent.pubkey,
				identifier: collectionEvent.dTag || '',
			})
		: ''

	return queryOptions({
		queryKey: productKeys.byCollection(collectionCoords),
		queryFn: () => fetchProductsByCollection(collectionEvent!),
		enabled: !!collectionEvent,
		staleTime: 300000,
	})
}

// --- HELPER FUNCTIONS (DATA EXTRACTION) ---

/**
 * Gets the product ID from a product event
 * @param event The product event or null
 * @returns The product ID string
 */
export const getProductId = (event: NDKEvent | null): string => {
	const dTag = event?.tags.find((t) => t[0] === 'd')
	return dTag?.[1] || ''
}

/**
 * Gets the product coordinates in the format kind:pubkey:identifier
 * @param event The product event
 * @returns The product coordinates string
 */
export const getProductCoordinates = (event: NDKEvent): string => {
	const id = getProductId(event)
	return `30402:${event.pubkey}:${id}`
}

/**
 * Gets the product title from a product event
 * @param event The product event or null
 * @returns The product title string
 */
export const getProductTitle = (event: NDKEvent | null): z.infer<typeof ProductTitleTagSchema>[1] =>
	event?.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Product'

/**
 * Gets the product description from a product event
 * @param event The product event or null
 * @returns The product description string
 */
export const getProductDescription = (event: NDKEvent | null): string => event?.content || ''

/**
 * Gets the price tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'price' (literal)
 * - [1]: amount (string)
 * - [2]: currency (string)
 * - [3]: frequency (optional string)
 */
export const getProductPrice = (event: NDKEvent | null): z.infer<typeof ProductPriceTagSchema> | undefined => {
	if (!event) return undefined
	const priceTag = event.tags.find((t) => t[0] === 'price')
	if (!priceTag) return undefined

	// Return the tuple directly to match the schema
	return priceTag as z.infer<typeof ProductPriceTagSchema>
}

/**
 * Gets the image tags from a product event
 * @param event The product event or null
 * @returns An array of tuples with the format:
 * - [0]: 'image' (literal)
 * - [1]: url (string)
 * - [2]: dimensions (optional string)
 * - [3]: order (optional string - numeric)
 */
export const getProductImages = (event: NDKEvent | null): z.infer<typeof ProductImageTagSchema>[] => {
	if (!event) return []
	return event.tags
		.filter((t) => t[0] === 'image')
		.map((t) => t as z.infer<typeof ProductImageTagSchema>)
		.sort((a, b) => {
			// Sort by order if available
			if (a[3] && b[3]) {
				return parseInt(a[3]) - parseInt(b[3])
			}
			return 0
		})
}

/**
 * Gets the spec tags from a product event
 * @param event The product event or null
 * @returns An array of tuples with the format:
 * - [0]: 'spec' (literal)
 * - [1]: key (string)
 * - [2]: value (string)
 */
export const getProductSpecs = (event: NDKEvent | null): z.infer<typeof ProductSpecTagSchema>[] => {
	if (!event) return []
	return event.tags.filter((t) => t[0] === 'spec').map((t) => t as z.infer<typeof ProductSpecTagSchema>)
}

/**
 * Gets the type tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'type' (literal)
 * - [1]: productType ('simple' | 'variable' | 'variation')
 * - [2]: physicalType ('digital' | 'physical')
 */
export const getProductType = (event: NDKEvent | null): z.infer<typeof ProductTypeTagSchema> | undefined => {
	if (!event) return undefined
	const typeTag = event.tags.find((t) => t[0] === 'type')
	if (!typeTag) return undefined

	return typeTag as z.infer<typeof ProductTypeTagSchema>
}

/**
 * Gets the visibility tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'visibility' (literal)
 * - [1]: visibility ('hidden' | 'on-sale' | 'pre-order')
 */
export const getProductVisibility = (event: NDKEvent | null): z.infer<typeof ProductVisibilityTagSchema> | undefined => {
	if (!event) return undefined
	const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
	return visibilityTag ? (visibilityTag as z.infer<typeof ProductVisibilityTagSchema>) : undefined
}

/**
 * Gets the stock tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'stock' (literal)
 * - [1]: stock (string - numeric)
 */
export const getProductStock = (event: NDKEvent | null): z.infer<typeof ProductStockTagSchema> | undefined => {
	if (!event) return undefined
	const stockTag = event.tags.find((t) => t[0] === 'stock')
	return stockTag ? (stockTag as z.infer<typeof ProductStockTagSchema>) : undefined
}

/**
 * Gets the weight tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'weight' (literal)
 * - [1]: value (string - numeric)
 * - [2]: unit (string)
 */
export const getProductWeight = (event: NDKEvent | null): z.infer<typeof ProductWeightTagSchema> | undefined => {
	if (!event) return undefined
	const weightTag = event.tags.find((t) => t[0] === 'weight')
	if (!weightTag) return undefined

	return weightTag as z.infer<typeof ProductWeightTagSchema>
}

/**
 * Gets the dimensions tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'dim' (literal)
 * - [1]: dimensions (string - in format LxWxH)
 * - [2]: unit (string)
 */
export const getProductDimensions = (event: NDKEvent | null): z.infer<typeof ProductDimensionsTagSchema> | undefined => {
	if (!event) return undefined
	const dimensionsTag = event.tags.find((t) => t[0] === 'dim')
	if (!dimensionsTag) return undefined

	return dimensionsTag as z.infer<typeof ProductDimensionsTagSchema>
}

/**
 * Gets the shipping option tags from a product event
 * @param event The product event or null
 * @returns An array of shipping option tuples with format [tag, shipping_reference, extra_cost?]
 */
export const getProductShippingOptions = (event: NDKEvent | null): Array<string[]> => {
	if (!event) return []
	return event.tags.filter((t) => t[0] === 'shipping_option')
}

/**
 * Gets the collection tag from a product event
 * @param event The product event or null
 * @returns The collection reference string or null
 */
export const getProductCollection = (event: NDKEvent | null): string | null => {
	if (!event) return null
	const collectionTag = event.tags.find((t) => t[0] === 'collection')
	return collectionTag?.[1] || null
}

/**
 * Gets the category tags from a product event
 * @param event The product event or null
 * @returns An array of category tuples
 */
export const getProductCategories = (event: NDKEvent | null): z.infer<typeof ProductCategoryTagSchema>[] => {
	if (!event) return []
	return event.tags.filter((t) => t[0] === 't').map((t) => t as z.infer<typeof ProductCategoryTagSchema>)
}

/**
 * Gets the creation timestamp from a product event
 * @param event The product event or null
 * @returns The creation timestamp (number)
 */
export const getProductCreatedAt = (event: NDKEvent | null): number => event?.created_at || 0

/**
 * Gets the pubkey from a product event
 * @param event The product event or null
 * @returns The pubkey (string)
 */
export const getProductPubkey = (event: NDKEvent | null): string => event?.pubkey || ''

/**
 * Gets the event that created a product based on its ID
 * @param id The product event ID
 * @returns A promise that resolves to the NDKEvent or null if not found
 */
export const getProductEvent = async (id: string) => {
	try {
		return id ? await fetchProduct(id) : null
	} catch (error) {
		console.error(`Failed to fetch product event: ${id}`, error)
		return null
	}
}

/**
 * Gets the pubkey of the seller for a product
 * @param id The product event ID
 * @returns A promise that resolves to the seller's pubkey or null if not found
 */
export const getProductSellerPubkey = async (id: string) => {
	const event = await getProductEvent(id)
	return event ? event.pubkey : null
}

// --- REACT QUERY HOOKS ---

/**
 * Hook to get the product title
 * @param id Product ID (event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns Query result with the product title
 */
export const useProductTitle = (id: string, sellerPubkey?: string) => {
	return useQuery({
		...productSmartQueryOptions(id, sellerPubkey),
		select: getProductTitle,
	})
}

/**
 * Hook to get the product description
 * @param id Product ID (event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns Query result with the product description
 */
export const useProductDescription = (id: string, sellerPubkey?: string) => {
	return useQuery({
		...productSmartQueryOptions(id, sellerPubkey),
		select: getProductDescription,
	})
}

/**
 * Hook to get the product price
 * @param id Product ID (event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns Query result with the product price tuple
 */
export const useProductPrice = (id: string, sellerPubkey?: string) => {
	return useQuery({
		...productSmartQueryOptions(id, sellerPubkey),
		select: getProductPrice,
	})
}

/**
 * Hook to get the product images
 * @param id Product ID (event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns Query result with an array of image tuples
 */
export const useProductImages = (id: string, sellerPubkey?: string) => {
	return useQuery({
		...productSmartQueryOptions(id, sellerPubkey),
		select: getProductImages,
	})
}

/**
 * Hook to get the product specs
 * @param id Product ID
 * @returns Query result with an array of spec tuples
 */
export const useProductSpecs = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductSpecs,
	})
}

/**
 * Hook to get the product type
 * @param id Product ID
 * @returns Query result with the product type tuple
 */
export const useProductType = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductType,
	})
}

/**
 * Hook to get the product visibility
 * @param id Product ID
 * @returns Query result with the product visibility tuple
 */
export const useProductVisibility = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductVisibility,
	})
}

/**
 * Hook to get the product stock
 * @param id Product ID (event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns Query result with the product stock tuple
 */
export const useProductStock = (id: string, sellerPubkey?: string) => {
	return useQuery({
		...productSmartQueryOptions(id, sellerPubkey),
		select: getProductStock,
	})
}

/**
 * Hook to get the product weight
 * @param id Product ID
 * @returns Query result with the product weight tuple
 */
export const useProductWeight = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductWeight,
	})
}

/**
 * Hook to get the product dimensions
 * @param id Product ID
 * @returns Query result with the product dimensions tuple
 */
export const useProductDimensions = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductDimensions,
	})
}

/**
 * Hook to get the product categories
 * @param id Product ID
 * @returns Query result with an array of category tuples
 */
export const useProductCategories = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductCategories,
	})
}

/**
 * Hook to get the product creation timestamp
 * @param id Product ID
 * @returns Query result with the creation timestamp
 */
export const useProductCreatedAt = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductCreatedAt,
	})
}

/**
 * Hook to get the product pubkey
 * @param id Product ID
 * @returns Query result with the pubkey
 */
export const useProductPubkey = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductPubkey,
	})
}

/**
 * Hook to get products by pubkey
 * @param pubkey Seller's pubkey
 * @param includeHidden Whether to include hidden products (default: false)
 * @returns Query result with an array of product events
 */
export const useProductsByPubkey = (pubkey: string, includeHidden: boolean = false) => {
	return useQuery({
		...productsByPubkeyQueryOptions(pubkey, includeHidden),
	})
}

/**
 * Hook to get the seller's pubkey for a product
 * @param id Product ID
 * @returns Query result with the seller's pubkey
 */
export const useProductSeller = (id: string) => {
	return useQuery({
		...productSellerQueryOptions(id),
	})
}

/**
 * Hook to get products by collection
 * @param collectionEvent The collection event
 * @returns Query result with an array of product events
 */
export const useProductsByCollection = (collectionEvent: NDKEvent | null) => {
	return useQuery({
		...productsByCollectionQueryOptions(collectionEvent),
	})
}

/**
 * Hook to get a product by addressable tag (a-tag)
 * @param pubkey The pubkey of the author
 * @param dTag The d-tag identifier
 * @returns Query result with the product event
 */
export const useProductByATag = (pubkey: string, dTag: string) => {
	return useQuery({
		...productByATagQueryOptions(pubkey, dTag),
	})
}

// --- PRODUCT SEARCH (NIP-50) ---

const PRODUCT_SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://search.nos.today', 'wss://nos.lol']

/**
 * Search for product listing events (kind 30402) by free-text query.
 * Uses NIP-50 `search` on relays that support it.
 */
export const fetchProductsBySearch = async (query: string, limit: number = 20) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!query?.trim()) return []

	// Discover relays that claim NIP-50 support via NIP-11 and connect to them
	let relays: string[] = []
	try {
		relays = await discoverNip50Relays(PRODUCT_SEARCH_RELAYS)
	} catch (e) {
		console.warn('NIP-11 discovery failed, falling back to static search relays')
	}
	if (!relays || relays.length === 0) {
		relays = PRODUCT_SEARCH_RELAYS
	}
	try {
		ndkActions.addExplicitRelay(relays)
	} catch (error) {
		console.error('Failed to add discovered search relays:', error)
	}

	const filter: NDKFilter = {
		kinds: [30402],
		search: query,
		limit,
	}

	// In some deployments, ndk.fetchEvents may hang if relays are slow/unresponsive.
	// Race the fetch with a timeout so the UI can recover gracefully.
	const SEARCH_TIMEOUT_MS = 8000
	try {
		const fetchPromise = ndk
			.fetchEvents(filter)
			.then((events) => Array.from(events))
			.catch((err) => {
				console.error('Search fetch failed:', err)
				return []
			})

		const timeoutPromise = new Promise<import('@nostr-dev-kit/ndk').NDKEvent[]>((resolve) => {
			setTimeout(() => {
				console.warn(`Search timed out after ${SEARCH_TIMEOUT_MS}ms`, { query })
				resolve([])
			}, SEARCH_TIMEOUT_MS)
		})

		return await Promise.race([fetchPromise, timeoutPromise])
	} catch (e) {
		console.error('Search error:', e)
		return []
	}
}

/**
 * Search for profile events (kind 0) by name/displayName.
 * Uses NIP-50 `search` on relays that support it.
 * Returns pubkeys of matching profiles.
 */
export const fetchSellersBySearch = async (query: string, limit: number = 10): Promise<string[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!query?.trim()) return []

	// Use the same relay discovery as product search
	let relays: string[] = []
	try {
		relays = await discoverNip50Relays(PRODUCT_SEARCH_RELAYS)
	} catch (e) {
		console.warn('NIP-11 discovery failed for profile search, falling back to static search relays')
	}
	if (!relays || relays.length === 0) {
		relays = PRODUCT_SEARCH_RELAYS
	}
	try {
		ndkActions.addExplicitRelay(relays)
	} catch (error) {
		console.error('Failed to add discovered search relays for profile search:', error)
	}

	const filter: NDKFilter = {
		kinds: [0], // Profile events
		search: query,
		limit,
	}

	const SEARCH_TIMEOUT_MS = 5000 // Shorter timeout for profile search
	try {
		const fetchPromise = ndk
			.fetchEvents(filter)
			.then((events) => Array.from(events).map((e) => e.pubkey))
			.catch((err) => {
				console.error('Profile search fetch failed:', err)
				return []
			})

		const timeoutPromise = new Promise<string[]>((resolve) => {
			setTimeout(() => {
				console.warn(`Profile search timed out after ${SEARCH_TIMEOUT_MS}ms`, { query })
				resolve([])
			}, SEARCH_TIMEOUT_MS)
		})

		return await Promise.race([fetchPromise, timeoutPromise])
	} catch (e) {
		console.error('Profile search error:', e)
		return []
	}
}

/**
 * Combined search that searches both products and seller names.
 * Returns products matching the query directly OR products from sellers whose name matches.
 */
export const fetchProductsBySearchWithSellers = async (
	query: string,
	limit: number = 20,
): Promise<import('@nostr-dev-kit/ndk').NDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!query?.trim()) return []

	// Run product search and seller search in parallel
	const [productResults, sellerPubkeys] = await Promise.all([fetchProductsBySearch(query, limit), fetchSellersBySearch(query, 5)])

	// If we found matching sellers, fetch their products
	let sellerProducts: import('@nostr-dev-kit/ndk').NDKEvent[] = []
	if (sellerPubkeys.length > 0) {
		// Fetch products from matching sellers (limit per seller to avoid overwhelming)
		const sellerProductPromises = sellerPubkeys.map((pubkey) => fetchProductsByPubkey(pubkey, false, 10))
		const sellerProductArrays = await Promise.all(sellerProductPromises)
		sellerProducts = sellerProductArrays.flat()
	}

	// Merge and deduplicate results (product results first, then seller products)
	const seenIds = new Set<string>()
	const mergedResults: import('@nostr-dev-kit/ndk').NDKEvent[] = []

	// Add product search results first (direct matches are prioritized)
	for (const product of productResults) {
		if (!seenIds.has(product.id)) {
			seenIds.add(product.id)
			mergedResults.push(product)
		}
	}

	// Add seller products (if not already in results)
	for (const product of sellerProducts) {
		if (!seenIds.has(product.id)) {
			seenIds.add(product.id)
			mergedResults.push(product)
		}
	}

	// Return up to the limit
	return mergedResults.slice(0, limit)
}

/** React Query options for searching products by text (includes seller name search) */
export const productsSearchQueryOptions = (query: string, limit: number = 20) =>
	queryOptions({
		queryKey: [...productKeys.all, 'search', query, limit],
		queryFn: () => fetchProductsBySearchWithSellers(query, limit),
		enabled: !!query?.trim(),
	})

/** Hook to search products by text (includes seller name search) */
export const useProductSearch = (query: string, options?: { enabled?: boolean; limit?: number }) => {
	return useQuery({
		...productsSearchQueryOptions(query, options?.limit ?? 20),
		enabled: options?.enabled ?? !!query?.trim(),
	})
}
