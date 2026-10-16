import { ndkActions } from '@/lib/stores/ndk'
import { fetchBlacklistSettings } from '@/queries/blacklist'
import { configKeys } from '@/queries/queryKeyFactory'
import type { NDKSigner } from '@/lib/nostr/ndk-events'
import { addListItem, publishBlacklistWorkflow, removeListItem, type BlacklistData } from '@sdk/commerce/curation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createAppSettingsPublishContext, curationIssueMessage, resolveListOwner, type NdkClient as NDK } from './curationContext'

export type { BlacklistData }

/**
 * Publishes an updated blacklist through WebSocket interface
 */
export const publishBlacklist = async (blacklistData: BlacklistData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	const outcome = await publishBlacklistWorkflow(await createAppSettingsPublishContext(ndk, signer), blacklistData)
	if (!outcome.ok) throw new Error(curationIssueMessage(outcome))
	return outcome.event.id
}

/** Fetches the blacklist from the list owner, applies one membership change, and republishes. */
async function changeBlacklist(
	field: keyof BlacklistData,
	item: string,
	change: 'add' | 'remove',
	messages: { alreadyListed: string; notListed: string },
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> {
	const currentBlacklist = await fetchBlacklistSettings(await resolveListOwner(signer, appPubkey))
	const current: BlacklistData = {
		blacklistedPubkeys: currentBlacklist?.blacklistedPubkeys || [],
		blacklistedProducts: currentBlacklist?.blacklistedProducts || [],
		blacklistedCollections: currentBlacklist?.blacklistedCollections || [],
	}
	const result = change === 'add' ? addListItem(current[field], item) : removeListItem(current[field], item)
	if (!result.ok) throw new Error(result.error === 'already-listed' ? messages.alreadyListed : messages.notListed)

	return publishBlacklist({ ...current, [field]: result.value }, signer, ndk)
}

const USER_MESSAGES = { alreadyListed: 'User is already blacklisted', notListed: 'User is not blacklisted' }
const PRODUCT_MESSAGES = { alreadyListed: 'Product is already blacklisted', notListed: 'Product is not blacklisted' }
const COLLECTION_MESSAGES = { alreadyListed: 'Collection is already blacklisted', notListed: 'Collection is not blacklisted' }

/**
 * Adds a user to the blacklist
 */
export const addToBlacklist = (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeBlacklist('blacklistedPubkeys', userPubkey, 'add', USER_MESSAGES, signer, ndk, appPubkey)

/**
 * Removes a user from the blacklist
 */
export const removeFromBlacklist = (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeBlacklist('blacklistedPubkeys', userPubkey, 'remove', USER_MESSAGES, signer, ndk, appPubkey)

/**
 * Mutation hook for publishing blacklist
 */
export const usePublishBlacklistMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (blacklistData: BlacklistData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishBlacklist(blacklistData, signer, ndk)
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
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(userPubkey) })
			}

			toast.success('Blacklist updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update blacklist:', error)
			toast.error(`Failed to update blacklist: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for adding a user to blacklist
 */
export const useAddToBlacklistMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return addToBlacklist(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}

			toast.success('User added to blacklist successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to add user to blacklist:', error)
			toast.error(`Failed to add user to blacklist: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for removing a user from blacklist
 */
export const useRemoveFromBlacklistMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return removeFromBlacklist(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}

			toast.success('User removed from blacklist successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to remove user from blacklist:', error)
			toast.error(`Failed to remove user from blacklist: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Adds a product to the blacklist
 */
export const addToBlacklistProducts = (productCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeBlacklist('blacklistedProducts', productCoords, 'add', PRODUCT_MESSAGES, signer, ndk, appPubkey)

/**
 * Removes a product from the blacklist
 */
export const removeFromBlacklistProducts = (productCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeBlacklist('blacklistedProducts', productCoords, 'remove', PRODUCT_MESSAGES, signer, ndk, appPubkey)

/**
 * Adds a collection to the blacklist
 */
export const addToBlacklistCollections = (collectionCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeBlacklist('blacklistedCollections', collectionCoords, 'add', COLLECTION_MESSAGES, signer, ndk, appPubkey)

/**
 * Removes a collection from the blacklist
 */
export const removeFromBlacklistCollections = (
	collectionCoords: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> => changeBlacklist('blacklistedCollections', collectionCoords, 'remove', COLLECTION_MESSAGES, signer, ndk, appPubkey)

/**
 * Mutation hook for adding a product to blacklist
 */
export const useAddToBlacklistProductsMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ productCoords, appPubkey }: { productCoords: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return addToBlacklistProducts(productCoords, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}

			toast.success('Product added to blacklist successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to add product to blacklist:', error)
			toast.error(`Failed to add product to blacklist: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for removing a product from blacklist
 */
export const useRemoveFromBlacklistProductsMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ productCoords, appPubkey }: { productCoords: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return removeFromBlacklistProducts(productCoords, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}

			toast.success('Product removed from blacklist successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to remove product from blacklist:', error)
			toast.error(`Failed to remove product from blacklist: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for adding a collection to blacklist
 */
export const useAddToBlacklistCollectionsMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ collectionCoords, appPubkey }: { collectionCoords: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return addToBlacklistCollections(collectionCoords, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}

			toast.success('Collection added to blacklist successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to add collection to blacklist:', error)
			toast.error(`Failed to add collection to blacklist: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for removing a collection from blacklist
 */
export const useRemoveFromBlacklistCollectionsMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ collectionCoords, appPubkey }: { collectionCoords: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return removeFromBlacklistCollections(collectionCoords, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}

			toast.success('Collection removed from blacklist successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to remove collection from blacklist:', error)
			toast.error(`Failed to remove collection from blacklist: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
