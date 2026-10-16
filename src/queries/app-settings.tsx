import { fetchLatestAppEvent, getMainRelay, ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
	buildCurationListFilter,
	getFormattedAdmins,
	getFormattedEditors,
	getUserRoleForPubkey,
	isAdmin,
	isEditor,
	isOwner,
	parseAdminSettings,
	parseEditorSettings,
	type AdminSettings as SdkAdminSettings,
	type EditorSettings as SdkEditorSettings,
} from '@sdk/commerce/curation'
import { configKeys } from './queryKeyFactory'

export { getFormattedAdmins, getFormattedEditors, getUserRoleForPubkey, isAdmin, isEditor, isOwner }

export type AdminSettings = SdkAdminSettings<NDKEvent>

export type EditorSettings = SdkEditorSettings<NDKEvent>

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

	const latestEvent = await fetchLatestAppEvent(buildCurationListFilter('admins', targetPubkey))

	if (!latestEvent) {
		console.log(`No admin settings found for app pubkey: ${targetPubkey}`)
		return null
	}

	return parseAdminSettings(latestEvent, targetPubkey)
}

/**
 * Hook to fetch admin settings for the app
 */
export const useAdminSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const mainRelay = getMainRelay()

	// Set up a live subscription to monitor admin list changes
	useEffect(() => {
		if (!appPubkey || !ndk || !mainRelay) return

		const adminListFilter = buildCurationListFilter('admins', appPubkey)

		// Track latest event timestamp to avoid reacting to historical events
		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(adminListFilter, {
			closeOnEose: false, // Keep subscription open
			relayUrls: [mainRelay],
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
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
	}, [appPubkey, ndk, mainRelay, queryClient])

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

	const latestEvent = await fetchLatestAppEvent(buildCurationListFilter('editors', targetPubkey))

	if (!latestEvent) console.log(`No editor settings found for app pubkey: ${targetPubkey}`)

	return parseEditorSettings(latestEvent)
}

/**
 * Hook to fetch editor settings for the app
 */
export const useEditorSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const mainRelay = getMainRelay()

	// Set up a live subscription to monitor editor list changes
	useEffect(() => {
		if (!appPubkey || !ndk || !mainRelay) return

		const editorListFilter = buildCurationListFilter('editors', appPubkey)

		// Track latest event timestamp to avoid reacting to historical events
		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(editorListFilter, {
			closeOnEose: false, // Keep subscription open
			relayUrls: [mainRelay],
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
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
	}, [appPubkey, ndk, mainRelay, queryClient])

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
	const userRole = getUserRoleForPubkey(adminSettings, editorSettings, currentUserPubkey || '')

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
