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

// Re-export productKeys for use in other query files
export { productKeys }

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches all product listings
 * @param limit Maximum number of products to fetch (default: 500)
 * @param tag Optional tag to filter products by
 * @returns Array of product events sorted by creation date (blacklist filtered)
 */
export const fetchProducts = async (limit: number = 500, tag?: string) => {
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
	return filterBlacklistedEvents(allEvents)
}

/**
 * Fetches product listings with pagination support
 * @param limit Number of products to fetch (default: 20)
 * @param until Timestamp to fetch products before (for pagination)
 * @param tag Optional tag to filter products by
 * @returns Array of product events sorted by creation date (blacklist filtered)
 */
export const fetchProductsPaginated = async (limit: number = 20, until?: number, tag?: string) => {
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
	return filterBlacklistedEvents(allEvents)
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
 * @returns Array of product events sorted by creation date (blacklist filtered)
 */
export const fetchProductsByPubkey = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402],
		authors: [pubkey],
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	const allEvents = Array.from(events)

	// Filter out blacklisted products (author check not needed since we're querying by author)
	return filterBlacklistedEvents(allEvents)
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
 */
export const productsByPubkeyQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: productKeys.byPubkey(pubkey),
		queryFn: () => fetchProductsByPubkey(pubkey),
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
 * @param id Product ID
 * @returns Query result with the product title
 */
export const useProductTitle = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductTitle,
	})
}

/**
 * Hook to get the product description
 * @param id Product ID
 * @returns Query result with the product description
 */
export const useProductDescription = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductDescription,
	})
}

/**
 * Hook to get the product price
 * @param id Product ID
 * @returns Query result with the product price tuple
 */
export const useProductPrice = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductPrice,
	})
}

/**
 * Hook to get the product images
 * @param id Product ID
 * @returns Query result with an array of image tuples
 */
export const useProductImages = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
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
 * @param id Product ID
 * @returns Query result with the product stock tuple
 */
export const useProductStock = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
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
 * @returns Query result with an array of product events
 */
export const useProductsByPubkey = (pubkey: string) => {
	return useQuery({
		...productsByPubkeyQueryOptions(pubkey),
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

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}

/** React Query options for searching products by text */
export const productsSearchQueryOptions = (query: string, limit: number = 20) =>
	queryOptions({
		queryKey: [...productKeys.all, 'search', query, limit],
		queryFn: () => fetchProductsBySearch(query, limit),
		enabled: !!query?.trim(),
	})

/** Hook to search products by text */
export const useProductSearch = (query: string, options?: { enabled?: boolean; limit?: number }) => {
	return useQuery({
		...productsSearchQueryOptions(query, options?.limit ?? 20),
		enabled: options?.enabled ?? !!query?.trim(),
	})
}
