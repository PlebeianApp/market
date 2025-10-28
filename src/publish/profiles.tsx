import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile, NDKEvent } from '@nostr-dev-kit/ndk'
import { profileKeys } from '@/queries/queryKeyFactory'
import { toast } from 'sonner'
import { storeProfileInLocalStorage } from '@/lib/utils/profileStorage'

/**
 * Updates the user's profile on the Nostr network.
 *
 * @param profile The profile data to publish
 * @returns Promise that resolves when the profile is published
 */
export const updateProfile = async (profile: NDKUserProfile): Promise<void> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const user = ndk.activeUser
	if (!user) throw new Error('No active user')

	// No need to clean up bugs relay since bug reports now use isolated nostr-tools SimplePool

	// Ensure NDK is connected before publishing
	if (!ndk.pool || ndk.pool.connectedRelays().length === 0) {
		await ndkActions.connect()

		if (!ndk.pool || ndk.pool.connectedRelays().length === 0) {
			throw new Error('Unable to connect to any relays. Please check your internet connection and try again.')
		}
	}

	// Update the user's profile and publish the changes
	user.profile = profile

	const connectedRelays = ndk.pool?.connectedRelays() || []
	if (connectedRelays.length === 0) {
		throw new Error('No relays available for publishing. Please check your connection.')
	}

	// Create the profile event manually
	const profileEvent = new NDKEvent(ndk)
	profileEvent.kind = 0 // Kind 0 is for user metadata
	profileEvent.content = JSON.stringify(profile)
	profileEvent.pubkey = user.pubkey

	try {
		// Sign and publish the profile event
		await profileEvent.sign()

		const publishPromise = profileEvent.publish()
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => reject(new Error('Profile publish timeout')), 15000)
		})

		const publishResult = await Promise.race([publishPromise, timeoutPromise])

		// Check if any relays actually received the event
		if (
			publishResult &&
			((publishResult instanceof Set && publishResult.size === 0) || (Array.isArray(publishResult) && publishResult.length === 0))
		) {
			throw new Error('Profile published but no relays confirmed receipt')
		}
	} catch (error) {
		// Provide more specific error message for relay issues
		if (error instanceof Error && error.message.includes('Not enough relays')) {
			throw new Error('Unable to publish profile - relay connection failed. Please try again or check if the staging relay is accessible.')
		}

		if (error instanceof Error && error.message.includes('timeout')) {
			throw new Error('Profile publish timed out. Please check your connection and try again.')
		}

		throw error
	}
}

/**
 * Mutation hook for updating a user profile.
 * Handles invalidating the related queries for proper cache updates.
 */
export function useUpdateProfileMutation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: updateProfile,
		retry: (failureCount, error) => {
			// Retry up to 2 times for certain errors
			if (failureCount < 2) {
				if (error instanceof Error) {
					// Retry for connection issues
					if (
						error.message.includes('connection') ||
						error.message.includes('timeout') ||
						error.message.includes('relay connection failed')
					) {
						return true
					}
					// Retry for relay issues
					if (error.message.includes('Not enough relays') || error.message.includes('no relays confirmed')) {
						return true
					}
				}
			}

			return false
		},
		retryDelay: (attemptIndex) => {
			return Math.min(1000 * 2 ** attemptIndex, 5000) // Exponential backoff, max 5s
		},
		onSuccess: async (_, profile) => {
			// Get the pubkey of the active user
			const ndk = ndkActions.getNDK()
			const pubkey = ndk?.activeUser?.pubkey

			if (pubkey) {
				// Store profile in localStorage for immediate access
				storeProfileInLocalStorage(pubkey, profile)

				// Update the query cache with the new profile data
				queryClient.setQueryData(profileKeys.details(pubkey), { profile, user: ndk.activeUser })

				// Schedule a delayed invalidation to allow relay propagation
				// This gives the relay time to process and store the new profile
				setTimeout(() => {
					queryClient.invalidateQueries({ queryKey: profileKeys.details(pubkey) })
				}, 3000) // 3 second delay

				toast.success('Profile updated successfully')
			}
		},
		onError: (error) => {
			// Provide more specific error messages
			let errorMessage = 'Failed to update profile'
			if (error instanceof Error) {
				if (error.message.includes('NDK not initialized')) {
					errorMessage = 'Connection not available. Please try again.'
				} else if (error.message.includes('No active user')) {
					errorMessage = 'Please sign in to update your profile.'
				} else if (error.message.includes('timeout') || error.message.includes('connection')) {
					errorMessage = 'Connection timeout. Please check your internet and try again.'
				} else if (error.message.includes('relay connection failed')) {
					errorMessage = 'Unable to connect to relay. Please try again.'
				} else if (error.message.includes('Not enough relays')) {
					errorMessage = 'Relay did not accept the profile update. Please try again.'
				}
			}

			toast.error(errorMessage)
		},
	})
}

/**
 * Updates a specific field of the user's profile.
 * Useful for single field updates without affecting other fields.
 *
 * @param field The profile field to update
 * @param value The new value for the field
 */
export function useUpdateProfileFieldMutation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async ({ field, value }: { field: string; value: string | undefined }) => {
			const ndk = ndkActions.getNDK()
			if (!ndk) throw new Error('NDK not initialized')

			const user = ndk.activeUser
			if (!user) throw new Error('No active user')

			// Fetch current profile
			const currentProfile = user.profile || {}

			// Update the specific field
			const updatedProfile = {
				...currentProfile,
				[field]: value,
			}

			// Update the user's profile and publish
			user.profile = updatedProfile
			await user.publish()

			return updatedProfile
		},
		onSuccess: async (updatedProfile, { field }) => {
			// Get the pubkey of the active user
			const ndk = ndkActions.getNDK()
			const pubkey = ndk?.activeUser?.pubkey

			if (pubkey) {
				// Invalidate relevant queries
				await queryClient.invalidateQueries({ queryKey: profileKeys.details(pubkey) })

				// If the updated field was nip05, invalidate that query too
				if (field === 'nip05') {
					await queryClient.invalidateQueries({ queryKey: profileKeys.nip05(pubkey) })
				}

				toast.success(`Profile ${field} updated successfully`)
			}
		},
		onError: (error) => {
			console.error('Failed to update profile field:', error)
			toast.error('Failed to update profile')
		},
	})
}
