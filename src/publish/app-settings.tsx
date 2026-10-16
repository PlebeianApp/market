import { naddrFromAddress } from '@/lib/nostr/naddr'
import { ndkActions } from '@/lib/stores/ndk'
import { fetchAdminSettings, fetchEditorSettings } from '@/queries/app-settings'
import { configKeys } from '@/queries/queryKeyFactory'
import type { NDKSigner } from '@/lib/nostr/ndk-events'
import {
	CURATION_LISTS,
	planRoleChange,
	publishCurationListWorkflow,
	publishRoleChangeWorkflow,
	readCurationListItems,
	type RoleChange,
	type RoleChangeIssue,
	type RoleListsState,
} from '@sdk/commerce/curation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createAppSettingsPublishContext, curationIssueMessage, resolveListOwner, type NdkClient as NDK } from './curationContext'

export interface AdminListData {
	admins: string[] // Array of admin pubkeys in hex format
}

export interface EditorListData {
	editors: string[] // Array of editor pubkeys in hex format
}

const ROLE_ISSUE_MESSAGES: Record<RoleChangeIssue, string> = {
	'no-admin-list': 'No admin list found',
	'no-editor-list': 'No editor list found',
	'already-admin': 'User is already an admin',
	'already-editor': 'User is already an editor',
	'not-admin': 'User is not an admin',
	'not-editor': 'User is not an editor',
	'last-admin': 'Cannot remove the last admin',
	'owner-protected': 'Cannot remove the owner',
	'no-roles': 'User is not in any role lists',
}

const ROLE_ISSUE_OVERRIDES: Partial<Record<RoleChange, Partial<Record<RoleChangeIssue, string>>>> = {
	promoteEditorToAdmin: { 'not-editor': 'User is not currently an editor' },
	demoteAdminToEditor: {
		'not-admin': 'User is not currently an admin',
		'owner-protected': 'Cannot demote the owner',
		'last-admin': 'Cannot demote the last admin',
	},
	demoteEditorToUser: { 'not-editor': 'User is not currently an editor' },
}

async function publishRoleList(list: 'admins' | 'editors', items: string[], signer: NDKSigner, ndk: NDK): Promise<string> {
	const outcome = await publishCurationListWorkflow(await createAppSettingsPublishContext(ndk, signer), list, items)
	if (!outcome.ok) throw new Error(curationIssueMessage(outcome))
	return outcome.event.id
}

/** Reads one role list by its NIP-33 address; `null` when no list event exists. */
async function fetchRoleList(ndk: NDK, owner: string, list: 'admins' | 'editors'): Promise<string[] | null> {
	const event = await ndk.fetchEvent(naddrFromAddress(CURATION_LISTS[list].kind, owner, CURATION_LISTS[list].dTag))
	return event ? readCurationListItems(list, event.tags) : null
}

async function fetchRoleState(owner: string): Promise<RoleListsState> {
	const adminSettings = await fetchAdminSettings(owner)
	const editorSettings = await fetchEditorSettings(owner)
	return { admins: adminSettings?.admins ?? null, editors: editorSettings?.editors ?? null, owner: adminSettings?.owner }
}

/** Plans the change with the SDK role rules, then publishes the admin list before the editor list. */
async function applyRoleChange(
	change: RoleChange,
	state: RoleListsState,
	userPubkey: string,
	signer: NDKSigner,
	ndk: NDK,
): Promise<{ adminEventId?: string; editorEventId?: string }> {
	const plan = planRoleChange(change, state, userPubkey)
	if (!plan.ok) throw new Error(ROLE_ISSUE_OVERRIDES[change]?.[plan.error] ?? ROLE_ISSUE_MESSAGES[plan.error])

	const outcome = await publishRoleChangeWorkflow(await createAppSettingsPublishContext(ndk, signer), plan.value)
	if (!outcome.ok) throw new Error(curationIssueMessage(outcome))
	return { adminEventId: outcome.adminEvent?.id, editorEventId: outcome.editorEvent?.id }
}

/**
 * Publishes an updated admin list through WebSocket interface
 */
export const publishAdminList = (adminData: AdminListData, signer: NDKSigner, ndk: NDK): Promise<string> =>
	publishRoleList('admins', adminData.admins ?? [], signer, ndk)

/**
 * Adds an admin to the existing admin list
 */
export const addAdmin = async (newAdminPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const owner = await resolveListOwner(signer, appPubkey)
	const state = { admins: await fetchRoleList(ndk, owner, 'admins'), editors: null }
	return (await applyRoleChange('addAdmin', state, newAdminPubkey, signer, ndk)).adminEventId!
}

/**
 * Removes an admin from the existing admin list
 */
export const removeAdmin = async (adminPubkeyToRemove: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const owner = await resolveListOwner(signer, appPubkey)
	const state = { admins: await fetchRoleList(ndk, owner, 'admins'), editors: null }
	return (await applyRoleChange('removeAdmin', state, adminPubkeyToRemove, signer, ndk)).adminEventId!
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
export const publishEditorList = (editorData: EditorListData, signer: NDKSigner, ndk: NDK): Promise<string> =>
	publishRoleList('editors', editorData.editors, signer, ndk)

/**
 * Adds an editor to the existing editor list
 */
export const addEditor = async (newEditorPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const owner = await resolveListOwner(signer, appPubkey)
	const state = { admins: null, editors: await fetchRoleList(ndk, owner, 'editors') }
	return (await applyRoleChange('addEditor', state, newEditorPubkey, signer, ndk)).editorEventId!
}

/**
 * Removes an editor from the existing editor list; the editor list may become empty.
 */
export const removeEditor = async (editorPubkeyToRemove: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const owner = await resolveListOwner(signer, appPubkey)
	const state = { admins: null, editors: await fetchRoleList(ndk, owner, 'editors') }
	return (await applyRoleChange('removeEditor', state, editorPubkeyToRemove, signer, ndk)).editorEventId!
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
	const state = await fetchRoleState(await resolveListOwner(signer, appPubkey))
	const { adminEventId, editorEventId } = await applyRoleChange('promoteEditorToAdmin', state, userPubkey, signer, ndk)
	return { adminEventId: adminEventId!, editorEventId: editorEventId! }
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
	const state = await fetchRoleState(await resolveListOwner(signer, appPubkey))
	const { adminEventId, editorEventId } = await applyRoleChange('demoteAdminToEditor', state, userPubkey, signer, ndk)
	return { adminEventId: adminEventId!, editorEventId: editorEventId! }
}

/**
 * Promotes a regular user to editor (pessimistic update)
 */
export const promoteUserToEditor = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const state = await fetchRoleState(await resolveListOwner(signer, appPubkey))
	return (await applyRoleChange('promoteUserToEditor', state, userPubkey, signer, ndk)).editorEventId!
}

/**
 * Demotes an editor to regular user (pessimistic update)
 */
export const demoteEditorToUser = async (userPubkey: string, signer: NDKSigner, ndk: NDK, appPubkey?: string): Promise<string> => {
	const state = await fetchRoleState(await resolveListOwner(signer, appPubkey))
	return (await applyRoleChange('demoteEditorToUser', state, userPubkey, signer, ndk)).editorEventId!
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
	const state = await fetchRoleState(await resolveListOwner(signer, appPubkey))
	return applyRoleChange('removeFromAllRoles', state, userPubkey, signer, ndk)
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
