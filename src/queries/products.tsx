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
	ProductWeightTagSchema
} from '@/lib/schemas/productListing'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { productKeys } from './queryKeyFactory'

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches all product listings
 * @returns Array of product events sorted by creation date
 */
export const fetchProducts = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402], // Product listings in Nostr
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}

/**
 * Fetches a single product listing
 * @param id The ID of the product listing
 * @returns The product listing event
 */
export const fetchProduct = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Product not found')
	}

	return event
}

/**
 * Fetches all products from a specific pubkey
 * @param pubkey The pubkey of the seller
 * @returns Array of product events sorted by creation date
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
	return Array.from(events)
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
	})

/**
 * React Query options for fetching all products
 */
export const productsQueryOptions = queryOptions({
	queryKey: productKeys.all,
	queryFn: fetchProducts,
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

// --- HELPER FUNCTIONS (DATA EXTRACTION) ---

/**
 * Gets the product title from a product event
 * @param event The product event
 * @returns The product title string
 */
export const getProductTitle = (event: NDKEvent): z.infer<typeof ProductTitleTagSchema>[1] =>
	event.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Product'

/**
 * Gets the product description from a product event
 * @param event The product event
 * @returns The product description string
 */
export const getProductDescription = (event: NDKEvent): string => event.content || ''

/**
 * Gets the price tag from a product event
 * @param event The product event
 * @returns A tuple with the format:
 * - [0]: 'price' (literal)
 * - [1]: amount (string)
 * - [2]: currency (string)
 * - [3]: frequency (optional string)
 */
export const getProductPrice = (event: NDKEvent): z.infer<typeof ProductPriceTagSchema> | undefined => {
	const priceTag = event.tags.find((t) => t[0] === 'price')
	if (!priceTag) return undefined

	// Return the tuple directly to match the schema
	return priceTag as z.infer<typeof ProductPriceTagSchema>
}

/**
 * Gets the image tags from a product event
 * @param event The product event
 * @returns An array of tuples with the format:
 * - [0]: 'image' (literal)
 * - [1]: url (string)
 * - [2]: dimensions (optional string)
 * - [3]: order (optional string - numeric)
 */
export const getProductImages = (event: NDKEvent): z.infer<typeof ProductImageTagSchema>[] => {
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
 * @param event The product event
 * @returns An array of tuples with the format:
 * - [0]: 'spec' (literal)
 * - [1]: key (string)
 * - [2]: value (string)
 */
export const getProductSpecs = (event: NDKEvent): z.infer<typeof ProductSpecTagSchema>[] => {
	return event.tags.filter((t) => t[0] === 'spec').map((t) => t as z.infer<typeof ProductSpecTagSchema>)
}

/**
 * Gets the type tag from a product event
 * @param event The product event
 * @returns A tuple with the format:
 * - [0]: 'type' (literal)
 * - [1]: productType ('simple' | 'variable' | 'variation')
 * - [2]: physicalType ('digital' | 'physical')
 */
export const getProductType = (event: NDKEvent): z.infer<typeof ProductTypeTagSchema> | undefined => {
	const typeTag = event.tags.find((t) => t[0] === 'type')
	if (!typeTag) return undefined

	return typeTag as z.infer<typeof ProductTypeTagSchema>
}

/**
 * Gets the visibility tag from a product event
 * @param event The product event
 * @returns A tuple with the format:
 * - [0]: 'visibility' (literal)
 * - [1]: visibility ('hidden' | 'on-sale' | 'pre-order')
 */
export const getProductVisibility = (event: NDKEvent): z.infer<typeof ProductVisibilityTagSchema> | undefined => {
	const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
	return visibilityTag ? (visibilityTag as z.infer<typeof ProductVisibilityTagSchema>) : undefined
}

/**
 * Gets the stock tag from a product event
 * @param event The product event
 * @returns A tuple with the format:
 * - [0]: 'stock' (literal)
 * - [1]: stock (string - numeric)
 */
export const getProductStock = (event: NDKEvent): z.infer<typeof ProductStockTagSchema> | undefined => {
	const stockTag = event.tags.find((t) => t[0] === 'stock')
	return stockTag ? (stockTag as z.infer<typeof ProductStockTagSchema>) : undefined
}

/**
 * Gets the weight tag from a product event
 * @param event The product event
 * @returns A tuple with the format:
 * - [0]: 'weight' (literal)
 * - [1]: value (string - numeric)
 * - [2]: unit (string)
 */
export const getProductWeight = (event: NDKEvent): z.infer<typeof ProductWeightTagSchema> | undefined => {
	const weightTag = event.tags.find((t) => t[0] === 'weight')
	if (!weightTag) return undefined

	return weightTag as z.infer<typeof ProductWeightTagSchema>
}

/**
 * Gets the dimensions tag from a product event
 * @param event The product event
 * @returns A tuple with the format:
 * - [0]: 'dim' (literal)
 * - [1]: dimensions (string - in format LxWxH)
 * - [2]: unit (string)
 */
export const getProductDimensions = (event: NDKEvent): z.infer<typeof ProductDimensionsTagSchema> | undefined => {
	const dimensionsTag = event.tags.find((t) => t[0] === 'dim')
	if (!dimensionsTag) return undefined

	return dimensionsTag as z.infer<typeof ProductDimensionsTagSchema>
}

/**
 * Gets the category tags from a product event
 * @param event The product event
 * @returns An array of category tuples
 */
export const getProductCategories = (event: NDKEvent): z.infer<typeof ProductCategoryTagSchema>[] => {
	return event.tags.filter((t) => t[0] === 't').map((t) => t as z.infer<typeof ProductCategoryTagSchema>)
}

/**
 * Gets the creation timestamp from a product event
 * @param event The product event
 * @returns The creation timestamp (number)
 */
export const getProductCreatedAt = (event: NDKEvent): number => event.created_at || 0

/**
 * Gets the pubkey from a product event
 * @param event The product event
 * @returns The pubkey (string)
 */
export const getProductPubkey = (event: NDKEvent): string => event.pubkey

/**
 * Gets the event that created a product based on its ID
 * @param id The product event ID
 * @returns A promise that resolves to the NDKEvent or null if not found
 */
export const getProductEvent = async (id: string) => {
	try {
		return await fetchProduct(id)
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
