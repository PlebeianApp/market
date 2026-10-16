import { ndkActions } from '@/lib/stores/ndk'
import {
	buildSellerProductEventData,
	deleteProductListingWorkflow,
	normalizeProductShippingSelections,
	publishProductListingWorkflow,
	type SellerProductListingInput,
	type SellerProductPublishValidationIssue,
} from '@sdk/commerce/products'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'
import { getNdkEventStore } from '@platform/web/ndkReadContext'
import { productKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClientTag } from './nip89'

export type ProductFormData = SellerProductListingInput

export function productPublishIssueMessage(issue: SellerProductPublishValidationIssue): string {
	switch (issue) {
		case 'product-name-required':
			return 'Product name is required'
		case 'product-description-required':
			return 'Product description is required'
		case 'product-price-invalid':
			return 'Valid product price is required'
		case 'product-quantity-invalid':
			return 'Valid product quantity is required'
		case 'product-image-required':
			return 'At least one product image is required'
		case 'product-main-category-required':
			return 'Main category is required'
		case 'product-shipping-required':
			return 'At least one shipping option is required'
	}
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
	// Generate a unique ID if not provided (for new products)
	const id = productId || `product_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
	const eventData = buildSellerProductEventData(formData, id, {
		clientTag: appPubkey && handlerId ? createClientTag(appPubkey, handlerId) : undefined,
	})
	event.kind = eventData.kind
	event.content = eventData.content
	event.tags = eventData.tags as NDKTag[]

	return event
}

/**
 * Publishes a new product
 */
export const publishProduct = async (formData: ProductFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	return publishProductForm(formData, signer, ndk)
}

const createProductId = () => `product_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

async function publishProductForm(formData: ProductFormData, signer: NDKSigner, ndk: NDK, productDTag?: string): Promise<string> {
	const context = await createNdkPublishContext(ndk, signer)
	const outcome = await publishProductListingWorkflow({ ...context, createProductId }, formData, productDTag)
	if (!outcome.ok) throw new Error(productPublishIssueMessage(outcome.issue))
	return outcome.event.id
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
	if (!productDTag) {
		throw new Error('Product d tag is required for updates')
	}
	return publishProductForm(formData, signer, ndk, productDTag)
}

/**
 * Deletes a product by publishing a deletion event
 */
export const deleteProduct = async (productDTag: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	try {
		const deletion = await deleteProductListingWorkflow(await createNdkPublishContext(ndk, signer), productDTag)
		// Relays may keep serving the listing; the store applies the deletion to every later read.
		getNdkEventStore().add(deletion)
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
