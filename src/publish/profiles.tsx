import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile } from '@nostr-dev-kit/ndk'
import { profileKeys } from '@/queries/queryKeyFactory'
import { toast } from 'sonner'

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

	// Update the user's profile and publish the changes
	user.profile = profile

	await user.publish()
}

/**
 * Mutation hook for updating a user profile.
 * Handles invalidating the related queries for proper cache updates.
 */
export const useUpdateProfileMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: updateProfile,
		onSuccess: async (_, profile) => {
			// Get the pubkey of the active user
			const ndk = ndkActions.getNDK()
			const pubkey = ndk?.activeUser?.pubkey

			if (pubkey) {
				// Invalidate relevant queries to trigger refetching
				await queryClient.invalidateQueries({ queryKey: profileKeys.details(pubkey) })

				toast.success('Profile updated successfully')
			}
		},
		onError: (error) => {
			console.error('Failed to update profile:', error)
			toast.error('Failed to update profile')
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
export const useUpdateProfileFieldMutation = () => {
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
