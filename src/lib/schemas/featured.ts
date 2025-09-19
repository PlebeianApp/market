import { z } from 'zod'

/**
 * Schema for featured item entries with ordering support
 */
export const FeaturedItemSchema = z.object({
	itemId: z.string(), // The identifier (pubkey for users, d-tag for collections/products)
	itemType: z.enum(['user', 'collection', 'product']),
	coordinates: z.string().optional(), // Full coordinates for collections/products (e.g., "30405:pubkey:d-tag")
	order: z.number().int().min(0), // Order position (0-based)
	addedBy: z.string().length(64, 'Invalid addedBy pubkey length'),
	addedAt: z.number(),
})

export type FeaturedItem = z.infer<typeof FeaturedItemSchema>

/**
 * Schema for complete featured items data
 */
export const FeaturedItemsDataSchema = z.object({
	items: z.array(FeaturedItemSchema),
	lastUpdated: z.number(),
})

export type FeaturedItemsData = z.infer<typeof FeaturedItemsDataSchema>

/**
 * Schema for featured products settings (kind 30405)
 * Uses collection format with d: "featured_products"
 */
export const FeaturedProductsSchema = z.object({
	featuredProducts: z.array(z.string()), // Array of product coordinates "30402:pubkey:d-tag"
	lastUpdated: z.number().optional(),
})

export type FeaturedProducts = z.infer<typeof FeaturedProductsSchema>

/**
 * Schema for featured collections settings (kind 30003)
 * Uses NIP-51 list format with d: "featured_collections"
 */
export const FeaturedCollectionsSchema = z.object({
	featuredCollections: z.array(z.string()), // Array of collection coordinates "30405:pubkey:d-tag"
	lastUpdated: z.number().optional(),
})

export type FeaturedCollections = z.infer<typeof FeaturedCollectionsSchema>

/**
 * Schema for featured users settings (kind 30000)
 * Uses NIP-51 list format with d: "featured_users"
 */
export const FeaturedUsersSchema = z.object({
	featuredUsers: z.array(z.string()), // Array of user pubkeys in hex format
	lastUpdated: z.number().optional(),
})

export type FeaturedUsers = z.infer<typeof FeaturedUsersSchema>

/**
 * Combined schema for all featured items management
 */
export const AllFeaturedItemsSchema = z.object({
	products: FeaturedProductsSchema.optional(),
	collections: FeaturedCollectionsSchema.optional(),
	users: FeaturedUsersSchema.optional(),
})

export type AllFeaturedItems = z.infer<typeof AllFeaturedItemsSchema>

/**
 * Constants for featured items event kinds and d-tags
 */
export const FEATURED_ITEMS_CONFIG = {
	PRODUCTS: {
		kind: 30405, // Collection kind
		dTag: 'featured_products',
	},
	COLLECTIONS: {
		kind: 30003, // NIP-51 list kind
		dTag: 'featured_collections',
	},
	USERS: {
		kind: 30000, // NIP-51 list kind
		dTag: 'featured_users',
	},
} as const

/**
 * Helper function to validate coordinates format
 */
export const validateCoordinates = (coordinates: string, expectedKind: number): boolean => {
	const parts = coordinates.split(':')
	if (parts.length !== 3) return false

	const [kind, pubkey, dTag] = parts
	if (parseInt(kind) !== expectedKind) return false
	if (!/^[0-9a-f]{64}$/i.test(pubkey)) return false
	if (!dTag || dTag.length === 0) return false

	return true
}

/**
 * Helper function to validate pubkey format
 */
export const validatePubkey = (pubkey: string): boolean => {
	return /^[0-9a-f]{64}$/i.test(pubkey)
}
