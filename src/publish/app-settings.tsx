import { submitAppSettings } from '@/lib/appSettings'
import { ndkActions } from '@/lib/stores/ndk'
import { fetchAdminSettings, fetchEditorSettings } from '@/queries/app-settings'
import { configKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface AdminListData {
	admins: string[] // Array of admin pubkeys in hex format
}

export interface EditorListData {
	editors: string[] // Array of editor pubkeys in hex format
}

/**
 * Creates a Kind 30000 admin list event
 */
const createAdminListEvent = (adminData: AdminListData, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = 30000
	event.content = ''

	// Build tags
	const tags: NDKTag[] = [['d', 'admins']]

	// Add admin pubkeys as 'p' tags
	for (const pubkey of adminData.admins) {
		tags.push(['p', pubkey])
	}

	event.tags = tags
	return event
}

/**
 * Creates a Kind 30000 editor list event
 */
const createEditorListEvent = (editorData: EditorListData, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = 30000
	event.content = ''

	// Build tags
	const tags: NDKTag[] = [['d', 'editors']]

	// Add editor pubkeys as 'p' tags
	for (const pubkey of editorData.editors) {
		tags.push(['p', pubkey])
	}

	event.tags = tags
	return event
}

/**
 * Publishes an updated admin list through WebSocket interface
 */
export const publishAdminList = async (adminData: AdminListData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validation
	if (!adminData.admins || adminData.admins.length === 0) {
		throw new Error('At least one admin is required')
	}

	// Validate all pubkeys are valid hex strings
	for (const pubkey of adminData.admins) {
		if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
			throw new Error(`Invalid pubkey format: ${pubkey}`)
		}
	}

	// Create and sign the event normally
	const event = createAdminListEvent(adminData, signer, ndk)
	await event.sign(signer)

	// Submit through WebSocket interface (will be re-signed with app pubkey)
	await submitAppSettings(event.rawEvent())

	return event.id
}

/**
 * Adds an admin to the existing admin list
 */
export const addAdmin = async (newAdminPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey (should be an existing admin)
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current admin list using app pubkey (where the events are actually stored)
	const adminListFilter = {
		kinds: [30000],
		authors: [targetAppPubkey],
		'#d': ['admins'],
		limit: 1,
	}

	const events = await ndk.fetchEvents(adminListFilter)
	const eventArray = Array.from(events)

	let currentAdmins: string[] = []
	if (eventArray.length > 0) {
		const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
		currentAdmins = latestEvent.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])
	}

	// Check if admin already exists
	if (currentAdmins.includes(newAdminPubkey)) {
		throw new Error('User is already an admin')
	}

	// Add new admin to the list
	const updatedAdmins = [...currentAdmins, newAdminPubkey]

	return publishAdminList({ admins: updatedAdmins }, signer, ndk)
}

/**
 * Removes an admin from the existing admin list
 */
export const removeAdmin = async (adminPubkeyToRemove: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current admin list using app pubkey (where the events are actually stored)
	const adminListFilter = {
		kinds: [30000],
		authors: [targetAppPubkey],
		'#d': ['admins'],
		limit: 1,
	}

	const events = await ndk.fetchEvents(adminListFilter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		throw new Error('No admin list found')
	}

	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
	const currentAdmins = latestEvent.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])

	// Check if admin exists
	if (!currentAdmins.includes(adminPubkeyToRemove)) {
		throw new Error('User is not an admin')
	}

	// Don't allow removing the last admin
	if (currentAdmins.length === 1) {
		throw new Error('Cannot remove the last admin')
	}

	// Remove admin from the list
	const updatedAdmins = currentAdmins.filter((pubkey) => pubkey !== adminPubkeyToRemove)

	return publishAdminList({ admins: updatedAdmins }, signer, ndk)
}

/**
 * Mutation hook for publishing admin list
 */
export const usePublishAdminListMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (adminData: AdminListData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishAdminList(adminData, signer, ndk)
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
				queryClient.invalidateQueries({ queryKey: configKeys.admins(userPubkey) })
			}

			toast.success('Admin list updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update admin list:', error)
			toast.error(`Failed to update admin list: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for adding an admin
 */
export const useAddAdminMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return addAdmin(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
			}

			toast.success('Admin added successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to add admin:', error)
			toast.error(`Failed to add admin: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for removing an admin
 */
export const useRemoveAdminMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return removeAdmin(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
			}

			toast.success('Admin removed successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to remove admin:', error)
			toast.error(`Failed to remove admin: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Publishes an updated editor list through WebSocket interface
 */
export const publishEditorList = async (editorData: EditorListData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validate all pubkeys are valid hex strings (if any)
	for (const pubkey of editorData.editors) {
		if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
			throw new Error(`Invalid pubkey format: ${pubkey}`)
		}
	}

	// Create and sign the event normally
	const event = createEditorListEvent(editorData, signer, ndk)
	await event.sign(signer)

	// Submit through WebSocket interface (will be re-signed with app pubkey)
	await submitAppSettings(event.rawEvent())

	return event.id
}

/**
 * Adds an editor to the existing editor list
 */
export const addEditor = async (newEditorPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey (should be an existing admin)
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current editor list using app pubkey (where the events are actually stored)
	const editorListFilter = {
		kinds: [30000],
		authors: [targetAppPubkey],
		'#d': ['editors'],
		limit: 1,
	}

	const events = await ndk.fetchEvents(editorListFilter)
	const eventArray = Array.from(events)

	let currentEditors: string[] = []
	if (eventArray.length > 0) {
		const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
		currentEditors = latestEvent.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])
	}

	// Check if editor already exists
	if (currentEditors.includes(newEditorPubkey)) {
		throw new Error('User is already an editor')
	}

	// Add new editor to the list
	const updatedEditors = [...currentEditors, newEditorPubkey]

	return publishEditorList({ editors: updatedEditors }, signer, ndk)
}

/**
 * Removes an editor from the existing editor list
 */
export const removeEditor = async (editorPubkeyToRemove: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise fallback to current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch current editor list using app pubkey (where the events are actually stored)
	const editorListFilter = {
		kinds: [30000],
		authors: [targetAppPubkey],
		'#d': ['editors'],
		limit: 1,
	}

	const events = await ndk.fetchEvents(editorListFilter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		throw new Error('No editor list found')
	}

	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
	const currentEditors = latestEvent.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])

	// Check if editor exists
	if (!currentEditors.includes(editorPubkeyToRemove)) {
		throw new Error('User is not an editor')
	}

	// Remove editor from the list
	const updatedEditors = currentEditors.filter((pubkey) => pubkey !== editorPubkeyToRemove)

	// Allow removing all editors (unlike admins, editors list can be empty)
	return publishEditorList({ editors: updatedEditors }, signer, ndk)
}

/**
 * Mutation hook for publishing editor list
 */
export const usePublishEditorListMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (editorData: EditorListData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return publishEditorList(editorData, signer, ndk)
		},

		onSuccess: async (eventId, editorData) => {
			// Note: Editor events are stored with app pubkey as author after re-signing
			// We need to invalidate using app pubkey, not current user pubkey

			// Get app pubkey from current config
			const configQuery = queryClient.getQueryData(['config']) as { appPublicKey?: string } | undefined
			const appPubkey = configQuery?.appPublicKey

			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('Editor list updated successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update editor list:', error)
			toast.error(`Failed to update editor list: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for adding an editor
 */
export const useAddEditorMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return addEditor(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('Editor added successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to add editor:', error)
			toast.error(`Failed to add editor: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for removing an editor
 */
export const useRemoveEditorMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return removeEditor(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (eventId, { appPubkey }) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('Editor removed successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to remove editor:', error)
			toast.error(`Failed to remove editor: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Promotes a user from editor to admin (pessimistic update)
 */
export const promoteEditorToAdmin = async (
	userPubkey: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<{ adminEventId: string; editorEventId: string }> => {
	// Get current user's pubkey (should be the app pubkey or an existing admin)
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise use current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch latest admin settings using app pubkey
	const adminSettings = await fetchAdminSettings(targetAppPubkey)
	const editorSettings = await fetchEditorSettings(targetAppPubkey)

	if (!adminSettings) {
		throw new Error('No admin list found')
	}

	// Check if user is already an admin
	if (adminSettings.admins.includes(userPubkey)) {
		throw new Error('User is already an admin')
	}

	// Check if user is currently an editor
	if (!editorSettings || !editorSettings.editors.includes(userPubkey)) {
		throw new Error('User is not currently an editor')
	}

	// Remove from editors list
	const updatedEditors = editorSettings.editors.filter((pubkey) => pubkey !== userPubkey)

	// Add to admins list
	const updatedAdmins = [...adminSettings.admins, userPubkey]

	// Publish both events
	console.log('Publishing admin list update...', { updatedAdmins })
	const adminEventId = await publishAdminList({ admins: updatedAdmins }, signer, ndk)
	console.log('Admin list published successfully:', adminEventId)

	console.log('Publishing editor list update...', { updatedEditors })
	const editorEventId = await publishEditorList({ editors: updatedEditors }, signer, ndk)
	console.log('Editor list published successfully:', editorEventId)

	return { adminEventId, editorEventId }
}

/**
 * Demotes a user from admin to editor (pessimistic update)
 */
export const demoteAdminToEditor = async (
	userPubkey: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<{ adminEventId: string; editorEventId: string }> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise use current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch latest settings using app pubkey
	const adminSettings = await fetchAdminSettings(targetAppPubkey)
	const editorSettings = await fetchEditorSettings(targetAppPubkey)

	if (!adminSettings) {
		throw new Error('No admin list found')
	}

	// Check if user is currently an admin
	if (!adminSettings.admins.includes(userPubkey)) {
		throw new Error('User is not currently an admin')
	}

	// Don't allow demoting the owner
	if (adminSettings.owner === userPubkey) {
		throw new Error('Cannot demote the owner')
	}

	// Don't allow removing the last admin
	if (adminSettings.admins.length === 1) {
		throw new Error('Cannot demote the last admin')
	}

	// Remove from admins list
	const updatedAdmins = adminSettings.admins.filter((pubkey) => pubkey !== userPubkey)

	// Add to editors list (if not already there)
	const currentEditors = editorSettings?.editors || []
	const updatedEditors = currentEditors.includes(userPubkey) ? currentEditors : [...currentEditors, userPubkey]

	// Publish both events
	console.log('Publishing admin list update (demote)...', { updatedAdmins })
	const adminEventId = await publishAdminList({ admins: updatedAdmins }, signer, ndk)
	console.log('Admin list published successfully (demote):', adminEventId)

	console.log('Publishing editor list update (demote)...', { updatedEditors })
	const editorEventId = await publishEditorList({ editors: updatedEditors }, signer, ndk)
	console.log('Editor list published successfully (demote):', editorEventId)

	return { adminEventId, editorEventId }
}

/**
 * Promotes a regular user to editor (pessimistic update)
 */
export const promoteUserToEditor = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise use current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch latest editor settings using app pubkey
	const editorSettings = await fetchEditorSettings(targetAppPubkey)
	const adminSettings = await fetchAdminSettings(targetAppPubkey)

	// Check if user is already an admin or editor
	if (adminSettings?.admins.includes(userPubkey)) {
		throw new Error('User is already an admin')
	}

	const currentEditors = editorSettings?.editors || []
	if (currentEditors.includes(userPubkey)) {
		throw new Error('User is already an editor')
	}

	// Add to editors list
	const updatedEditors = [...currentEditors, userPubkey]

	return publishEditorList({ editors: updatedEditors }, signer, ndk)
}

/**
 * Demotes an editor to regular user (pessimistic update)
 */
export const demoteEditorToUser = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise use current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch latest editor settings using app pubkey
	const editorSettings = await fetchEditorSettings(targetAppPubkey)

	if (!editorSettings) {
		throw new Error('No editor list found')
	}

	// Check if user is currently an editor
	if (!editorSettings.editors.includes(userPubkey)) {
		throw new Error('User is not currently an editor')
	}

	// Remove from editors list
	const updatedEditors = editorSettings.editors.filter((pubkey) => pubkey !== userPubkey)

	return publishEditorList({ editors: updatedEditors }, signer, ndk)
}

/**
 * Removes a user completely from all roles (pessimistic update)
 */
export const removeUserFromAllRoles = async (
	userPubkey: string,
	signer: NDKSigner,
	ndk: NDK,
	appPubkey?: string,
): Promise<{ adminEventId?: string; editorEventId?: string }> => {
	// Get current user's pubkey
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}

	// Use app pubkey if provided, otherwise use current user's pubkey
	const targetAppPubkey = appPubkey || currentUser.pubkey

	// Fetch latest settings using app pubkey
	const adminSettings = await fetchAdminSettings(targetAppPubkey)
	const editorSettings = await fetchEditorSettings(targetAppPubkey)

	const results: { adminEventId?: string; editorEventId?: string } = {}

	// Remove from admin list if present
	if (adminSettings && adminSettings.admins.includes(userPubkey)) {
		// Don't allow removing the owner
		if (adminSettings.owner === userPubkey) {
			throw new Error('Cannot remove the owner')
		}

		// Don't allow removing the last admin
		if (adminSettings.admins.length === 1) {
			throw new Error('Cannot remove the last admin')
		}

		const updatedAdmins = adminSettings.admins.filter((pubkey) => pubkey !== userPubkey)
		results.adminEventId = await publishAdminList({ admins: updatedAdmins }, signer, ndk)
	}

	// Remove from editor list if present
	if (editorSettings && editorSettings.editors.includes(userPubkey)) {
		const updatedEditors = editorSettings.editors.filter((pubkey) => pubkey !== userPubkey)
		results.editorEventId = await publishEditorList({ editors: updatedEditors }, signer, ndk)
	}

	if (!results.adminEventId && !results.editorEventId) {
		throw new Error('User is not in any role lists')
	}

	return results
}

/**
 * Mutation hook for promoting editor to admin
 */
export const usePromoteEditorToAdminMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return promoteEditorToAdmin(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (_, { appPubkey }) => {
			// Invalidate all role-related queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('User promoted to admin successfully')
		},

		onError: (error) => {
			console.error('Failed to promote user to admin:', error)
			toast.error(`Failed to promote user: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for demoting admin to editor
 */
export const useDemoteAdminToEditorMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return demoteAdminToEditor(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (_, { appPubkey }) => {
			// Invalidate all role-related queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('Admin demoted to editor successfully')
		},

		onError: (error) => {
			console.error('Failed to demote admin to editor:', error)
			toast.error(`Failed to demote admin: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for promoting user to editor
 */
export const usePromoteUserToEditorMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return promoteUserToEditor(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (_, { appPubkey }) => {
			// Invalidate all role-related queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('User promoted to editor successfully')
		},

		onError: (error) => {
			console.error('Failed to promote user to editor:', error)
			toast.error(`Failed to promote user: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for demoting editor to user
 */
export const useDemoteEditorToUserMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return demoteEditorToUser(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (_, { appPubkey }) => {
			// Invalidate all role-related queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('Editor demoted to user successfully')
		},

		onError: (error) => {
			console.error('Failed to demote editor to user:', error)
			toast.error(`Failed to demote editor: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Mutation hook for removing user from all roles
 */
export const useRemoveUserFromAllRolesMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async ({ userPubkey, appPubkey }: { userPubkey: string; appPubkey?: string }) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			return removeUserFromAllRoles(userPubkey, signer, ndk, appPubkey)
		},

		onSuccess: async (_, { appPubkey }) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate all role-related queries
			queryClient.invalidateQueries({ queryKey: configKeys.all })
			if (appPubkey) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
			}

			toast.success('User removed from all roles successfully')
		},

		onError: (error) => {
			console.error('Failed to remove user from all roles:', error)
			toast.error(`Failed to remove user: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
