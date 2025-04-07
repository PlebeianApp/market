import { ndkActions } from '@/lib/stores/ndk'
import { productKeys } from './queryKeyFactory'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import {
	ProductListingSchema,
	ProductTitleTagSchema,
	ProductPriceTagSchema,
	ProductImageTagSchema,
	ProductSpecTagSchema,
	ProductTypeTagSchema,
	ProductVisibilityTagSchema,
	ProductStockTagSchema,
	ProductWeightTagSchema,
	ProductDimensionsTagSchema,
	ProductCategoryTagSchema,
} from '@/lib/schemas/productListing'
import { z } from 'zod'

// Helper functions to extract data from product events

// Basic product information
export const getProductTitle = (event: NDKEvent): z.infer<typeof ProductTitleTagSchema>[1] =>
	event.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Product'

export const getProductDescription = (event: NDKEvent): string => event.content || ''

// Product attributes
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
 * @returns An array of category strings (the second element of each 't' tag)
 */
export const getProductCategories = (event: NDKEvent): z.infer<typeof ProductCategoryTagSchema>[] => {
	return event.tags.filter((t) => t[0] === 't').map((t) => t as z.infer<typeof ProductCategoryTagSchema>)
}

// Metadata
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

// Validate event with schema and log errors
export const validateProductEvent = (event: NDKEvent): boolean => {
	try {
		ProductListingSchema.parse(event)
		return true
	} catch (e) {
		console.error('Error parsing product event:', e)
		return false
	}
}

// Data fetching functions
/**
 * Fetches all product listings
 * @returns Array of product events sorted by creation date (newest first)
 */
export const fetchProducts = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402], // Product listings in Nostr
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)

	// Validate each event and log errors, but still include all events
	const validatedEvents = Array.from(events).map((event) => {
		validateProductEvent(event)
		return event
	})

	return validatedEvents
}

export const fetchProduct = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Product not found')
	}

	// Validate but don't transform
	validateProductEvent(event)
	return event
}

// React Query options
export const productQueryOptions = (id: string) =>
	queryOptions({
		queryKey: productKeys.details(id),
		queryFn: () => fetchProduct(id),
	})

export const productsQueryOptions = queryOptions({
	queryKey: productKeys.all,
	queryFn: fetchProducts,
})

// React Query hooks with selectors
/**
 * Hook to get the product title
 * @param id Product ID
 * @returns Query result with the product title (string)
 */
export const useProductTitle = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductTitle,
	})
}

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

export const useProductType = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductType,
	})
}

export const useProductVisibility = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductVisibility,
	})
}

export const useProductStock = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductStock,
	})
}

export const useProductWeight = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductWeight,
	})
}

export const useProductDimensions = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductDimensions,
	})
}

export const useProductCategories = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductCategories,
	})
}

export const useProductCreatedAt = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductCreatedAt,
	})
}

export const useProductPubkey = (id: string) => {
	return useQuery({
		...productQueryOptions(id),
		select: getProductPubkey,
	})
}
