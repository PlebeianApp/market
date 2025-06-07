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
	getProductId,
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
import { publishProduct, updateProduct, type ProductFormData } from '@/publish/products'

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

			// Extract the d tag value - this is what we need to preserve for updates!
			const productDTag = getProductId(event)
			if (!productDTag) {
				console.error('Product has no d tag, cannot edit:', productId)
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
				editingProductId: productDTag, // Use the d tag value, not the event ID!
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

		// Convert state to ProductFormData format
		const formData: ProductFormData = {
			name: state.name,
			description: state.description,
			price: state.price,
			quantity: state.quantity,
			currency: state.currency,
			status: state.status,
			productType: state.productType,
			mainCategory: state.mainCategory || '',
			categories: state.categories,
			images: state.images,
			specs: state.specs,
			shippings: state.shippings,
			weight: state.weight,
			dimensions: state.dimensions,
		}

		try {
			if (state.editingProductId) {
				// Update existing product using the d tag
				const result = await updateProduct(state.editingProductId, formData, signer, ndk)
				return result
			} else {
				// Create new product
				const result = await publishProduct(formData, signer, ndk)
				return result
			}
		} catch (error) {
			console.error(state.editingProductId ? 'Failed to update product:' : 'Failed to publish product:', error)
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
