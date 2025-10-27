import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile } from '@nostr-dev-kit/ndk'
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

	// Ensure NDK is connected before publishing
	if (!ndk.pool || ndk.pool.connectedRelays().length === 0) {
		console.log('NDK not connected, attempting to connect...')
		await ndkActions.connect()
	}

	// Update the user's profile and publish the changes
	user.profile = profile

	console.log(
		'Publishing profile to relays:',
		ndk.pool?.connectedRelays().map((r) => r.url),
	)
	const publishResult = await user.publish()
	console.log('Profile publish result:', publishResult)
}

/**
 * Mutation hook for updating a user profile.
 * Handles invalidating the related queries for proper cache updates.
 */
export function useUpdateProfileMutation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: updateProfile,
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
					console.log('🔄 Profile cache invalidated after relay propagation delay')
				}, 3000) // 3 second delay

				toast.success('Profile updated successfully')
			}
		},
		onError: (error) => {
			console.error('Failed to update profile:', error)

			// Provide more specific error messages
			let errorMessage = 'Failed to update profile'
			if (error instanceof Error) {
				if (error.message.includes('NDK not initialized')) {
					errorMessage = 'Connection not available. Please try again.'
				} else if (error.message.includes('No active user')) {
					errorMessage = 'Please sign in to update your profile.'
				} else if (error.message.includes('timeout') || error.message.includes('connection')) {
					errorMessage = 'Connection timeout. Please check your internet and try again.'
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
