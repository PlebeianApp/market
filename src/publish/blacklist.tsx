import { submitAppSettings } from '@/lib/appSettings'
import { ndkActions } from '@/lib/stores/ndk'
import { fetchBlacklistSettings } from '@/queries/blacklist'
import { configKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface BlacklistData {
	blacklistedPubkeys: string[] // Array of blacklisted pubkeys in hex format
}

/**
 * Creates a Kind 10000 blacklist event (NIP-51 mute list)
 */
const createBlacklistEvent = (blacklistData: BlacklistData, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = 10000 // NIP-51 mute list
	event.content = ''

	// Build tags - use 'p' tags for muted pubkeys as per NIP-51
	const tags: NDKTag[] = []

	// Add blacklisted pubkeys as 'p' tags
	for (const pubkey of blacklistData.blacklistedPubkeys) {
		tags.push(['p', pubkey])
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

	return publishBlacklist({ blacklistedPubkeys: updatedBlacklistedPubkeys }, signer, ndk)
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

	return publishBlacklist({ blacklistedPubkeys: updatedBlacklistedPubkeys }, signer, ndk)
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
