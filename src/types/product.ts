import type {
	ProductListingSchema,
	ProductTypeTagSchema,
	ProductVisibilityTagSchema,
	ProductImageTagSchema,
	ProductSpecTagSchema,
	ProductPriceTagSchema,
} from '@/lib/schemas/productListing'
import type { z } from 'zod'

// Inferred types from schemas
export type ProductListing = z.infer<typeof ProductListingSchema>
export type ProductTypeTag = z.infer<typeof ProductTypeTagSchema>
export type ProductVisibilityTag = z.infer<typeof ProductVisibilityTagSchema>
export type ProductImageTag = z.infer<typeof ProductImageTagSchema>
export type ProductSpecTag = z.infer<typeof ProductSpecTagSchema>
export type ProductPriceTag = z.infer<typeof ProductPriceTagSchema>

// Mapped types for our application
export type ProductVisibility = ProductVisibilityTag[1]
export type ProductDeliveryType = ProductTypeTag[2]
export type ProductVariationType = ProductTypeTag[1]

export type ProductImage = {
	url: string
	dimensions?: string
	order?: number
}

export type ProductSpec = {
	key: string
	value: string
}

export type ProductStatus = 'active' | 'sold' | 'inactive'

// Main product type used in the application
export type Product = {
	id: string
	title: string
	description: string
	price: number
	currency: string
	images: ProductImage[]
	specs: ProductSpec[]
	seller: {
		id: string
		name: string
	}
	createdAt: string
	updatedAt: string
	status: ProductStatus
	type?: {
		product: ProductVariationType
		delivery: ProductDeliveryType
	}
	stock?: number
	location?: string
	category?: string
	weight?: {
		value: number
		unit: string
	}
	dimensions?: {
		value: string
		unit: string
	}
}

// Helper type for product query options
export interface ProductQueryOptions {
	limit?: number
	seller?: string
	status?: ProductStatus
	search?: string
	since?: number
	until?: number
	category?: string
	type?: ProductDeliveryType
	minPrice?: number
	maxPrice?: number
}
