import { submitAppSettings } from '@/lib/appSettings'
import { ndkActions } from '@/lib/stores/ndk'
import { fetchBlacklistSettings } from '@/queries/blacklist'
import { configKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface BlacklistData {
	blacklistedPubkeys: string[] // Array of blacklisted pubkeys in hex format
	blacklistedProducts: string[] // Array of blacklisted product coordinates
	blacklistedCollections: string[] // Array of blacklisted collection coordinates
}

/**
 * Creates a Kind 10000 blacklist event (NIP-51 mute list)
 */
const createBlacklistEvent = (blacklistData: BlacklistData, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = 10000 // NIP-51 mute list
	event.content = ''

	// Build tags - use 'p' tags for muted pubkeys, 'a' tags for products/collections
	const tags: NDKTag[] = []

	// Add blacklisted pubkeys as 'p' tags
	for (const pubkey of blacklistData.blacklistedPubkeys) {
		tags.push(['p', pubkey])
	}

	// Add blacklisted products as 'a' tags
	for (const productCoords of blacklistData.blacklistedProducts) {
		tags.push(['a', productCoords])
	}

	// Add blacklisted collections as 'a' tags
	for (const collectionCoords of blacklistData.blacklistedCollections) {
		tags.push(['a', collectionCoords])
	}

	event.tags = tags
	return event
}

/**
 * Publishes an updated blacklist through WebSocket interface
 */
export const publishBlacklist = async (blacklistData: BlacklistData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validate all pubkeys are valid hex strings
	for (const pubkey of blacklistData.blacklistedPubkeys) {
		if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
			throw new Error(`Invalid pubkey format: ${pubkey}`)
		}
	}

	// Create and sign the event normally
	const event = createBlacklistEvent(blacklistData, signer, ndk)
	await event.sign(signer)

	// Submit through WebSocket interface (will be re-signed with app pubkey)
	await submitAppSettings(event.rawEvent())

	return event.id
}

/**
 * Adds a user to the blacklist
 */
export const addToBlacklist = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey (should be an admin or editor)
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current blacklist using app pubkey (where the events are actually stored)
	const currentBlacklist = await fetchBlacklistSettings(targetAppPubkey)
	const currentBlacklistedPubkeys = currentBlacklist?.blacklistedPubkeys || []

	// Check if user is already blacklisted
	if (currentBlacklistedPubkeys.includes(userPubkey)) {
		throw new Error('User is already blacklisted')
	}

	// Add new user to the blacklist
	const updatedBlacklistedPubkeys = [...currentBlacklistedPubkeys, userPubkey]

	return publishBlacklist(
		{
			blacklistedPubkeys: updatedBlacklistedPubkeys,
			blacklistedProducts: currentBlacklist?.blacklistedProducts || [],
			blacklistedCollections: currentBlacklist?.blacklistedCollections || [],
		},
		signer,
		ndk,
	)
}

/**
 * Removes a user from the blacklist
 */
export const removeFromBlacklist = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current blacklist using app pubkey (where the events are actually stored)
	const currentBlacklist = await fetchBlacklistSettings(targetAppPubkey)
	const currentBlacklistedPubkeys = currentBlacklist?.blacklistedPubkeys || []

	// Check if user is actually blacklisted
	if (!currentBlacklistedPubkeys.includes(userPubkey)) {
		throw new Error('User is not blacklisted')
	}

	// Remove user from the blacklist
	const updatedBlacklistedPubkeys = currentBlacklistedPubkeys.filter((pubkey) => pubkey !== userPubkey)

	return publishBlacklist(
		{
			blacklistedPubkeys: updatedBlacklistedPubkeys,
			blacklistedProducts: currentBlacklist?.blacklistedProducts || [],
			blacklistedCollections: currentBlacklist?.blacklistedCollections || [],
		},
		signer,
		ndk,
	)
}

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
export const addToBlacklistProducts = async (productCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey (should be an admin or editor)
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current blacklist using app pubkey
	const currentBlacklist = await fetchBlacklistSettings(targetAppPubkey)
	const currentBlacklistedProducts = currentBlacklist?.blacklistedProducts || []

	// Check if product is already blacklisted
	if (currentBlacklistedProducts.includes(productCoords)) {
		throw new Error('Product is already blacklisted')
	}

	// Add new product to the blacklist
	const updatedBlacklistedProducts = [...currentBlacklistedProducts, productCoords]

	return publishBlacklist(
		{
			blacklistedPubkeys: currentBlacklist?.blacklistedPubkeys || [],
			blacklistedProducts: updatedBlacklistedProducts,
			blacklistedCollections: currentBlacklist?.blacklistedCollections || [],
		},
		signer,
		ndk,
	)
}

/**
 * Removes a product from the blacklist
 */
export const removeFromBlacklistProducts = async (
	productCoords: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current blacklist using app pubkey
	const currentBlacklist = await fetchBlacklistSettings(targetAppPubkey)
	const currentBlacklistedProducts = currentBlacklist?.blacklistedProducts || []

	// Check if product is actually blacklisted
	if (!currentBlacklistedProducts.includes(productCoords)) {
		throw new Error('Product is not blacklisted')
	}

	// Remove product from the blacklist
	const updatedBlacklistedProducts = currentBlacklistedProducts.filter((coords) => coords !== productCoords)

	return publishBlacklist(
		{
			blacklistedPubkeys: currentBlacklist?.blacklistedPubkeys || [],
			blacklistedProducts: updatedBlacklistedProducts,
			blacklistedCollections: currentBlacklist?.blacklistedCollections || [],
		},
		signer,
		ndk,
	)
}

/**
 * Adds a collection to the blacklist
 */
export const addToBlacklistCollections = async (
	collectionCoords: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> => {
	// Get current user's pubkey (should be an admin or editor)
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current blacklist using app pubkey
	const currentBlacklist = await fetchBlacklistSettings(targetAppPubkey)
	const currentBlacklistedCollections = currentBlacklist?.blacklistedCollections || []

	// Check if collection is already blacklisted
	if (currentBlacklistedCollections.includes(collectionCoords)) {
		throw new Error('Collection is already blacklisted')
	}

	// Add new collection to the blacklist
	const updatedBlacklistedCollections = [...currentBlacklistedCollections, collectionCoords]

	return publishBlacklist(
		{
			blacklistedPubkeys: currentBlacklist?.blacklistedPubkeys || [],
			blacklistedProducts: currentBlacklist?.blacklistedProducts || [],
			blacklistedCollections: updatedBlacklistedCollections,
		},
		signer,
		ndk,
	)
}

/**
 * Removes a collection from the blacklist
 */
export const removeFromBlacklistCollections = async (
	collectionCoords: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current blacklist using app pubkey
	const currentBlacklist = await fetchBlacklistSettings(targetAppPubkey)
	const currentBlacklistedCollections = currentBlacklist?.blacklistedCollections || []

	// Check if collection is actually blacklisted
	if (!currentBlacklistedCollections.includes(collectionCoords)) {
		throw new Error('Collection is not blacklisted')
	}

	// Remove collection from the blacklist
	const updatedBlacklistedCollections = currentBlacklistedCollections.filter((coords) => coords !== collectionCoords)

	return publishBlacklist(
		{
			blacklistedPubkeys: currentBlacklist?.blacklistedPubkeys || [],
			blacklistedProducts: currentBlacklist?.blacklistedProducts || [],
			blacklistedCollections: updatedBlacklistedCollections,
		},
		signer,
		ndk,
	)
}

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
