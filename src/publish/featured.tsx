import { fetchLatestAppEvent, ndkActions } from '@/lib/stores/ndk'
import { configKeys } from '@/queries/queryKeyFactory'
import { NDKEvent, type NDKFilter, type NDKSigner } from '@/lib/nostr/ndk-events'
import {
	addListItem,
	buildCurationListEventData,
	CURATION_LISTS,
	publishCurationListWorkflow,
	readCurationListItems,
	removeListItem,
	type CurationListKey,
} from '@sdk/commerce/curation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createAppSettingsPublishContext, curationIssueMessage, resolveListOwner, type NdkClient as NDK } from './curationContext'

export interface FeaturedProductsData {
	featuredProducts: string[] // Array of product coordinates in order
}

export interface FeaturedCollectionsData {
	featuredCollections: string[] // Array of collection coordinates in order
}

export interface FeaturedAuctionsData {
	featuredAuctions: string[] // Array of auction coordinates in order
}

export interface FeaturedUsersData {
	featuredUsers: string[] // Array of user pubkeys in order
}

type FeaturedListKey = Extract<CurationListKey, `featured${string}`>

const FEATURED_LABELS: Record<FeaturedListKey, { invalidItem: string; alreadyListed: string; notListed: string }> = {
	featuredProducts: {
		invalidItem: 'product coordinates',
		alreadyListed: 'Product is already featured',
		notListed: 'Product is not featured',
	},
	featuredCollections: {
		invalidItem: 'collection coordinates',
		alreadyListed: 'Collection is already featured',
		notListed: 'Collection is not featured',
	},
	featuredAuctions: {
		invalidItem: 'auction coordinates',
		alreadyListed: 'Auction is already featured',
		notListed: 'Auction is not featured',
	},
	featuredUsers: { invalidItem: 'pubkey', alreadyListed: 'User is already featured', notListed: 'User is not featured' },
}

function createFeaturedListEvent(ndk: NDK, list: FeaturedListKey, items: string[]): NDKEvent {
	const data = buildCurationListEventData(list, items)
	const event = new NDKEvent(ndk)
	event.kind = data.kind
	event.content = data.content
	event.tags = data.tags
	return event
}

/**
 * Creates a Kind 30405 featured products event (Collection format)
 */
export const createFeaturedProductsEvent = (data: FeaturedProductsData, _signer: NDKSigner, ndk: NDK): NDKEvent =>
	createFeaturedListEvent(ndk, 'featuredProducts', data.featuredProducts)

/**
 * Creates a Kind 30003 featured collections event (NIP-51 list)
 */
export const createFeaturedCollectionsEvent = (data: FeaturedCollectionsData, _signer: NDKSigner, ndk: NDK): NDKEvent =>
	createFeaturedListEvent(ndk, 'featuredCollections', data.featuredCollections)

/**
 * Creates a Kind 30409 featured auctions event
 */
export const createFeaturedAuctionsEvent = (data: FeaturedAuctionsData, _signer: NDKSigner, ndk: NDK): NDKEvent =>
	createFeaturedListEvent(ndk, 'featuredAuctions', data.featuredAuctions)

/**
 * Creates a Kind 30000 featured users event (NIP-51 list)
 */
export const createFeaturedUsersEvent = (data: FeaturedUsersData, _signer: NDKSigner, ndk: NDK): NDKEvent =>
	createFeaturedListEvent(ndk, 'featuredUsers', data.featuredUsers)

/** Validates, signs, and submits a featured list through the app-settings WebSocket. */
async function publishFeaturedList(list: FeaturedListKey, items: string[], signer: NDKSigner, ndk: NDK): Promise<string> {
	const outcome = await publishCurationListWorkflow(await createAppSettingsPublishContext(ndk, signer), list, items)
	if (!outcome.ok) throw new Error(curationIssueMessage(outcome, FEATURED_LABELS[list].invalidItem))
	return outcome.event.id
}

export const publishFeaturedProducts = (data: FeaturedProductsData, signer: NDKSigner, ndk: NDK): Promise<string> =>
	publishFeaturedList('featuredProducts', data.featuredProducts, signer, ndk)

export const publishFeaturedCollections = (data: FeaturedCollectionsData, signer: NDKSigner, ndk: NDK): Promise<string> =>
	publishFeaturedList('featuredCollections', data.featuredCollections, signer, ndk)

export const publishFeaturedAuctions = (data: FeaturedAuctionsData, signer: NDKSigner, ndk: NDK): Promise<string> =>
	publishFeaturedList('featuredAuctions', data.featuredAuctions, signer, ndk)

export const publishFeaturedUsers = (data: FeaturedUsersData, signer: NDKSigner, ndk: NDK): Promise<string> =>
	publishFeaturedList('featuredUsers', data.featuredUsers, signer, ndk)

async function fetchFeaturedItems(list: FeaturedListKey, owner: string, ndk: NDK): Promise<string[]> {
	const { kind, dTag } = CURATION_LISTS[list]
	const filter = { kinds: [kind], authors: [owner], '#d': [dTag] }
	// Auctions read from the regular pool; the other lists read the app relay only to avoid stale copies.
	const currentEvent =
		list === 'featuredAuctions'
			? Array.from(await ndk.fetchEvents({ ...filter, limit: 1 } as NDKFilter))[0]
			: await fetchLatestAppEvent(filter)
	return readCurationListItems(list, currentEvent?.tags)
}

async function changeFeaturedList(
	list: FeaturedListKey,
	item: string,
	change: 'add' | 'remove',
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<string> {
	const current = await fetchFeaturedItems(list, await resolveListOwner(signer, appPubkey), ndk)
	const result = change === 'add' ? addListItem(current, item) : removeListItem(current, item)
	if (!result.ok) throw new Error(result.error === 'already-listed' ? FEATURED_LABELS[list].alreadyListed : FEATURED_LABELS[list].notListed)
	return publishFeaturedList(list, result.value, signer, ndk)
}

/**
 * Adds an item to featured products with ordering
 */
export const addToFeaturedProducts = (productCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredProducts', productCoords, 'add', signer, ndk, appPubkey)

/**
 * Removes an item from featured products
 */
export const removeFromFeaturedProducts = (productCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredProducts', productCoords, 'remove', signer, ndk, appPubkey)

/**
 * Reorders featured products
 */
export const reorderFeaturedProducts = async (orderedProducts: string[], signer: NDKSigner, ndk: NDK): Promise<string> => {
	return publishFeaturedProducts({ featuredProducts: orderedProducts }, signer, ndk)
}

/**
 * Similar functions for collections
 */
export const addToFeaturedCollections = (collectionCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredCollections', collectionCoords, 'add', signer, ndk, appPubkey)

export const removeFromFeaturedCollections = (collectionCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredCollections', collectionCoords, 'remove', signer, ndk, appPubkey)

export const reorderFeaturedCollections = async (orderedCollections: string[], signer: NDKSigner, ndk: NDK): Promise<string> => {
	return publishFeaturedCollections({ featuredCollections: orderedCollections }, signer, ndk)
}

/**
 * Similar functions for auctions
 */
export const addToFeaturedAuctions = (auctionCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredAuctions', auctionCoords, 'add', signer, ndk, appPubkey)

export const removeFromFeaturedAuctions = (auctionCoords: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredAuctions', auctionCoords, 'remove', signer, ndk, appPubkey)

export const reorderFeaturedAuctions = async (orderedAuctions: string[], signer: NDKSigner, ndk: NDK): Promise<string> => {
	return publishFeaturedAuctions({ featuredAuctions: orderedAuctions }, signer, ndk)
}

/**
 * Similar functions for users
 */
export const addToFeaturedUsers = (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredUsers', userPubkey, 'add', signer, ndk, appPubkey)

export const removeFromFeaturedUsers = (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> =>
	changeFeaturedList('featuredUsers', userPubkey, 'remove', signer, ndk, appPubkey)

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

export const usePublishFeaturedAuctionsMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (data: FeaturedAuctionsData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishFeaturedAuctions(data, signer, ndk)
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
				queryClient.invalidateQueries({ queryKey: configKeys.featuredAuctions(userPubkey) })
			}

			toast.success('Featured auctions updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update featured auctions:', error)
			toast.error(`Failed to update featured auctions: ${error instanceof Error ? error.message : String(error)}`)
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
