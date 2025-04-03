import { ndkActions } from '@/lib/stores/ndk'
import { productKeys } from './queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { ProductListingSchema } from '@/lib/schemas/productListing'

// Define a simpler Product type for our UI
export type NostrProduct = {
	pubkey: string
	id: string
	title: string
	description: string
	price?: {
		amount: string
		currency: string
		frequency?: string
	}
	images?: Array<{
		url: string
		dimensions?: string
		order?: number
	}>
	specs?: Array<{
		key: string
		value: string
	}>
	type?: {
		productType: 'simple' | 'variable' | 'variation'
		physicalType: 'digital' | 'physical'
	}
	visibility?: 'hidden' | 'on-sale' | 'pre-order'
	stock?: number
	weight?: {
		value: string
		unit: string
	}
	dimensions?: {
		dimensions: string
		unit: string
	}
	categories?: string[]
	createdAt: number
}

const transformEvent = (event: NDKEvent): NostrProduct => {
	try {
		// Try to validate with schema
		try {
			ProductListingSchema.parse(event)
		} catch (e) {
			// We'll just log failed products but still show them
			console.error('Error parsing product event:', e)
		}

		// Get the main product details
		const title = event.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Product'
		const description = event.content || ''

		// Handle price
		const priceTag = event.tags.find((t) => t[0] === 'price')
		const price = priceTag
			? {
					amount: priceTag[1],
					currency: priceTag[2],
					frequency: priceTag[3],
				}
			: undefined

		// Handle images
		const images = event.tags
			.filter((t) => t[0] === 'image')
			.map((t) => ({
				url: t[1],
				dimensions: t[2],
				order: t[3] ? parseInt(t[3]) : undefined,
			}))
			.sort((a, b) => {
				// Sort by order if available
				if (a.order !== undefined && b.order !== undefined) {
					return a.order - b.order
				}
				return 0
			})

		// Parse specs
		const specs = event.tags
			.filter((t) => t[0] === 'spec')
			.map((t) => ({
				key: t[1],
				value: t[2],
			}))

		// Parse type
		const typeTag = event.tags.find((t) => t[0] === 'type')
		const type = typeTag
			? {
					productType: typeTag[1] as 'simple' | 'variable' | 'variation',
					physicalType: typeTag[2] as 'digital' | 'physical',
				}
			: undefined

		// Parse visibility
		const visibilityTag = event.tags.find((t) => t[0] === 'visibility')
		const visibility = visibilityTag ? (visibilityTag[1] as 'hidden' | 'on-sale' | 'pre-order') : undefined

		// Parse stock
		const stockTag = event.tags.find((t) => t[0] === 'stock')
		const stock = stockTag ? parseInt(stockTag[1]) : undefined

		// Parse weight
		const weightTag = event.tags.find((t) => t[0] === 'weight')
		const weight = weightTag
			? {
					value: weightTag[1],
					unit: weightTag[2],
				}
			: undefined

		// Parse dimensions
		const dimensionsTag = event.tags.find((t) => t[0] === 'dim')
		const dimensions = dimensionsTag
			? {
					dimensions: dimensionsTag[1],
					unit: dimensionsTag[2],
				}
			: undefined

		// Parse categories
		const categories = event.tags.filter((t) => t[0] === 't').map((t) => t[1])

		return {
			pubkey: event.pubkey,
			id: event.id,
			title,
			description,
			price,
			images,
			specs,
			type,
			visibility,
			stock,
			weight,
			dimensions,
			categories,
			createdAt: event.created_at || 0,
		}
	} catch (e) {
		console.error('Error transforming product event:', e)
		// Return a minimal valid product
		return {
			pubkey: event.pubkey,
			id: event.id,
			title: 'Error parsing product',
			description: 'There was an error parsing this product',
			createdAt: event.created_at || 0,
		}
	}
}

export const fetchProducts = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402], // Product listings in Nostr
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	const products = Array.from(events).map(transformEvent)

	// Sort by newest first
	return products.sort((a, b) => b.createdAt - a.createdAt)
}

export const fetchProduct = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Product not found')
	}
	return transformEvent(event)
}

export const productQueryOptions = (id: string) =>
	queryOptions({
		queryKey: productKeys.details(id),
		queryFn: () => fetchProduct(id),
	})

export const productsQueryOptions = queryOptions({
	queryKey: productKeys.all,
	queryFn: fetchProducts,
})
