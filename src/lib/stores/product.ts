import { ProductCategoryTagSchema, ProductImageTagSchema } from '@/lib/schemas/productListing'
import { publishProduct, updateProduct, type ProductFormData } from '@/publish/products'
import {
	fetchProduct,
	getProductCategories,
	getProductCollection,
	getProductDescription,
	getProductDimensions,
	getProductId,
	getProductImages,
	getProductPrice,
	getProductShippingOptions,
	getProductSpecs,
	getProductStock,
	getProductTitle,
	getProductType,
	getProductVisibility,
	getProductWeight,
} from '@/queries/products'
import { productKeys } from '@/queries/queryKeyFactory'
import { clearProductFormDraft, getProductFormDraft, saveProductFormDraft } from '@/lib/utils/productFormStorage'
import type { RichShippingInfo } from './cart'
import { uiStore } from '@/lib/stores/ui'
import NDK, { type NDKSigner } from '@nostr-dev-kit/ndk'
import { QueryClient } from '@tanstack/react-query'
import { Store } from '@tanstack/store'
import type { z } from 'zod'

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

export type ProductFormTab = 'name' | 'detail' | 'spec' | 'category' | 'images' | 'shipping'

// Tab navigation order
const PRODUCT_FORM_TABS: ProductFormTab[] = ['name', 'detail', 'spec', 'category', 'images', 'shipping']

export interface ProductFormState {
	editingProductId: string | null
	isDirty: boolean // Track if form has been modified from saved state
	activeTab: ProductFormTab
	name: string
	description: string
	price: string
	fiatPrice: string
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
	// Currency system state
	bitcoinUnit: 'SATS' | 'BTC'
	currencyMode: 'sats' | 'fiat'
}

export const DEFAULT_FORM_STATE: ProductFormState = {
	editingProductId: null,
	isDirty: false,
	activeTab: 'name',
	name: '',
	description: '',
	price: '',
	fiatPrice: '',
	quantity: '',
	currency: 'SATS',
	status: 'on-sale',
	productType: 'single',
	mainCategory: null,
	selectedCollection: null,
	specs: [],
	categories: [],
	images: [],
	shippings: [],
	weight: null,
	dimensions: null,
	// Currency system defaults
	bitcoinUnit: 'SATS',
	currencyMode: 'sats',
}

// Create the store
export const productFormStore = new Store<ProductFormState>(DEFAULT_FORM_STATE)

// Debounce utility for auto-save
let saveTimeoutId: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 500

const cancelPendingSave = () => {
	if (saveTimeoutId) {
		clearTimeout(saveTimeoutId)
		saveTimeoutId = null
	}
}

const debouncedSave = () => {
	cancelPendingSave()

	saveTimeoutId = setTimeout(() => {
		const state = productFormStore.state
		if (state.editingProductId) {
			saveProductFormDraft(state.editingProductId, state).catch((error) => {
				console.error('Failed to auto-save product form draft:', error)
			})
		}
		saveTimeoutId = null
	}, SAVE_DEBOUNCE_MS)
}

// Create actions object
export const productFormActions = {
	setEditingProductId: (productId: string | null) => {
		productFormStore.setState((state) => ({
			...state,
			editingProductId: productId,
		}))
	},

	loadProductForEdit: async (productId: string, options?: { preserveTabState?: { activeTab: ProductFormTab } }) => {
		// Cancel any pending auto-save to prevent interference during load
		cancelPendingSave()

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
			const collection = getProductCollection(event)
			const specs = getProductSpecs(event)
			const stockTag = getProductStock(event)
			const typeTag = getProductType(event)
			const visibilityTag = getProductVisibility(event)
			const weightTag = getProductWeight(event)
			const dimensionsTag = getProductDimensions(event)
			const shippingTags = getProductShippingOptions(event)

			const mainCategoryFromTags = categories.find((tag) => tag.length === 2 && tag[0] === 't')?.[1]
			const subCategoriesFromTags = categories
				.filter((tag) => tag.length > 2 && tag[0] === 't')
				.map((tag, index) => ({
					key: `category-${Date.now()}-${index}`,
					name: tag[1],
					checked: true,
				}))

			// Parse shipping options
			const shippingOptions: ProductShippingForm[] = shippingTags.map((tag) => {
				// tag format: ['shipping_option', 'shipping_reference', 'extra_cost?']
				const shippingRef = tag[1] // e.g., "30406:pubkey:shippingId"
				const extraCost = tag[2] || ''

				// Extract shipping name from reference (we'll use a simplified version for now)
				// In a real app, you'd want to fetch the actual shipping option details
				const shippingName = `Shipping Option (${shippingRef.split(':')[2] || 'unknown'})`

				return {
					shipping: {
						id: shippingRef,
						name: shippingName,
					},
					extraCost,
				}
			})

			// Use preserved tab state if provided, otherwise default to 'name'
			const activeTab = options?.preserveTabState?.activeTab ?? 'name'

			// Determine if this is a fiat or sats price
			const priceCurrency = priceTag?.[2] || 'SATS'
			const priceValue = priceTag?.[1] || ''
			const isFiatCurrency = priceCurrency !== 'SATS' && priceCurrency !== 'BTC'

			productFormStore.setState((state) => ({
				...DEFAULT_FORM_STATE,
				editingProductId: productDTag, // Use the d tag value, not the event ID!
				name: title,
				description: description,
				price: priceValue,
				fiatPrice: isFiatCurrency ? priceValue : '', // Set fiatPrice if currency is fiat
				currency: priceCurrency,
				currencyMode: isFiatCurrency ? 'fiat' : 'sats',
				bitcoinUnit: priceCurrency === 'BTC' ? 'BTC' : 'SATS',
				quantity: stockTag?.[1] || '',
				status: visibilityTag?.[1] || 'hidden',
				productType: typeTag?.[1] === 'simple' ? 'single' : 'variable',
				mainCategory: mainCategoryFromTags || null,
				selectedCollection: collection,
				categories: subCategoriesFromTags || [],
				images: images.map((img, index) => ({
					imageUrl: img[1],
					imageOrder: parseInt(img[3] || index.toString(), 10),
				})),
				specs: specs.map((spec) => ({ key: spec[1], value: spec[2] })),
				weight: weightTag ? { value: weightTag[1], unit: weightTag[2] } : null,
				dimensions: dimensionsTag ? { value: dimensionsTag[1], unit: dimensionsTag[2] } : null,
				shippings: shippingOptions,
				activeTab,
			}))
		} catch (error) {
			console.error('Error loading product for edit:', error)
			productFormActions.reset()
		}
	},

	nextTab: () => {
		productFormStore.setState((state) => {
			const currentIndex = PRODUCT_FORM_TABS.indexOf(state.activeTab)

			if (currentIndex < PRODUCT_FORM_TABS.length - 1) {
				return {
					...state,
					activeTab: PRODUCT_FORM_TABS[currentIndex + 1],
				}
			}

			return state
		})
	},

	previousTab: () => {
		productFormStore.setState((state) => {
			const currentIndex = PRODUCT_FORM_TABS.indexOf(state.activeTab)

			if (currentIndex > 0) {
				return {
					...state,
					activeTab: PRODUCT_FORM_TABS[currentIndex - 1],
				}
			}

			return state
		})
	},

	reset: () => {
		// Cancel any pending auto-save to prevent stale data from being written
		cancelPendingSave()

		productFormStore.setState(() => {
			const selectedCurrency = uiStore.state.selectedCurrency

			return {
				...DEFAULT_FORM_STATE,
				currency: selectedCurrency === 'BTC' ? 'SATS' : selectedCurrency,
				currencyMode: ['BTC', 'SATS'].includes(selectedCurrency) ? 'sats' : 'fiat',
			}
		})
	},

	updateValues: (values: Partial<ProductFormState>) => {
		productFormStore.setState((state) => ({
			...state,
			...values,
			isDirty: true,
		}))
		debouncedSave()
	},

	// Update tab state without marking as dirty (used for navigation, restore after discard, etc.)
	setTabState: (activeTab: ProductFormTab) => {
		productFormStore.setState((state) => ({
			...state,
			activeTab,
		}))
	},

	updateCategories: (categories: Array<{ key: string; name: string; checked: boolean }>) => {
		productFormStore.setState((state) => ({
			...state,
			categories,
			isDirty: true,
		}))
		debouncedSave()
	},

	updateImages: (images: Array<{ imageUrl: string; imageOrder: number }>) => {
		productFormStore.setState((state) => ({
			...state,
			images,
			isDirty: true,
		}))
		debouncedSave()
	},

	loadDraftForProduct: async (productId: string): Promise<boolean> => {
		try {
			const draft = await getProductFormDraft(productId)
			if (draft) {
				productFormStore.setState((state) => ({
					...state,
					...draft,
					// Restore tab state to defaults since we don't persist them
					activeTab: 'name',
					// Mark as dirty since we're loading unsaved changes
					isDirty: true,
				}))
				return true
			}
			return false
		} catch (error) {
			console.error('Failed to load product form draft:', error)
			return false
		}
	},

	clearDraftForProduct: async (productId: string): Promise<void> => {
		// Cancel any pending auto-save to prevent it from recreating the draft
		cancelPendingSave()

		try {
			await clearProductFormDraft(productId)
		} catch (error) {
			console.error('Failed to clear product form draft:', error)
		}
	},

	continuePublishing: async (signer: NDKSigner, ndk: NDK, queryClient?: QueryClient): Promise<boolean | string> => {
		const state = productFormStore.state

		// Apply currency conversion logic before publishing
		let finalPrice = state.price
		let finalCurrency = state.currency

		// If we have a Bitcoin currency selected, always publish in SATS
		if (state.currency === 'SATS' || state.currency === 'BTC') {
			const bitcoinValue = parseFloat(state.price || '0')
			if (state.bitcoinUnit === 'BTC') {
				// Convert BTC to SATS for publishing
				finalPrice = (bitcoinValue * 100000000).toString()
			} else {
				// Already in SATS
				finalPrice = state.price || '0'
			}
			finalCurrency = 'SATS'
		} else {
			// Fiat currency selected - check currency mode
			if (state.currencyMode === 'fiat') {
				// Use fiat currency and fiat price
				finalPrice = state.fiatPrice || state.price
				finalCurrency = state.currency
			} else {
				// Use sats as currency (calculated on spot)
				const bitcoinValue = parseFloat(state.price || '0')
				const satsValue = state.bitcoinUnit === 'BTC' ? bitcoinValue * 100000000 : bitcoinValue
				finalPrice = satsValue.toString()
				finalCurrency = 'SATS'
			}
		}

		// Convert state to ProductFormData format
		const formData: ProductFormData = {
			name: state.name,
			description: state.description,
			price: finalPrice,
			quantity: state.quantity,
			currency: finalCurrency,
			status: state.status,
			productType: state.productType,
			mainCategory: state.mainCategory || '',
			selectedCollection: state.selectedCollection,
			categories: state.categories,
			images: state.images,
			specs: state.specs,
			shippings: state.shippings,
			weight: state.weight,
			dimensions: state.dimensions,
		}

		try {
			let result: string

			if (state.editingProductId) {
				// Update existing product using the d tag
				result = await updateProduct(state.editingProductId, formData, signer, ndk)
			} else {
				// Create new product
				result = await publishProduct(formData, signer, ndk)
			}

			// Clear the draft after successful publish
			if (state.editingProductId) {
				await clearProductFormDraft(state.editingProductId)
			}

			// Invalidate queries if queryClient is provided
			if (queryClient) {
				// Get current user pubkey for targeted invalidation
				const user = await signer.user()
				const userPubkey = user?.pubkey

				// Invalidate relevant queries
				await queryClient.invalidateQueries({ queryKey: productKeys.all })
				if (userPubkey) {
					await queryClient.invalidateQueries({ queryKey: productKeys.byPubkey(userPubkey) })
				}
				if (result) {
					await queryClient.invalidateQueries({ queryKey: productKeys.details(result) })
				}
			}

			return result
		} catch (error) {
			console.error(state.editingProductId ? 'Failed to update product:' : 'Failed to publish product:', error)
			return false
		}
	},

	publishProduct: async (signer: NDKSigner, ndk: NDK, queryClient?: QueryClient): Promise<boolean | string> => {
		// V4V check is now handled in the UI layer, so we can directly publish
		return productFormActions.continuePublishing(signer, ndk, queryClient)
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
