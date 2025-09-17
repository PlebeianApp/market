import { submitAppSettings } from '@/lib/appSettings'
import { ndkActions } from '@/lib/stores/ndk'
import { configKeys } from '@/queries/queryKeyFactory'
import { FEATURED_ITEMS_CONFIG, validateCoordinates, validatePubkey } from '@/lib/schemas/featured'
import NDK, { NDKEvent, NDKKind, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface FeaturedProductsData {
	featuredProducts: string[] // Array of product coordinates in order
}

export interface FeaturedCollectionsData {
	featuredCollections: string[] // Array of collection coordinates in order
}

export interface FeaturedUsersData {
	featuredUsers: string[] // Array of user pubkeys in order
}

/**
 * Creates a Kind 30405 featured products event (Collection format)
 */
const createFeaturedProductsEvent = (data: FeaturedProductsData, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = FEATURED_ITEMS_CONFIG.PRODUCTS.kind
	event.content = 'Featured products collection'

	// Build tags
	const tags: NDKTag[] = [
		['d', FEATURED_ITEMS_CONFIG.PRODUCTS.dTag],
		['title', 'Featured Products'],
	]

	// Add product references as 'a' tags in order
	for (const productCoords of data.featuredProducts) {
		tags.push(['a', productCoords])
	}

	event.tags = tags
	return event
}

/**
 * Creates a Kind 30003 featured collections event (NIP-51 list)
 */
const createFeaturedCollectionsEvent = (data: FeaturedCollectionsData, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = FEATURED_ITEMS_CONFIG.COLLECTIONS.kind
	event.content = ''

	// Build tags
	const tags: NDKTag[] = [['d', FEATURED_ITEMS_CONFIG.COLLECTIONS.dTag]]

	// Add collection references as 'a' tags in order
	for (const collectionCoords of data.featuredCollections) {
		tags.push(['a', collectionCoords])
	}

	event.tags = tags
	return event
}

/**
 * Creates a Kind 30000 featured users event (NIP-51 list)
 */
const createFeaturedUsersEvent = (data: FeaturedUsersData, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = FEATURED_ITEMS_CONFIG.USERS.kind
	event.content = ''

	// Build tags
	const tags: NDKTag[] = [['d', FEATURED_ITEMS_CONFIG.USERS.dTag]]

	// Add user references as 'p' tags in order
	for (const userPubkey of data.featuredUsers) {
		tags.push(['p', userPubkey])
	}

	event.tags = tags
	return event
}

/**
 * Publishes featured products through WebSocket interface
 */
export const publishFeaturedProducts = async (data: FeaturedProductsData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validate all product coordinates
	for (const coords of data.featuredProducts) {
		if (!validateCoordinates(coords, 30402)) {
			throw new Error(`Invalid product coordinates format: ${coords}`)
		}
	}

	// Create and sign the event
	const event = createFeaturedProductsEvent(data, signer, ndk)
	await event.sign(signer)

	// Submit through WebSocket interface
	await submitAppSettings(event.rawEvent())

	return event.id
}

/**
 * Publishes featured collections through WebSocket interface
 */
export const publishFeaturedCollections = async (data: FeaturedCollectionsData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validate all collection coordinates
	for (const coords of data.featuredCollections) {
		if (!validateCoordinates(coords, 30405)) {
			throw new Error(`Invalid collection coordinates format: ${coords}`)
		}
	}

	// Create and sign the event
	const event = createFeaturedCollectionsEvent(data, signer, ndk)
	await event.sign(signer)

	// Submit through WebSocket interface
	await submitAppSettings(event.rawEvent())

	return event.id
}

/**
 * Publishes featured users through WebSocket interface
 */
export const publishFeaturedUsers = async (data: FeaturedUsersData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validate all user pubkeys
	for (const pubkey of data.featuredUsers) {
		if (!validatePubkey(pubkey)) {
			throw new Error(`Invalid pubkey format: ${pubkey}`)
		}
	}

	// Create and sign the event
	const event = createFeaturedUsersEvent(data, signer, ndk)
	await event.sign(signer)

	// Submit through WebSocket interface
	await submitAppSettings(event.rawEvent())

	return event.id
}

/**
 * Adds an item to featured products with ordering
 */
export const addToFeaturedProducts = async (productCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current featured products directly from NDK
	const filter = {
		kinds: [FEATURED_ITEMS_CONFIG.PRODUCTS.kind as NDKKind],
		authors: [targetAppPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.PRODUCTS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const currentEvent = Array.from(events)[0]
	const currentProducts = currentEvent?.tags.filter((tag: string[]) => tag[0] === 'a').map((tag: string[]) => tag[1]) || []

	// Check if product is already featured
	if (currentProducts.includes(productCoords)) {
		throw new Error('Product is already featured')
	}

	// Add new product to the end of the list
	const updatedProducts = [...currentProducts, productCoords]

	return publishFeaturedProducts({ featuredProducts: updatedProducts }, signer, ndk)
}

/**
 * Removes an item from featured products
 */
export const removeFromFeaturedProducts = async (
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

	// Fetch current featured products directly from NDK
	const filter = {
		kinds: [FEATURED_ITEMS_CONFIG.PRODUCTS.kind as NDKKind],
		authors: [targetAppPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.PRODUCTS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const currentEvent = Array.from(events)[0]
	const currentProducts = currentEvent?.tags.filter((tag: string[]) => tag[0] === 'a').map((tag: string[]) => tag[1]) || []

	// Check if product is actually featured
	if (!currentProducts.includes(productCoords)) {
		throw new Error('Product is not featured')
	}

	// Remove product from the list
	const updatedProducts = currentProducts.filter((coords: string) => coords !== productCoords)

	return publishFeaturedProducts({ featuredProducts: updatedProducts }, signer, ndk)
}

/**
 * Reorders featured products
 */
export const reorderFeaturedProducts = async (orderedProducts: string[], signer: NDKSigner, ndk: NDK): Promise<string> => {
	return publishFeaturedProducts({ featuredProducts: orderedProducts }, signer, ndk)
}

/**
 * Similar functions for collections
 */
export const addToFeaturedCollections = async (
	collectionCoords: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> => {
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current featured collections directly from NDK
	const filter = {
		kinds: [FEATURED_ITEMS_CONFIG.COLLECTIONS.kind as NDKKind],
		authors: [targetAppPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.COLLECTIONS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const currentEvent = Array.from(events)[0]
	const currentCollections = currentEvent?.tags.filter((tag: string[]) => tag[0] === 'a').map((tag: string[]) => tag[1]) || []

	if (currentCollections.includes(collectionCoords)) {
		throw new Error('Collection is already featured')
	}

	const updatedCollections = [...currentCollections, collectionCoords]
	return publishFeaturedCollections({ featuredCollections: updatedCollections }, signer, ndk)
}

export const removeFromFeaturedCollections = async (
	collectionCoords: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> => {
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current featured collections directly from NDK
	const filter = {
		kinds: [FEATURED_ITEMS_CONFIG.COLLECTIONS.kind],
		authors: [targetAppPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.COLLECTIONS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const currentEvent = Array.from(events)[0]
	const currentCollections = currentEvent?.tags.filter((tag: string[]) => tag[0] === 'a').map((tag: string[]) => tag[1]) || []

	if (!currentCollections.includes(collectionCoords)) {
		throw new Error('Collection is not featured')
	}

	const updatedCollections = currentCollections.filter((coords: string) => coords !== collectionCoords)
	return publishFeaturedCollections({ featuredCollections: updatedCollections }, signer, ndk)
}

export const reorderFeaturedCollections = async (orderedCollections: string[], signer: NDKSigner, ndk: NDK): Promise<string> => {
	return publishFeaturedCollections({ featuredCollections: orderedCollections }, signer, ndk)
}

/**
 * Similar functions for users
 */
export const addToFeaturedUsers = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current featured users directly from NDK
	const filter = {
		kinds: [FEATURED_ITEMS_CONFIG.USERS.kind as NDKKind],
		authors: [targetAppPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.USERS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const currentEvent = Array.from(events)[0]
	const currentUsers = currentEvent?.tags.filter((tag: string[]) => tag[0] === 'p').map((tag: string[]) => tag[1]) || []

	if (currentUsers.includes(userPubkey)) {
		throw new Error('User is already featured')
	}

	const updatedUsers = [...currentUsers, userPubkey]
	return publishFeaturedUsers({ featuredUsers: updatedUsers }, signer, ndk)
}

export const removeFromFeaturedUsers = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current featured users directly from NDK
	const filter = {
		kinds: [FEATURED_ITEMS_CONFIG.USERS.kind],
		authors: [targetAppPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.USERS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const currentEvent = Array.from(events)[0]
	const currentUsers = currentEvent?.tags.filter((tag: string[]) => tag[0] === 'p').map((tag: string[]) => tag[1]) || []

	if (!currentUsers.includes(userPubkey)) {
		throw new Error('User is not featured')
	}

	const updatedUsers = currentUsers.filter((pubkey: string) => pubkey !== userPubkey)
	return publishFeaturedUsers({ featuredUsers: updatedUsers }, signer, ndk)
}

export const reorderFeaturedUsers = async (orderedUsers: string[], signer: NDKSigner, ndk: NDK): Promise<string> => {
	return publishFeaturedUsers({ featuredUsers: orderedUsers }, signer, ndk)
}

/**
 * Mutation hooks for React Query integration
 */
export const usePublishFeaturedProductsMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (data: FeaturedProductsData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishFeaturedProducts(data, signer, ndk)
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
				queryClient.invalidateQueries({ queryKey: configKeys.featuredProducts(userPubkey) })
			}

			toast.success('Featured products updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update featured products:', error)
			toast.error(`Failed to update featured products: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

export const usePublishFeaturedCollectionsMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (data: FeaturedCollectionsData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishFeaturedCollections(data, signer, ndk)
		},

		onSuccess: async (eventId) => {
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.featuredCollections(userPubkey) })
			}

			toast.success('Featured collections updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update featured collections:', error)
			toast.error(`Failed to update featured collections: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

export const usePublishFeaturedUsersMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (data: FeaturedUsersData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishFeaturedUsers(data, signer, ndk)
		},

		onSuccess: async (eventId) => {
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.featuredUsers(userPubkey) })
			}

			toast.success('Featured users updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update featured users:', error)
			toast.error(`Failed to update featured users: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
