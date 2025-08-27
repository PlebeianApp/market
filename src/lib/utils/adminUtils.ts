import type { AdminSettings, EditorSettings } from '@/queries/app-settings'

export type UserRole = 'owner' | 'admin' | 'editor' | 'user'

export interface RoleSettings {
	adminSettings: AdminSettings | null | undefined
	editorSettings: EditorSettings | null | undefined
}

/**
 * Admin routes that require admin privileges
 */
export const ADMIN_ROUTES = [
	'/dashboard/app-settings/team',
	'/dashboard/app-settings/blacklists',
	'/dashboard/app-settings/app-miscelleneous',
] as const

/**
 * Check if a route is an admin-only route
 */
export function isAdminRoute(pathname: string): boolean {
	return pathname.startsWith('/dashboard/app-settings')
}

/**
 * Check if a user has admin privileges
 */
export function hasAdminAccess(adminSettings: AdminSettings | null | undefined, userPubkey: string | undefined): boolean {
	if (!adminSettings || !userPubkey) return false
	return adminSettings.admins.includes(userPubkey)
}

/**
 * Check if a user has editor privileges
 */
export function hasEditorAccess(editorSettings: EditorSettings | null | undefined, userPubkey: string | undefined): boolean {
	if (!editorSettings || !userPubkey) return false
	return editorSettings.editors.includes(userPubkey)
}

/**
 * Check if a user is the owner
 */
export function isOwner(adminSettings: AdminSettings | null | undefined, userPubkey: string | undefined): boolean {
	if (!adminSettings || !userPubkey) return false
	return adminSettings.owner === userPubkey
}

/**
 * Get user role based on admin and editor settings
 */
export function getUserRole(roleSettings: RoleSettings, userPubkey: string | undefined): UserRole {
	if (!userPubkey) return 'user'

	const { adminSettings, editorSettings } = roleSettings

	if (isOwner(adminSettings, userPubkey)) return 'owner'
	if (hasAdminAccess(adminSettings, userPubkey)) return 'admin'
	if (hasEditorAccess(editorSettings, userPubkey)) return 'editor'
	return 'user'
}

/**
 * Check if current user can access a specific admin route
 */
export function canAccessAdminRoute(pathname: string, userRole: UserRole): boolean {
	if (!isAdminRoute(pathname)) return true // Non-admin routes are accessible to all
	return userRole === 'owner' || userRole === 'admin'
}

/**
 * Check if user can promote others to a specific role
 */
export function canPromoteToRole(currentUserRole: UserRole, targetRole: UserRole): boolean {
	// Only owners can promote to admin
	if (targetRole === 'admin') return currentUserRole === 'owner'
	// Admins and owners can promote to editor
	if (targetRole === 'editor') return currentUserRole === 'owner' || currentUserRole === 'admin'
	return false
}

/**
 * Check if user can demote others from a specific role
 */
export function canDemoteFromRole(currentUserRole: UserRole, targetRole: UserRole): boolean {
	// Only owners can demote admins
	if (targetRole === 'admin') return currentUserRole === 'owner'
	// Admins and owners can demote editors
	if (targetRole === 'editor') return currentUserRole === 'owner' || currentUserRole === 'admin'
	return false
}

/**
 * Check if user can remove others entirely
 */
export function canRemoveUser(currentUserRole: UserRole, targetRole: UserRole): boolean {
	// Owners can remove anyone except themselves
	if (currentUserRole === 'owner') return targetRole !== 'owner'
	// Admins can remove editors
	if (currentUserRole === 'admin') return targetRole === 'editor'
	return false
}
