import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { ndkActions } from '@/lib/stores/ndk'
import { productKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClientTag } from './nip89'

export interface ProductFormData {
	name: string
	description: string
	price: string
	quantity: string
	currency: string
	status: 'hidden' | 'on-sale' | 'pre-order'
	productType: 'single' | 'variable'
	mainCategory: string
	selectedCollection: string | null
	categories: Array<{ key: string; name: string; checked: boolean }>
	images: Array<{ imageUrl: string; imageOrder: number }>
	specs: Array<{ key: string; value: string }>
	shippings: Array<{
		shipping: Pick<RichShippingInfo, 'id' | 'name'> | null
		extraCost: string
	}>
	weight: { value: string; unit: string } | null
	dimensions: { value: string; unit: string } | null
}

/**
 * Creates a new product event (kind 30402)
 */
export const createProductEvent = (
	formData: ProductFormData,
	signer: NDKSigner,
	ndk: NDK,
	productId?: string, // Optional for updates
	appPubkey?: string, // Optional app pubkey for client tag
	handlerId?: string, // Optional handler ID for client tag
): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = 30402 // Product listings kind
	event.content = formData.description

	// Generate a unique ID if not provided (for new products)
	const id = productId || `product_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

	// Build tags
	const imagesTags = formData.images.map((img) => ['image', img.imageUrl, '800x600', img.imageOrder.toString()] as NDKTag)

	const categoryTags: NDKTag[] = []
	categoryTags.push(['t', formData.mainCategory] as NDKTag)

	formData.categories
		.filter((cat) => cat.checked && cat.name.trim() !== '')
		.forEach((cat) => {
			categoryTags.push(['t', cat.name] as NDKTag)
		})

	const specTags = formData.specs.map((spec) => ['spec', spec.key, spec.value] as NDKTag)

	const shippingTags = formData.shippings
		.filter((ship) => ship.shipping && ship.shipping.id)
		.map((ship) => {
			// shipping.id is already a full reference like "30406:pubkey:id"
			return ship.extraCost
				? (['shipping_option', ship.shipping!.id, ship.extraCost] as NDKTag)
				: (['shipping_option', ship.shipping!.id] as NDKTag)
		})

	const weightTag = formData.weight ? [['weight', formData.weight.value, formData.weight.unit] as NDKTag] : []

	const dimensionsTag = formData.dimensions ? [['dim', formData.dimensions.value, formData.dimensions.unit] as NDKTag] : []

	const collectionTag = formData.selectedCollection ? [['collection', formData.selectedCollection] as NDKTag] : []

	// Add client tag if app pubkey and handler ID are provided (NIP-89)
	const clientTag = appPubkey && handlerId ? [createClientTag(appPubkey, handlerId)] : []

	// Required tags
	event.tags = [
		['d', id], // Product identifier - this is the key for updates!
		['title', formData.name],
		['price', formData.price, formData.currency],
		['type', formData.productType === 'single' ? 'simple' : 'variable', 'physical'],
		['visibility', formData.status],
		['stock', formData.quantity],
		['summary', formData.description],
		...imagesTags,
		...categoryTags,
		...specTags,
		...shippingTags,
		...weightTag,
		...dimensionsTag,
		...collectionTag,
		...clientTag,
	]

	return event
}

/**
 * Publishes a new product
 */
export const publishProduct = async (formData: ProductFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validation
	if (!formData.name.trim()) {
		throw new Error('Product name is required')
	}

	if (!formData.description.trim()) {
		throw new Error('Product description is required')
	}

	if (!formData.price.trim() || isNaN(Number(formData.price))) {
		throw new Error('Valid product price is required')
	}

	if (!formData.quantity.trim() || isNaN(Number(formData.quantity))) {
		throw new Error('Valid product quantity is required')
	}

	if (formData.images.length === 0) {
		throw new Error('At least one product image is required')
	}

	if (!formData.mainCategory) {
		throw new Error('Main category is required')
	}

	// Validate shipping options
	const validShippings = formData.shippings.filter((ship) => ship.shipping && ship.shipping.id)
	if (validShippings.length === 0) {
		throw new Error('At least one shipping option is required')
	}

	const event = createProductEvent(formData, signer, ndk)

	await event.sign(signer)
	await event.publish()

	return event.id
}

/**
 * Updates an existing product by preserving the original d tag
 */
export const updateProduct = async (
	productDTag: string, // The 'd' tag value from the original product
	formData: ProductFormData,
	signer: NDKSigner,
	ndk: NDK,
): Promise<string> => {
	// Validation
	if (!productDTag) {
		throw new Error('Product d tag is required for updates')
	}

	if (!formData.name.trim()) {
		throw new Error('Product name is required')
	}

	if (!formData.description.trim()) {
		throw new Error('Product description is required')
	}

	if (!formData.price.trim() || isNaN(Number(formData.price))) {
		throw new Error('Valid product price is required')
	}

	if (!formData.quantity.trim() || isNaN(Number(formData.quantity))) {
		throw new Error('Valid product quantity is required')
	}

	if (formData.images.length === 0) {
		throw new Error('At least one product image is required')
	}

	if (!formData.mainCategory) {
		throw new Error('Main category is required')
	}

	// Validate shipping options
	const validShippings = formData.shippings.filter((ship) => ship.shipping && ship.shipping.id)
	if (validShippings.length === 0) {
		throw new Error('At least one shipping option is required')
	}

	// Create event with the same d tag to update the existing product
	const event = createProductEvent(formData, signer, ndk, productDTag)

	await event.sign(signer)
	await event.publish()

	return event.id
}

/**
 * Deletes a product by publishing a deletion event
 */
export const deleteProduct = async (productDTag: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	try {
		// Create a deletion event (kind 5)
		const deleteEvent = new NDKEvent(ndk)
		deleteEvent.kind = 5
		deleteEvent.content = 'Product deleted'

		// Reference the product to delete
		const pubkey = await signer.user().then((user) => user.pubkey)
		deleteEvent.tags = [['a', `30402:${pubkey}:${productDTag}`]]

		await deleteEvent.sign(signer)
		await deleteEvent.publish()

		return true
	} catch (error) {
		console.error('Error deleting product:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a new product
 */
export const usePublishProductMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: ProductFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishProduct(formData, signer, ndk)
		},

		onSuccess: async (eventId) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: productKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: productKeys.byPubkey(userPubkey) })
			}

			toast.success('Product published successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to publish product:', error)
			toast.error(`Failed to publish product: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for updating an existing product
 */
export const useUpdateProductMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ productDTag, formData }: { productDTag: string; formData: ProductFormData }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return updateProduct(productDTag, formData, signer, ndk)
		},

		onSuccess: async (eventId, { productDTag }) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: productKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: productKeys.byPubkey(userPubkey) })
			}

			// Also invalidate the specific product if we can
			if (eventId) {
				queryClient.invalidateQueries({ queryKey: productKeys.details(eventId) })
			}

			toast.success('Product updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update product:', error)
			toast.error(`Failed to update product: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for deleting a product
 */
export const useDeleteProductMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (productDTag: string) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return deleteProduct(productDTag, signer, ndk)
		},

		onSuccess: async (success, productDTag) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: productKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: productKeys.byPubkey(userPubkey) })
			}

			toast.success('Product deleted successfully')
			return success
		},

		onError: (error) => {
			console.error('Failed to delete product:', error)
			toast.error(`Failed to delete product: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
