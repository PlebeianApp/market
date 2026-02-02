import { publishCollection, updateCollection, type CollectionFormData } from '@/publish/collections'
import { getCollectionShippingOptions, getCollectionSummary } from '@/queries/collections'
import type { RichShippingInfo } from '@/lib/stores/cart'
import type NDK from '@nostr-dev-kit/ndk'
import type { NDKSigner, NDKEvent } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/react-store'

export type CollectionShippingForm = {
	shipping: Pick<RichShippingInfo, 'id' | 'name'> | null
	extraCost: string
}

export interface CollectionFormState {
	// Form data
	name: string
	summary: string
	description: string
	headerImageUrl: string
	selectedProducts: string[] // Array of product coordinates
	shippings: CollectionShippingForm[]

	// UI state
	isEditing: boolean
	editingCollectionId: string | null

	// Available products for selection
	availableProducts: Array<{
		id: string
		title: string
		coordinates: string
		imageUrl?: string
	}>
}

export const DEFAULT_COLLECTION_FORM_STATE: CollectionFormState = {
	name: '',
	summary: '',
	description: '',
	headerImageUrl: '',
	selectedProducts: [],
	shippings: [],
	isEditing: false,
	editingCollectionId: null,
	availableProducts: [],
}

export const collectionFormStore = new Store(DEFAULT_COLLECTION_FORM_STATE)

export const collectionFormActions = {
	/**
	 * Update form values
	 */
	updateValues: (updates: Partial<CollectionFormState>) => {
		collectionFormStore.setState((state) => ({
			...state,
			...updates,
		}))
	},

	/**
	 * Reset form to default state
	 */
	reset: () => {
		collectionFormStore.setState(() => ({ ...DEFAULT_COLLECTION_FORM_STATE }))
	},

	/**
	 * Set editing mode with collection data
	 */
	setEditingCollection: (collectionId: string, collectionData: Partial<CollectionFormState>) => {
		collectionFormStore.setState((state) => ({
			...state,
			...collectionData,
			isEditing: true,
			editingCollectionId: collectionId,
		}))
	},

	/**
	 * Load collection for editing from an NDKEvent
	 */
	loadCollectionForEdit: (event: NDKEvent) => {
		const titleTag = event.tags.find((tag) => tag[0] === 'title')
		const summaryTag = getCollectionSummary(event)
		const imageTag = event.tags.find((tag) => tag[0] === 'image')
		const dTag = event.tags.find((tag) => tag[0] === 'd')
		const productTags = event.tags.filter((tag) => tag[0] === 'a')
		const shippingTags = getCollectionShippingOptions(event)

		// Convert shipping tags to collection shipping form
		const shippingOptions: CollectionShippingForm[] = shippingTags.map((tag) => {
			return {
				shipping: {
					id: tag[1], // The shipping reference
					name: `Shipping Option (${tag[1].split(':')[2] || 'unknown'})`, // Extract ID from reference for display
				},
				extraCost: tag[2] || '',
			}
		})

		collectionFormStore.setState(() => ({
			...DEFAULT_COLLECTION_FORM_STATE,
			isEditing: true,
			editingCollectionId: dTag?.[1] || '',
			name: titleTag?.[1] || '',
			summary: summaryTag || '',
			description: event.content || '',
			headerImageUrl: imageTag?.[1] || '',
			selectedProducts: productTags.map((tag) => tag[1]),
			shippings: shippingOptions,
		}))
	},

	/**
	 * Add product to collection
	 */
	addProduct: (productCoordinates: string) => {
		collectionFormStore.setState((state) => ({
			...state,
			selectedProducts: [...state.selectedProducts, productCoordinates],
		}))
	},

	/**
	 * Remove product from collection
	 */
	removeProduct: (productCoordinates: string) => {
		collectionFormStore.setState((state) => ({
			...state,
			selectedProducts: state.selectedProducts.filter((p) => p !== productCoordinates),
		}))
	},

	/**
	 * Set available products for selection
	 */
	setAvailableProducts: (products: CollectionFormState['availableProducts']) => {
		collectionFormStore.setState((state) => ({
			...state,
			availableProducts: products,
		}))
	},

	/**
	 * Publish or update collection
	 */
	publishCollection: async (signer: NDKSigner, ndk: NDK): Promise<string | null> => {
		const state = collectionFormStore.state

		const formData: CollectionFormData = {
			name: state.name,
			summary: state.summary,
			description: state.description,
			headerImageUrl: state.headerImageUrl || undefined,
			products: state.selectedProducts,
			shippings: state.shippings,
		}

		try {
			if (state.isEditing && state.editingCollectionId) {
				// Update existing collection
				const result = await updateCollection(state.editingCollectionId, formData, signer, ndk)
				return result
			} else {
				// Create new collection
				const result = await publishCollection(formData, signer, ndk)
				return result
			}
		} catch (error) {
			console.error('Error publishing collection:', error)
			throw error
		}
	},
}
