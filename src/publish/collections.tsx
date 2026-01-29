import NDK, { NDKEvent, type NDKSigner } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { collectionsKeys } from '@/queries/queryKeyFactory'
import { markCollectionAsDeleted } from '@/queries/collections'
import { toast } from 'sonner'
import { ndkActions } from '@/lib/stores/ndk'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { createClientTag } from './nip89'

export interface CollectionFormData {
	name: string
	description: string
	headerImageUrl?: string
	products: string[] // Array of product coordinates
	shippings: Array<{
		shipping: Pick<RichShippingInfo, 'id' | 'name'> | null
		extraCost: string
	}>
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
	event.kind = 30405 // Collections kind
	event.content = formData.description

	// Generate a unique ID if not provided (for new collections)
	const id = collectionId || crypto.randomUUID()

	// Required tags
	event.tags = [
		['d', id], // Collection identifier
		['title', formData.name],
		['summary', ''], // Collection summary
	]

	// Optional header image
	if (formData.headerImageUrl) {
		event.tags.push(['image', formData.headerImageUrl])
	}

	// Add product references
	formData.products.forEach((productCoords) => {
		event.tags.push(['a', productCoords])
	})

	// Add shipping option references
	const shippingTags = formData.shippings
		.filter((ship) => ship.shipping && ship.shipping.id)
		.map((ship) => {
			// shipping.id is already a full reference like "30406:pubkey:id"
			return ship.extraCost ? ['shipping_option', ship.shipping!.id, ship.extraCost] : ['shipping_option', ship.shipping!.id]
		})

	event.tags.push(...shippingTags)

	// Add client tag if app pubkey and handler ID are provided (NIP-89)
	if (appPubkey && handlerId) {
		event.tags.push(createClientTag(appPubkey, handlerId))
	}

	return event
}

/**
 * Publishes a new collection
 */
export const publishCollection = async (formData: CollectionFormData, signer: NDKSigner, ndk: NDK): Promise<string | null> => {
	try {
		const event = createCollectionEvent(formData, signer, ndk)
		await event.sign(signer)
		await ndkActions.publishEvent(event)

		// Return the collection ID
		const dTag = event.tags.find((tag) => tag[0] === 'd')
		return dTag?.[1] || null
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
		const event = createCollectionEvent(formData, signer, ndk, collectionId)
		await event.sign(signer)
		await ndkActions.publishEvent(event)

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
		// Create a deletion event (kind 5)
		const deleteEvent = new NDKEvent(ndk)
		deleteEvent.kind = 5
		deleteEvent.content = 'Collection deleted'

		// Reference the collection to delete
		const pubkey = await signer.user().then((user) => user.pubkey)
		deleteEvent.tags = [['a', `30405:${pubkey}:${collectionId}`]]

		await deleteEvent.sign(signer)
		await ndkActions.publishEvent(deleteEvent)

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
			// Mark collection as deleted locally so it's filtered from queries
			// even if relays still return it
			markCollectionAsDeleted(collectionId)

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
