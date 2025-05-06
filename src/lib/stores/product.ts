import { Store } from '@tanstack/store'
import type { RichShippingInfo } from './cart'
import { ProductImageTagSchema, ProductCategoryTagSchema } from '@/lib/schemas/productListing'
import type { z } from 'zod'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { SHIPPING_KIND } from '../schemas/shippingOption'

export type Category = z.infer<typeof ProductCategoryTagSchema>
export type ProductImage = z.infer<typeof ProductImageTagSchema>

export type ProductShipping = {
	shippingId: string
	cost: string
}

export type ProductShippingForm = {
	shipping: Pick<RichShippingInfo, 'id' | 'name'> | null
	extraCost: string
}

export type ProductSpec = {
	key: string
	value: string
}

export type ProductWeight = {
	value: string
	unit: string
}

export type ProductDimensions = {
	value: string // format: LxWxH (e.g. "10x20x30")
	unit: string
}

export interface ProductFormState {
	mainTab: 'product' | 'shipping'
	productSubTab: 'name' | 'detail' | 'spec' | 'category' | 'images'
	name: string
	description: string
	price: string
	quantity: string
	currency: string
	status: 'hidden' | 'on-sale' | 'pre-order'
	productType: 'single' | 'variable'
	mainCategory: string | null
	specs: ProductSpec[]
	categories: Array<{ key: string; name: string; checked: boolean }>
	images: Array<{ imageUrl: string; imageOrder: number }>
	shippings: ProductShippingForm[]
	weight: ProductWeight | null
	dimensions: ProductDimensions | null
}

export const DEFAULT_FORM_STATE: ProductFormState = {
	mainTab: 'product',
	productSubTab: 'name',
	name: '',
	description: '',
	price: '',
	quantity: '',
	currency: 'SATS',
	status: 'hidden',
	productType: 'single',
	mainCategory: null,
	specs: [],
	categories: [],
	images: [],
	shippings: [],
	weight: null,
	dimensions: null,
}

// Create the store
export const productFormStore = new Store<ProductFormState>(DEFAULT_FORM_STATE)

// Create actions object
export const productFormActions = {
	nextTab: () => {
		productFormStore.setState((state) => {
			const subTabs = ['name', 'detail', 'spec', 'category', 'images']
			const currentIndex = subTabs.indexOf(state.productSubTab)

			if (currentIndex < subTabs.length - 1) {
				return {
					...state,
					productSubTab: subTabs[currentIndex + 1] as typeof state.productSubTab,
				}
			} else {
				return {
					...state,
					mainTab: 'shipping',
				}
			}
		})
	},

	previousTab: () => {
		productFormStore.setState((state) => {
			if (state.mainTab === 'shipping') {
				return {
					...state,
					mainTab: 'product',
					productSubTab: 'images',
				}
			}

			const subTabs = ['name', 'detail', 'spec', 'category', 'images']
			const currentIndex = subTabs.indexOf(state.productSubTab)

			if (currentIndex > 0) {
				return {
					...state,
					productSubTab: subTabs[currentIndex - 1] as typeof state.productSubTab,
				}
			}

			return state
		})
	},

	reset: () => {
		productFormStore.setState(() => DEFAULT_FORM_STATE)
	},

	updateValues: (values: Partial<ProductFormState>) => {
		productFormStore.setState((state) => ({
			...state,
			...values,
		}))
	},

	updateCategories: (categories: Array<{ key: string; name: string; checked: boolean }>) => {
		productFormStore.setState((state) => ({
			...state,
			categories,
		}))
	},

	updateImages: (images: Array<{ imageUrl: string; imageOrder: number }>) => {
		productFormStore.setState((state) => ({
			...state,
			images,
		}))
	},

	publishProduct: async (signer: NDKSigner, ndk: NDK): Promise<boolean | string> => {
		const state = productFormStore.state

		// Validate required fields
		if (!state.name.trim()) {
			console.error('Product name is required')
			return false
		}

		if (!state.description.trim()) {
			console.error('Product description is required')
			return false
		}

		if (!state.price.trim() || isNaN(Number(state.price))) {
			console.error('Valid product price is required')
			return false
		}

		if (!state.quantity.trim() || isNaN(Number(state.quantity))) {
			console.error('Valid product quantity is required')
			return false
		}

		if (state.images.length === 0) {
			console.error('At least one product image is required')
			return false
		}

		if (!state.mainCategory) {
			console.error('Main category is required')
			return false
		}

		// Generate unique product ID
		const productId = `product_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

		// Transform images to the correct format
		const imagesTags = state.images.map((img) => ['image', img.imageUrl, '800x600', img.imageOrder.toString()] as NDKTag)

		// Transform categories to the correct format
		// Main category goes first, then sub-categories
		const categoryTags = []

		// Add main category
		categoryTags.push(['t', state.mainCategory] as NDKTag)

		// Add sub categories
		state.categories
			.filter((cat) => cat.checked && cat.name.trim() !== '')
			.forEach((cat) => {
				categoryTags.push(['t', cat.name] as NDKTag)
			})

		// Transform specs to the correct format
		const specTags = state.specs.map((spec) => ['spec', spec.key, spec.value] as NDKTag)

		// Transform shipping options to the correct format
		const shippingTags = state.shippings
			.filter((ship) => ship.shipping && ship.shipping.id)
			.map((ship) => {
				// Format: ['shipping_option', '30406:pubkey:identifier', 'extra_cost']
				const shippingRef = `${SHIPPING_KIND}:${ship.shipping!.id}`
				return ship.extraCost ? (['shipping_option', shippingRef, ship.extraCost] as NDKTag) : (['shipping_option', shippingRef] as NDKTag)
			})

		// Add weight tag if present
		const weightTag = state.weight ? [['weight', state.weight.value, state.weight.unit] as NDKTag] : []

		// Add dimensions tag if present
		const dimensionsTag = state.dimensions ? [['dim', state.dimensions.value, state.dimensions.unit] as NDKTag] : []

		// Create the product data in the format expected by Nostr
		const productData = {
			kind: 30402,
			created_at: Math.floor(Date.now() / 1000),
			content: state.description,
			tags: [
				['d', productId],
				['title', state.name],
				['price', state.price, state.currency],
				['type', state.productType === 'single' ? 'simple' : 'variable', 'physical'],
				['visibility', state.status],
				['stock', state.quantity],
				['summary', state.description],
				...imagesTags,
				...categoryTags,
				...specTags,
				...shippingTags,
				...weightTag,
				...dimensionsTag,
			] as NDKTag[],
		}

		// Create and publish the event
		const event = new NDKEvent(ndk)
		event.kind = productData.kind
		event.content = productData.content
		event.tags = productData.tags
		event.created_at = productData.created_at

		try {
			await event.sign(signer)
			await event.publish()
			console.log(`Published product: ${state.name}`)
			return event.id // Return the event ID on success
		} catch (error) {
			console.error(`Failed to publish product`, error)
			return false
		}
	},
}

// Create a hook to use the store
export const useProductForm = () => {
	const state = productFormStore.state
	return {
		...state,
		...productFormActions,
	}
}
