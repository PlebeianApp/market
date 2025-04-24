import { Store } from '@tanstack/store'
import type { RichShippingInfo } from './cart'
import { ProductImageTagSchema, ProductCategoryTagSchema } from '@/lib/schemas/productListing'
import type { z } from 'zod'

// TODO: is this right?
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
	categories: Array<{ key: string; name: string; checked: boolean }>
	images: Array<{ imageUrl: string; imageOrder: number }>
	shippings: ProductShippingForm[]
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
	categories: [],
	images: [],
	shippings: [],
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
}

// Create a hook to use the store
export const useProductForm = () => {
	const state = productFormStore.state
	return {
		...state,
		...productFormActions,
	}
}
