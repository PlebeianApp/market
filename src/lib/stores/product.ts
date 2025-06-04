import { Store } from '@tanstack/store'
import type { RichShippingInfo } from './cart'
import { ProductImageTagSchema, ProductCategoryTagSchema } from '@/lib/schemas/productListing'
import type { z } from 'zod'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { SHIPPING_KIND } from '../schemas/shippingOption'
import {
	getProductCategories,
	getProductDescription,
	getProductDimensions,
	getProductImages,
	getProductPrice,
	getProductSpecs,
	getProductStock,
	getProductTitle,
	getProductType,
	getProductVisibility,
	getProductWeight,
	fetchProduct,
} from '@/queries/products'

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
	editingProductId: string | null
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
	selectedCollection: string | null
	specs: ProductSpec[]
	categories: Array<{ key: string; name: string; checked: boolean }>
	images: Array<{ imageUrl: string; imageOrder: number }>
	shippings: ProductShippingForm[]
	weight: ProductWeight | null
	dimensions: ProductDimensions | null
}

export const DEFAULT_FORM_STATE: ProductFormState = {
	editingProductId: null,
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
	selectedCollection: null,
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
	setEditingProductId: (productId: string | null) => {
		productFormStore.setState((state) => ({
			...state,
			editingProductId: productId,
		}))
	},

	loadProductForEdit: async (productId: string) => {
		try {
			const event = await fetchProduct(productId)
			if (!event) {
				console.error('Product not found for editing:', productId)
				productFormActions.reset()
				return
			}

			const title = getProductTitle(event)
			const description = getProductDescription(event)
			const priceTag = getProductPrice(event)
			const images = getProductImages(event)
			const categories = getProductCategories(event)
			const specs = getProductSpecs(event)
			const stockTag = getProductStock(event)
			const typeTag = getProductType(event)
			const visibilityTag = getProductVisibility(event)
			const weightTag = getProductWeight(event)
			const dimensionsTag = getProductDimensions(event)

			const mainCategoryFromTags = categories.find((tag) => tag.length === 2 && tag[0] === 't')?.[1]
			const subCategoriesFromTags = categories
				.filter((tag) => tag.length > 2 && tag[0] === 't')
				.map((tag, index) => ({
					key: `category-${Date.now()}-${index}`,
					name: tag[1],
					checked: true,
				}))

			productFormStore.setState((state) => ({
				...DEFAULT_FORM_STATE,
				editingProductId: productId,
				name: title,
				description: description,
				price: priceTag?.[1] || '',
				currency: priceTag?.[2] || 'SATS',
				quantity: stockTag?.[1] || '',
				status: visibilityTag?.[1] || 'hidden',
				productType: typeTag?.[1] === 'simple' ? 'single' : 'variable',
				mainCategory: mainCategoryFromTags || null,
				categories: subCategoriesFromTags || [],
				images: images.map((img, index) => ({
					imageUrl: img[1],
					imageOrder: parseInt(img[3] || index.toString(), 10),
				})),
				specs: specs.map((spec) => ({ key: spec[1], value: spec[2] })),
				weight: weightTag ? { value: weightTag[1], unit: weightTag[2] } : null,
				dimensions: dimensionsTag ? { value: dimensionsTag[1], unit: dimensionsTag[2] } : null,
				shippings: [],
				mainTab: 'product',
				productSubTab: 'name',
			}))
		} catch (error) {
			console.error('Error loading product for edit:', error)
			productFormActions.reset()
		}
	},

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

		const productId = state.editingProductId || `product_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

		const imagesTags = state.images.map((img) => ['image', img.imageUrl, '800x600', img.imageOrder.toString()] as NDKTag)

		const categoryTags = []

		categoryTags.push(['t', state.mainCategory] as NDKTag)

		state.categories
			.filter((cat) => cat.checked && cat.name.trim() !== '')
			.forEach((cat) => {
				categoryTags.push(['t', cat.name] as NDKTag)
			})

		const specTags = state.specs.map((spec) => ['spec', spec.key, spec.value] as NDKTag)

		const shippingTags = state.shippings
			.filter((ship) => ship.shipping && ship.shipping.id)
			.map((ship) => {
				const shippingRef = `${SHIPPING_KIND}:${ship.shipping!.id}`
				return ship.extraCost ? (['shipping_option', shippingRef, ship.extraCost] as NDKTag) : (['shipping_option', shippingRef] as NDKTag)
			})

		const weightTag = state.weight ? [['weight', state.weight.value, state.weight.unit] as NDKTag] : []

		const dimensionsTag = state.dimensions ? [['dim', state.dimensions.value, state.dimensions.unit] as NDKTag] : []

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

		const event = new NDKEvent(ndk)
		event.kind = productData.kind
		event.content = productData.content
		event.tags = productData.tags
		event.created_at = Math.floor(Date.now() / 1000)

		try {
			await event.sign(signer)
			await event.publish()
			console.log(state.editingProductId ? `Updated product: ${state.name}` : `Published product: ${state.name}`)
			return event.id
		} catch (error) {
			console.error(state.editingProductId ? `Failed to update product` : `Failed to publish product`, error)
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
