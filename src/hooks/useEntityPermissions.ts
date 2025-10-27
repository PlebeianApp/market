import { ndkActions } from '@/lib/stores/ndk'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { useUserRole } from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { useMemo } from 'react'

export interface EntityPermissions {
	// User role information
	userRole: 'owner' | 'admin' | 'editor' | 'user'
	currentUserPubkey: string | undefined

	// Entity ownership
	isEntityOwner: boolean

	// Permissions
	canEdit: boolean
	canDelete: boolean
	canBlacklist: boolean
	canSetFeatured: boolean
	canAddToCart: boolean

	// Loading state
	isLoading: boolean
}

/**
 * Hook to determine user permissions for a specific entity (product, collection, profile)
 *
 * @param entityPubkey - The pubkey of the entity's creator/owner
 * @returns EntityPermissions object with all permission flags
 */
export function useEntityPermissions(entityPubkey: string | undefined): EntityPermissions {
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey
	const authState = useStore(authStore)

	const { userRole, isLoading, currentUserPubkey } = useUserRole(appPubkey)
	const authenticatedUserPubkey = authState.user?.pubkey

	const permissions = useMemo(() => {
		// Determine if current user is the entity owner
		const isEntityOwner = !!(entityPubkey && authenticatedUserPubkey && entityPubkey === authenticatedUserPubkey)

		// Debug logging for permissions
		if (process.env.NODE_ENV === 'development') {
			console.log('🔍 Entity Permissions:', {
				entityPubkey: entityPubkey?.slice(0, 8) + '...',
				authenticatedUserPubkey: authenticatedUserPubkey?.slice(0, 8) + '...',
				isEntityOwner,
				userRole,
				isAuthenticated: !!authenticatedUserPubkey,
			})
		}

		// Admins and editors can blacklist and set featured
		const canBlacklist = userRole === 'owner' || userRole === 'admin' || userRole === 'editor'
		const canSetFeatured = userRole === 'owner' || userRole === 'admin' || userRole === 'editor'

		// Only entity owners can edit and delete their own entities
		const canEdit = isEntityOwner
		const canDelete = isEntityOwner

		// Entity owners cannot add their own items to cart
		// Admins, editors, and regular users can add to cart (if not the owner)
		const canAddToCart = !isEntityOwner

		return {
			userRole,
			currentUserPubkey: authenticatedUserPubkey,
			isEntityOwner,
			canEdit,
			canDelete,
			canBlacklist,
			canSetFeatured,
			canAddToCart,
			isLoading,
		}
	}, [entityPubkey, authenticatedUserPubkey, userRole, isLoading])

	return permissions
}
