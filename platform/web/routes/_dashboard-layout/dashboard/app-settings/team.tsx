import { UserDisplayComponent } from '@/components/UserDisplayComponent'
import { ProfileSearch } from '@/components/v4v/ProfileSearch'
import {
	AddTeamMemberCard,
	RoleActionButtons,
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
	SettingsMobileHeader,
	SettingsPageHeader,
	TeamPermissionsCard,
	TeamRoleSection,
	type RoleAction,
} from '@ui/components/OperatorSettingsViews'
import {
	useAddAdminMutation,
	useAddEditorMutation,
	useDemoteAdminToEditorMutation,
	useDemoteEditorToUserMutation,
	usePromoteEditorToAdminMutation,
	usePromoteUserToEditorMutation,
	useRemoveAdminMutation,
	useRemoveEditorMutation,
	useRemoveUserFromAllRolesMutation,
} from '@/publish/app-settings'
import {
	getFormattedAdmins,
	getFormattedEditors,
	getUserRoleForPubkey,
	useAdminSettings,
	useEditorSettings,
	useUserRole,
} from '@/queries/app-settings'
import { useConfigQuery } from '@/queries/config'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import { npubToHex } from '@platform/web/routes/setup'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Globe, Shield, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/team')({
	component: TeamComponent,
})

function TeamComponent() {
	useDashboardTitle('Team')
	const { data: config } = useConfigQuery()
	const { data: adminSettings, isLoading: isLoadingAdmins } = useAdminSettings(config?.appPublicKey)
	const { data: editorSettings, isLoading: isLoadingEditors } = useEditorSettings(config?.appPublicKey)
	const { amIAdmin, amIOwner, isLoading: isLoadingPermissions } = useUserRole(config?.appPublicKey)

	// All the mutation hooks
	const addAdminMutation = useAddAdminMutation()
	const removeAdminMutation = useRemoveAdminMutation()
	const addEditorMutation = useAddEditorMutation()
	const removeEditorMutation = useRemoveEditorMutation()
	const promoteEditorToAdminMutation = usePromoteEditorToAdminMutation()
	const demoteAdminToEditorMutation = useDemoteAdminToEditorMutation()
	const promoteUserToEditorMutation = usePromoteUserToEditorMutation()
	const demoteEditorToUserMutation = useDemoteEditorToUserMutation()
	const removeUserFromAllRolesMutation = useRemoveUserFromAllRolesMutation()

	const formattedAdmins = getFormattedAdmins(adminSettings)
	const formattedEditors = getFormattedEditors(editorSettings)

	const handleAddAdmin = async (npub: string) => {
		try {
			// Convert npub to hex
			const hexPubkey = npubToHex(npub)
			await addAdminMutation.mutateAsync({
				userPubkey: hexPubkey,
				appPubkey: config?.appPublicKey,
			})
			toast.success('Administrator added successfully')
		} catch (error) {
			console.error('Failed to add admin:', error)
			toast.error(`Failed to add admin: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
	}

	const handleAddEditor = async (npub: string) => {
		try {
			// Convert npub to hex
			const hexPubkey = npubToHex(npub)
			await addEditorMutation.mutateAsync({
				userPubkey: hexPubkey,
				appPubkey: config?.appPublicKey,
			})
			toast.success('Editor added successfully')
		} catch (error) {
			console.error('Failed to add editor:', error)
			toast.error(`Failed to add editor: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
	}

	// Comprehensive role management handlers
	const handlePromoteEditorToAdmin = async (pubkey: string) => {
		try {
			await promoteEditorToAdminMutation.mutateAsync({
				userPubkey: pubkey,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to promote editor to admin:', error)
		}
	}

	const handleDemoteAdminToEditor = async (pubkey: string) => {
		try {
			await demoteAdminToEditorMutation.mutateAsync({
				userPubkey: pubkey,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to demote admin to editor:', error)
		}
	}

	const handlePromoteUserToEditor = async (pubkey: string) => {
		try {
			await promoteUserToEditorMutation.mutateAsync({
				userPubkey: pubkey,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to promote user to editor:', error)
		}
	}

	const handleDemoteEditorToUser = async (pubkey: string) => {
		try {
			await demoteEditorToUserMutation.mutateAsync({
				userPubkey: pubkey,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to demote editor to user:', error)
		}
	}

	const handleRemoveUserFromAllRoles = async (pubkey: string) => {
		try {
			await removeUserFromAllRolesMutation.mutateAsync({
				userPubkey: pubkey,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to remove user from all roles:', error)
		}
	}

	// Helper function to get available actions for a user
	const getAvailableActions = (targetPubkey: string): RoleAction[] => {
		const targetRole = getUserRoleForPubkey(adminSettings, editorSettings, targetPubkey)
		const actions: RoleAction[] = []

		// Promote actions
		if (targetRole === 'editor' && amIOwner) {
			actions.push({
				label: 'Promote to Admin',
				onSelect: () => handlePromoteEditorToAdmin(targetPubkey),
				icon: ArrowUp,
				tone: 'text-green-600',
			})
		}
		if (targetRole === 'user' && amIAdmin) {
			actions.push({
				label: 'Promote to Editor',
				onSelect: () => handlePromoteUserToEditor(targetPubkey),
				icon: ArrowUp,
				tone: 'text-green-600',
			})
		}

		// Demote actions
		if (targetRole === 'admin' && amIOwner && targetPubkey !== adminSettings?.owner) {
			actions.push({
				label: 'Demote to Editor',
				onSelect: () => handleDemoteAdminToEditor(targetPubkey),
				icon: ArrowDown,
				tone: 'text-orange-600',
			})
		}
		if (targetRole === 'editor' && amIAdmin) {
			actions.push({
				label: 'Demote to User',
				onSelect: () => handleDemoteEditorToUser(targetPubkey),
				icon: ArrowDown,
				tone: 'text-orange-600',
			})
		}

		// Remove actions
		if (targetRole !== 'owner' && targetRole !== 'user' && amIAdmin) {
			actions.push({
				label: 'Remove All Roles',
				onSelect: () => handleRemoveUserFromAllRoles(targetPubkey),
				icon: Trash2,
				tone: 'text-red-600',
			})
		}

		return actions
	}

	if (isLoadingAdmins || isLoadingEditors || isLoadingPermissions) {
		return <SettingsLoadingSkeleton />
	}

	if (!amIAdmin) {
		return (
			<SettingsAccessDenied
				header={{ icon: Shield, title: 'Team', description: 'Manage your team settings' }}
				message="You don't have permission to manage team settings."
			/>
		)
	}

	const header = { icon: Globe, title: 'Team', description: 'Manage your team settings' }
	const adminActionsPending =
		removeAdminMutation.isPending ||
		promoteEditorToAdminMutation.isPending ||
		demoteAdminToEditorMutation.isPending ||
		removeUserFromAllRolesMutation.isPending
	const editorActionsPending =
		removeEditorMutation.isPending ||
		promoteEditorToAdminMutation.isPending ||
		demoteEditorToUserMutation.isPending ||
		removeUserFromAllRolesMutation.isPending

	const toMemberRows = (members: { pubkey: string }[], disabled: boolean) =>
		members.map((member, index) => {
			const actions = getAvailableActions(member.pubkey)
			return {
				key: member.pubkey,
				content: (
					<UserDisplayComponent
						userPubkey={member.pubkey}
						index={index}
						customActions={actions.length > 0 ? <RoleActionButtons actions={actions} disabled={disabled} /> : undefined}
					/>
				),
			}
		})

	return (
		<div>
			<SettingsPageHeader {...header} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...header} />
				<TeamRoleSection role="admin" members={toMemberRows(formattedAdmins, adminActionsPending)} />
				<TeamRoleSection role="editor" members={toMemberRows(formattedEditors, editorActionsPending)} />

				{amIOwner && (
					<AddTeamMemberCard
						role="admin"
						search={<ProfileSearch onSelect={handleAddAdmin} placeholder="Search profiles or paste npub..." />}
					/>
				)}

				{amIAdmin && (
					<AddTeamMemberCard
						role="editor"
						search={<ProfileSearch onSelect={handleAddEditor} placeholder="Search profiles or paste npub..." />}
					/>
				)}

				<TeamPermissionsCard isOwner={amIOwner} />
			</div>
		</div>
	)
}
