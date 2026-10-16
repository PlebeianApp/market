import {
	ProductCategoryTagSchema,
	ProductContentWarningTagSchema,
	ProductDimensionsTagSchema,
	ProductImageTagSchema,
	ProductPriceTagSchema,
	ProductSpecTagSchema,
	ProductStockTagSchema,
	ProductSummaryTagSchema,
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
import { filterBlacklistedEvents, filterBlacklistedPubkeys } from '@/lib/utils/blacklistFilters'
import { excludeTestLabeledEvents } from '@/queries/testLabels'
import { naddrFromAddress } from '@/lib/nostr/naddr'
import { isValidHexKey } from '@/lib/utils'
import { createNdkReadContext } from '@platform/web/ndkReadContext'
import {
	excludeDeletedProducts,
	isProductInStock as isProductInStockFromSdk,
	isProductListed,
	readProductListWorkflow,
	type ProductListingVisibility,
} from '@sdk/commerce/discovery'
import {
	getProductCategories as getProductCategoriesFromSdk,
	getProductCollection as getProductCollectionFromSdk,
	getProductContentWarning as getProductContentWarningFromSdk,
	getProductCoordinates as getProductCoordinatesFromSdk,
	getProductCreatedAt as getProductCreatedAtFromSdk,
	getProductDescription as getProductDescriptionFromSdk,
	getProductDimensions as getProductDimensionsFromSdk,
	getProductId as getProductIdFromSdk,
	getProductImages as getProductImagesFromSdk,
	getProductLocation as getProductLocationFromSdk,
	getProductPrice as getProductPriceFromSdk,
	getProductPubkey as getProductPubkeyFromSdk,
	getProductShippingOptions as getProductShippingOptionsFromSdk,
	getProductSpecs as getProductSpecsFromSdk,
	getProductStock as getProductStockFromSdk,
	getProductSummary as getProductSummaryFromSdk,
	getProductTitle as getProductTitleFromSdk,
	getProductType as getProductTypeFromSdk,
	getProductVisibility as getProductVisibilityFromSdk,
	getProductWeight as getProductWeightFromSdk,
	isNSFWProduct as isNSFWProductFromSdk,
} from '@sdk/commerce/discovery'

// Re-export productKeys for use in other query files
export { productKeys }

// Deleted and superseded listings are dropped by the shared event store (NIP-09, author-only).
const listProducts = async (
	query: { limit: number; tag?: string; until?: number; author?: string },
	visibility: ProductListingVisibility,
	options: { excludeTestLabeled: boolean },
): Promise<NDKEvent[]> => {
	const events = await readProductListWorkflow(createNdkReadContext(), query)
	const notBlacklisted = filterBlacklistedEvents(events)
	// ADR-0009: test labels are filtered beside the delete and blacklist checks
	const visible = options.excludeTestLabeled ? await excludeTestLabeledEvents(notBlacklisted) : notBlacklisted
	return visible.filter((event) => isProductListed(event, visibility))
}

// Helper to check if an ID looks like a Nostr event ID (64-hex characters)
export const isEventId = (id: string): boolean => /^[a-f0-9]{64}$/i.test(id)

/**
 * Checks if a product is in stock
 * Matches ProductCard logic: out of stock if no stock tag (unless pre-order) or stock = 0
 * @param event The product event
 * @returns true if the product is in stock
 */
export const isProductInStock = (event: NDKEvent): boolean => {
	return isProductInStockFromSdk(event)
}

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
	if (!ndk) {
		console.warn('NDK not ready, returning empty product list')
		return []
	}

	return listProducts({ limit, tag }, includeHidden ? 'all' : 'purchasable', { excludeTestLabeled: true })
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
	if (!ndk) {
		console.warn('NDK not ready, returning empty paginated product list')
		return []
	}

	return listProducts({ limit, until, tag }, includeHidden ? 'all' : 'not-hidden', { excludeTestLabeled: true })
}

/**
 * Fetches a single product listing
 * @param id The ID of the product listing
 * @returns The product listing event
 */
export const fetchProduct = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, cannot fetch product')
		return null
	}
	if (!id) return null

	// Kick off (or join) relay connection, but keep this fetch bounded.
	// React Query retries handle the eventual-consistency / propagation side.
	void ndkActions.connect(10000)

	const filter: NDKFilter = {
		kinds: [30402],
		ids: [id],
		limit: 1,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	const event = Array.from(events)[0] ?? null
	if (event) {
		return event
	}

	throw new Error('Product not found')
}

/**
 * Fetches all products from a specific pubkey
 * @param pubkey The pubkey of the seller
 * @param includeHidden Whether to include hidden products (default: false, should be true for own products)
 * @param limit Maximum number of products to return (default: 50)
 * @returns Array of product events sorted by creation date (blacklist filtered, optionally hidden products excluded)
 */
export const fetchProductsByPubkey = async (pubkey: string, includeHidden: boolean = false, limit: number = 50) => {
	if (!isValidHexKey(pubkey)) throw new Error('fetchProductsByPubkey: invalid seller pubkey')

	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, returning empty products by pubkey list')
		return []
	}

	// Owner views pass includeHidden and keep test-labeled items visible.
	return listProducts({ limit, author: pubkey }, includeHidden ? 'all' : 'purchasable', { excludeTestLabeled: false })
}

export const fetchProductByATag = async (pubkey: string, dTag: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!pubkey || !dTag) return null

	const naddr = naddrFromAddress(30402, pubkey, dTag)
	return await ndk.fetchEvent(naddr)
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
		staleTime: 30000, // Consider fresh for 30 seconds
		refetchOnMount: 'always', // Always refetch to pick up deletions
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
		enabled: isValidHexKey(pubkey),
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

	const notDeleted = await excludeDeletedProducts(createNdkReadContext(), filterBlacklistedEvents(allProducts))

	// Filter out test-labeled items (ADR-0009: runs beside the delete and blacklist checks)
	const nonTestLabeledProducts = await excludeTestLabeledEvents(notDeleted)

	// Filter out out-of-stock products from collection views
	return nonTestLabeledProducts.filter(isProductInStock)
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
	return getProductIdFromSdk(event)
}

/**
 * Gets the product coordinates in the format kind:pubkey:identifier
 * @param event The product event
 * @returns The product coordinates string
 */
export const getProductCoordinates = (event: NDKEvent): string => {
	return getProductCoordinatesFromSdk(event)
}

/**
 * Gets the product title from a product event
 * @param event The product event or null
 * @returns The product title string
 */
export const getProductTitle = (event: NDKEvent | null): z.infer<typeof ProductTitleTagSchema>[1] => getProductTitleFromSdk(event)

/**
 * Gets the product description from a product event
 * @param event The product event or null
 * @returns The product description string
 */
export const getProductDescription = (event: NDKEvent | null): string => getProductDescriptionFromSdk(event)

/**
 * Gets the product summary from a product event
 * @param event The product event or null
 * @returns The product summary string
 */
export const getProductSummary = (event: NDKEvent | null): z.infer<typeof ProductSummaryTagSchema>[1] => getProductSummaryFromSdk(event)

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
	return getProductPriceFromSdk(event) as z.infer<typeof ProductPriceTagSchema> | undefined
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
	return getProductImagesFromSdk(event) as z.infer<typeof ProductImageTagSchema>[]
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
	return getProductSpecsFromSdk(event) as z.infer<typeof ProductSpecTagSchema>[]
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
	return getProductTypeFromSdk(event) as z.infer<typeof ProductTypeTagSchema> | undefined
}

/**
 * Gets the visibility tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'visibility' (literal)
 * - [1]: visibility ('hidden' | 'on-sale' | 'pre-order')
 */
export const getProductVisibility = (event: NDKEvent | null): z.infer<typeof ProductVisibilityTagSchema> | undefined => {
	return getProductVisibilityFromSdk(event) as z.infer<typeof ProductVisibilityTagSchema> | undefined
}

/**
 * Gets the stock tag from a product event
 * @param event The product event or null
 * @returns A tuple with the format:
 * - [0]: 'stock' (literal)
 * - [1]: stock (string - numeric)
 */
export const getProductStock = (event: NDKEvent | null): z.infer<typeof ProductStockTagSchema> | undefined => {
	return getProductStockFromSdk(event) as z.infer<typeof ProductStockTagSchema> | undefined
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
	return getProductWeightFromSdk(event) as z.infer<typeof ProductWeightTagSchema> | undefined
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
	return getProductDimensionsFromSdk(event) as z.infer<typeof ProductDimensionsTagSchema> | undefined
}

/**
 * Gets the shipping option tags from a product event
 * @param event The product event or null
 * @returns An array of shipping option tuples with format [tag, shipping_reference, extra_cost?]
 */
export const getProductShippingOptions = (event: NDKEvent | null): Array<string[]> => {
	return getProductShippingOptionsFromSdk(event)
}

/**
 * Gets the collection tag from a product event
 * @param event The product event or null
 * @returns The collection reference string or null
 */
export const getProductCollection = (event: NDKEvent | null): string | null => {
	return getProductCollectionFromSdk(event)
}

/**
 * Gets the category tags from a product event
 * @param event The product event or null
 * @returns An array of category tuples
 */
export const getProductCategories = (event: NDKEvent | null): z.infer<typeof ProductCategoryTagSchema>[] => {
	return getProductCategoriesFromSdk(event) as z.infer<typeof ProductCategoryTagSchema>[]
}

/**
 * Gets the creation timestamp from a product event
 * @param event The product event or null
 * @returns The creation timestamp (number)
 */
export const getProductCreatedAt = (event: NDKEvent | null): number => getProductCreatedAtFromSdk(event)

/**
 * Gets the pubkey from a product event
 * @param event The product event or null
 * @returns The pubkey (string)
 */
export const getProductPubkey = (event: NDKEvent | null): string => getProductPubkeyFromSdk(event)

/**
 * Gets the location for product from the event tags
 * @param event The product event or null
 * @returns The location in string format or empty string
 */
export const getProductLocation = (event: NDKEvent | null): string => getProductLocationFromSdk(event)

/**
 * Gets the content warning tag from a product event
 * @param event The product event or null
 * @returns The content warning tuple or undefined
 */
export const getProductContentWarning = (event: NDKEvent | null): z.infer<typeof ProductContentWarningTagSchema> | undefined => {
	return getProductContentWarningFromSdk(event) as z.infer<typeof ProductContentWarningTagSchema> | undefined
}

/**
 * Checks if a product has NSFW content warning
 * @param event The product event or null
 * @returns true if the product is marked as NSFW
 */
export const isNSFWProduct = (event: NDKEvent | null): boolean => {
	return isNSFWProductFromSdk(event)
}

/**
 * Filters out NSFW products from an array of events
 * @param events Array of product events
 * @param showNSFW Whether to show NSFW products (if true, no filtering is done)
 * @returns Filtered array of product events
 */
export const filterNSFWProducts = (events: NDKEvent[], showNSFW: boolean): NDKEvent[] => {
	if (showNSFW) return events
	return events.filter((event) => !isNSFWProduct(event))
}

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

/**
 * Hook to check if a product is NSFW
 * @param id Product ID (event ID or d-tag)
 * @param sellerPubkey Optional seller pubkey (required when id is a d-tag)
 * @returns Query result with boolean indicating if product is NSFW
 */
export const useProductIsNSFW = (id: string, sellerPubkey?: string) => {
	return useQuery({
		...productSmartQueryOptions(id, sellerPubkey),
		select: isNSFWProduct,
	})
}

// --- PRODUCT SEARCH (NIP-50) ---

const PRODUCT_SEARCH_RELAYS = [
	'wss://relay.nostr.band',
	'wss://search.nos.today',
	'wss://nos.lol',
	'wss://nostr.wine',
	'wss://relay.primal.net',
]

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
	const SEARCH_TIMEOUT_MS = 15000
	try {
		const fetchPromise = ndk
			.fetchEvents(filter)
			.then((events) => filterBlacklistedEvents(Array.from(events)))
			.then((events) => excludeDeletedProducts(createNdkReadContext(), events))
			.then((events) => excludeTestLabeledEvents(events)) // Filter out test-labeled items (ADR-0009)
			.then((events) => events.filter(isProductInStock)) // Filter out out-of-stock products
			.catch((err) => {
				console.error('Product search fetch failed:', err)
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

	const SEARCH_TIMEOUT_MS = 10000 // Profile search timeout
	try {
		const fetchPromise = ndk
			.fetchEvents(filter)
			.then((events) => filterBlacklistedPubkeys(Array.from(events).map((e) => e.pubkey)))
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

	// If we found matching sellers, fetch their products directly by author pubkey
	// This queries the regular connected relays (not search relays) which support author filters
	let sellerProducts: import('@nostr-dev-kit/ndk').NDKEvent[] = []
	if (sellerPubkeys.length > 0) {
		try {
			const sellerProductPromises = sellerPubkeys.map((pubkey) => fetchProductsByPubkey(pubkey, false, 20))
			const sellerProductArrays = await Promise.all(sellerProductPromises)
			sellerProducts = sellerProductArrays.flat()
		} catch (err) {
			console.error('Failed to fetch seller products:', err)
		}
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

	// ADR-0009: search is a browsing/discovery surface, so the test-label gate
	// applies to the WHOLE merged set, not just the direct NIP-50 hits.
	// `fetchProductsBySearch` already gates its own results, but the
	// seller-expansion half arrives through `fetchProductsByPubkey`, which is
	// deliberately ungated — that path also serves the seller profile and the
	// owner's dashboard, where a labeled item MUST stay visible. Re-applying the
	// gate here is what keeps "hidden from browsing, search and collections"
	// true for a seller-name match instead of only for a title match.
	const nonTestLabeledResults = await excludeTestLabeledEvents(mergedResults)

	// Return up to the limit (after gating, so excluded items never consume slots)
	return nonTestLabeledResults.slice(0, limit)
}

/** React Query options for searching products by text. */
export const productsSearchQueryOptions = (query: string, limit: number = 20) =>
	queryOptions({
		queryKey: [...productKeys.all, 'search', query, limit],
		queryFn: () => fetchProductsBySearch(query, limit),
		enabled: !!query?.trim(),
	})

/** Hook to search products by matching product text. */
export const useProductSearch = (query: string, options?: { enabled?: boolean; limit?: number }) => {
	return useQuery({
		...productsSearchQueryOptions(query, options?.limit ?? 20),
		enabled: options?.enabled ?? !!query?.trim(),
	})
}
