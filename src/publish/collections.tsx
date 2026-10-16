import NDK, { NDKEvent, type NDKSigner } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { collectionsKeys } from '@/queries/queryKeyFactory'
import { getNdkEventStore } from '@platform/web/ndkReadContext'
import { toast } from 'sonner'
import { ndkActions } from '@/lib/stores/ndk'
import {
	buildCollectionEventData,
	COLLECTION_EVENT_KIND,
	deleteCollectionWorkflow,
	publishCollectionWorkflow,
} from '@sdk/commerce/collections'
import type { CollectionShippingInput } from '@sdk/commerce/collections'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'
import { createClientTag } from './nip89'

export interface CollectionFormData {
	name: string
	summary: string
	description: string
	headerImageUrl?: string
	products: string[] // Array of product coordinates
	shippings: CollectionShippingInput[]
}

/**
 * Creates a new collection event (kind 30405)
 */
export const createCollectionEvent = (
	formData: CollectionFormData,
	signer: NDKSigner,
	ndk: NDK,
	collectionId?: string,
	appPubkey?: string, // Optional app pubkey for client tag
	handlerId?: string, // Optional handler ID for client tag
): NDKEvent => {
	const event = new NDKEvent(ndk)
	const eventData = buildCollectionEventData({
		collectionId: collectionId || crypto.randomUUID(),
		name: formData.name,
		summary: formData.summary,
		description: formData.description,
		headerImageUrl: formData.headerImageUrl,
		products: formData.products,
		shippings: formData.shippings,
		clientTag: appPubkey && handlerId ? createClientTag(appPubkey, handlerId) : undefined,
	})
	event.kind = eventData.kind as typeof COLLECTION_EVENT_KIND
	event.content = eventData.content
	event.tags = eventData.tags

	return event
}

const toCollectionInput = (formData: CollectionFormData) => ({
	name: formData.name,
	summary: formData.summary,
	description: formData.description,
	headerImageUrl: formData.headerImageUrl,
	products: formData.products,
	shippings: formData.shippings,
})

const createCollectionId = () => crypto.randomUUID()

/**
 * Publishes a new collection
 */
export const publishCollection = async (formData: CollectionFormData, signer: NDKSigner, ndk: NDK): Promise<string | null> => {
	try {
		const context = await createNdkPublishContext(ndk, signer)
		const outcome = await publishCollectionWorkflow({ ...context, createCollectionId }, toCollectionInput(formData))
		return outcome.collectionId
	} catch (error) {
		console.error('Error publishing collection:', error)
		throw error
	}
}

/**
 * Updates an existing collection
 */
export const updateCollection = async (
	collectionId: string,
	formData: CollectionFormData,
	signer: NDKSigner,
	ndk: NDK,
): Promise<string | null> => {
	try {
		const context = await createNdkPublishContext(ndk, signer)
		await publishCollectionWorkflow({ ...context, createCollectionId }, toCollectionInput(formData), collectionId)
		return collectionId
	} catch (error) {
		console.error('Error updating collection:', error)
		throw error
	}
}

/**
 * Deletes a collection by publishing a deletion event
 */
export const deleteCollection = async (collectionId: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	try {
		const deletion = await deleteCollectionWorkflow(await createNdkPublishContext(ndk, signer), collectionId)
		// Relays may keep serving the collection; the store applies the deletion to every later read.
		getNdkEventStore().add(deletion)
		return true
	} catch (error) {
		console.error('Error deleting collection:', error)
		throw error
	}
}

/**
 * Mutation hook for publishing a new collection
 */
export const usePublishCollectionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: CollectionFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishCollection(formData, signer, ndk)
		},

		onSuccess: async (collectionId) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: collectionsKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: collectionsKeys.byPubkey(userPubkey) })
			}

			toast.success('Collection published successfully')
			return collectionId
		},

		onError: (error) => {
			console.error('Failed to publish collection:', error)
			toast.error(`Failed to publish collection: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for updating an existing collection
 */
export const useUpdateCollectionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ collectionId, formData }: { collectionId: string; formData: CollectionFormData }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return updateCollection(collectionId, formData, signer, ndk)
		},

		onSuccess: async (collectionId) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			await queryClient.invalidateQueries({ queryKey: collectionsKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: collectionsKeys.byPubkey(userPubkey) })
				// Force a refetch after a short delay to ensure the new data is loaded
				setTimeout(() => {
					queryClient.refetchQueries({ queryKey: collectionsKeys.byPubkey(userPubkey) })
				}, 1000)
			}

			toast.success('Collection updated successfully')
			return collectionId
		},

		onError: (error) => {
			console.error('Failed to update collection:', error)
			toast.error(`Failed to update collection: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for deleting a collection
 */
export const useDeleteCollectionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (collectionId: string) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return deleteCollection(collectionId, signer, ndk)
		},

		onSuccess: async (success, collectionId) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: collectionsKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: collectionsKeys.byPubkey(userPubkey) })
			}

			toast.success('Collection deleted successfully')
			return success
		},

		onError: (error) => {
			console.error('Failed to delete collection:', error)
			toast.error(`Failed to delete collection: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
