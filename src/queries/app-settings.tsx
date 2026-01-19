import { ndkActions } from '@/lib/stores/ndk'
import { naddrFromAddress } from '@/lib/nostr/naddr'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { configKeys } from './queryKeyFactory'

export interface AdminSettings {
	admins: string[] // Array of admin pubkeys in hex format
	owner: string // Owner pubkey in hex format
	lastUpdated: number // Timestamp of last update
	event: NDKEvent // Raw admin list event
}

export interface EditorSettings {
	editors: string[]
	lastUpdated: number
	event: NDKEvent | null
}

/**
 * Fetches admin settings (kind 30000) for the app
 */
export const fetchAdminSettings = async (appPubkey?: string): Promise<AdminSettings | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// If no app pubkey provided, try to get it from config
	let targetPubkey = appPubkey
	if (!targetPubkey) {
		// We could get this from config, but for now require it to be passed
		throw new Error('App pubkey is required')
	}

	const naddr = naddrFromAddress(30000, targetPubkey, 'admins')
	const latestEvent = await ndk.fetchEvent(naddr)

	if (!latestEvent) {
		console.log(`No admin settings found for app pubkey: ${targetPubkey}`)
		return null
	}

	// Extract admin pubkeys from 'p' tags
	const adminPubkeys = latestEvent.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])

	// Assume the first admin is the owner (or use a specific tag if available)
	const owner = adminPubkeys[0] || targetPubkey

	return {
		admins: adminPubkeys,
		owner,
		lastUpdated: latestEvent.created_at ?? 0,
		event: latestEvent,
	}
}

/**
 * Hook to fetch admin settings for the app
 */
export const useAdminSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor admin list changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const adminListFilter = {
			kinds: [30000],
			authors: [appPubkey],
			'#d': ['admins'],
		}

		// Track latest event timestamp to avoid reacting to historical events
		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(adminListFilter, {
			closeOnEose: false, // Keep subscription open
		})

		// Event handler for admin list updates - only react to newer events after EOSE
		subscription.on('event', (newEvent) => {
			const eventTime = newEvent.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.refetchQueries({ queryKey: configKeys.admins(appPubkey) })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.admins(appPubkey || ''),
		queryFn: () => fetchAdminSettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000, // Consider data stale after 30 seconds
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}

/**
 * Check if a specific pubkey is an admin
 */
export const isAdmin = (adminSettings: AdminSettings | null | undefined, pubkey: string): boolean => {
	if (!adminSettings || !pubkey) return false
	return adminSettings.admins.includes(pubkey)
}

/**
 * Check if a specific pubkey is the owner
 */
export const isOwner = (adminSettings: AdminSettings | null | undefined, pubkey: string): boolean => {
	if (!adminSettings || !pubkey) return false
	return adminSettings.owner === pubkey
}

/**
 * Hook to check if the current user is an admin
 */
export const useAmIAdmin = (appPubkey?: string) => {
	const { data: adminSettings, isLoading } = useAdminSettings(appPubkey)
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	const amIAdmin = isAdmin(adminSettings, currentUserPubkey || '')
	const amIOwner = isOwner(adminSettings, currentUserPubkey || '')

	return {
		amIAdmin,
		amIOwner,
		isLoading,
		adminSettings,
		currentUserPubkey,
	}
}

/**
 * Get formatted admin list for display
 */
export const getFormattedAdmins = (adminSettings: AdminSettings | null | undefined) => {
	if (!adminSettings) return []

	return adminSettings.admins.map((pubkey, index) => ({
		pubkey,
		isOwner: pubkey === adminSettings.owner,
		index,
	}))
}

/**
 * Fetches editor settings (kind 30000) for the app
 */
export const fetchEditorSettings = async (appPubkey?: string): Promise<EditorSettings | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// If no app pubkey provided, try to get it from config
	let targetPubkey = appPubkey
	if (!targetPubkey) {
		// We could get this from config, but for now require it to be passed
		throw new Error('App pubkey is required')
	}

	const naddr = naddrFromAddress(30000, targetPubkey, 'editors')
	const latestEvent = await ndk.fetchEvent(naddr)

	if (!latestEvent) {
		console.log(`No editor settings found for app pubkey: ${targetPubkey}`)
		// Return empty editor list instead of null for consistency
		return {
			editors: [],
			lastUpdated: 0,
			event: null,
		}
	}

	// Extract editor pubkeys from 'p' tags
	const editorPubkeys = latestEvent.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])

	return {
		editors: editorPubkeys,
		lastUpdated: latestEvent.created_at ?? 0,
		event: latestEvent,
	}
}

/**
 * Hook to fetch editor settings for the app
 */
export const useEditorSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor editor list changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const editorListFilter = {
			kinds: [30000],
			authors: [appPubkey],
			'#d': ['editors'],
		}

		// Track latest event timestamp to avoid reacting to historical events
		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(editorListFilter, {
			closeOnEose: false, // Keep subscription open
		})

		// Event handler for editor list updates - only react to newer events after EOSE
		subscription.on('event', (newEvent) => {
			const eventTime = newEvent.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
				queryClient.refetchQueries({ queryKey: configKeys.editors(appPubkey) })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.editors(appPubkey || ''),
		queryFn: () => fetchEditorSettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000, // Consider data stale after 30 seconds
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}

/**
 * Check if a pubkey is an editor
 */
export const isEditor = (editorSettings: EditorSettings | null | undefined, pubkey: string): boolean => {
	if (!editorSettings || !pubkey) return false
	return editorSettings.editors.includes(pubkey)
}

/**
 * Get formatted editor data for display
 */
export const getFormattedEditors = (editorSettings: EditorSettings | null | undefined) => {
	if (!editorSettings || !editorSettings.editors) return []

	return editorSettings.editors.map((pubkey) => ({
		pubkey,
		role: 'editor' as const,
	}))
}

/**
 * Hook to check comprehensive user role status (admin, editor, etc.)
 */
export const useUserRole = (appPubkey?: string) => {
	const { data: adminSettings, isLoading: isLoadingAdmins } = useAdminSettings(appPubkey)
	const { data: editorSettings, isLoading: isLoadingEditors } = useEditorSettings(appPubkey)
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	const amIAdmin = isAdmin(adminSettings, currentUserPubkey || '')
	const amIOwner = isOwner(adminSettings, currentUserPubkey || '')
	const amIEditor = isEditor(editorSettings, currentUserPubkey || '')

	// Determine the user's highest role
	const userRole: 'owner' | 'admin' | 'editor' | 'user' = amIOwner ? 'owner' : amIAdmin ? 'admin' : amIEditor ? 'editor' : 'user'

	return {
		amIAdmin,
		amIOwner,
		amIEditor,
		userRole,
		isLoading: isLoadingAdmins || isLoadingEditors,
		adminSettings,
		editorSettings,
		currentUserPubkey,
	}
}

/**
 * Get user role for a specific pubkey
 */
export const getUserRoleForPubkey = (
	adminSettings: AdminSettings | null | undefined,
	editorSettings: EditorSettings | null | undefined,
	pubkey: string,
): 'owner' | 'admin' | 'editor' | 'user' => {
	if (isOwner(adminSettings, pubkey)) return 'owner'
	if (isAdmin(adminSettings, pubkey)) return 'admin'
	if (isEditor(editorSettings, pubkey)) return 'editor'
	return 'user'
}
