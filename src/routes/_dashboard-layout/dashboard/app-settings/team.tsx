import { UserDisplayComponent } from '@/components/UserDisplayComponent'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { npubToHex } from '@/routes/setup'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Edit, Globe, Shield, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
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
	const [newAdminInput, setNewAdminInput] = useState('')
	const [newEditorInput, setNewEditorInput] = useState('')
	const [isAddingAdmin, setIsAddingAdmin] = useState(false)
	const [isAddingEditor, setIsAddingEditor] = useState(false)

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

	const handleAddAdmin = async () => {
		if (!newAdminInput.trim()) {
			toast.error('Please enter a valid npub or pubkey')
			return
		}

		try {
			setIsAddingAdmin(true)
			// Convert npub to hex if needed
			const hexPubkey = npubToHex(newAdminInput.trim())
			await addAdminMutation.mutateAsync({
				userPubkey: hexPubkey,
				appPubkey: config?.appPublicKey,
			})
			setNewAdminInput('')
		} catch (error) {
			console.error('Failed to add admin:', error)
			toast.error(`Failed to add admin: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsAddingAdmin(false)
		}
	}

	const handleAddEditor = async () => {
		if (!newEditorInput.trim()) {
			toast.error('Please enter a valid npub or pubkey')
			return
		}

		try {
			setIsAddingEditor(true)
			// Convert npub to hex if needed
			const hexPubkey = npubToHex(newEditorInput.trim())
			await addEditorMutation.mutateAsync({
				userPubkey: hexPubkey,
				appPubkey: config?.appPublicKey,
			})
			setNewEditorInput('')
		} catch (error) {
			console.error('Failed to add editor:', error)
			toast.error(`Failed to add editor: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsAddingEditor(false)
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
	const getAvailableActions = (targetPubkey: string) => {
		const targetRole = getUserRoleForPubkey(adminSettings, editorSettings, targetPubkey)
		const actions = []

		// Promote actions
		if (targetRole === 'editor' && amIOwner) {
			actions.push({
				type: 'promote',
				label: 'Promote to Admin',
				handler: () => handlePromoteEditorToAdmin(targetPubkey),
				icon: ArrowUp,
				color: 'text-green-600',
			})
		}
		if (targetRole === 'user' && amIAdmin) {
			actions.push({
				type: 'promote',
				label: 'Promote to Editor',
				handler: () => handlePromoteUserToEditor(targetPubkey),
				icon: ArrowUp,
				color: 'text-green-600',
			})
		}

		// Demote actions
		if (targetRole === 'admin' && amIOwner && targetPubkey !== adminSettings?.owner) {
			actions.push({
				type: 'demote',
				label: 'Demote to Editor',
				handler: () => handleDemoteAdminToEditor(targetPubkey),
				icon: ArrowDown,
				color: 'text-orange-600',
			})
		}
		if (targetRole === 'editor' && amIAdmin) {
			actions.push({
				type: 'demote',
				label: 'Demote to User',
				handler: () => handleDemoteEditorToUser(targetPubkey),
				icon: ArrowDown,
				color: 'text-orange-600',
			})
		}

		// Remove actions
		if (targetRole !== 'owner' && targetRole !== 'user' && amIAdmin) {
			actions.push({
				type: 'remove',
				label: 'Remove All Roles',
				handler: () => handleRemoveUserFromAllRoles(targetPubkey),
				icon: Trash2,
				color: 'text-red-600',
			})
		}

		return actions
	}

	if (isLoadingAdmins || isLoadingEditors || isLoadingPermissions) {
		return (
			<div className="space-y-6 p-6">
				<div className="animate-pulse">
					<div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
					<div className="space-y-3">
						<div className="h-4 bg-gray-200 rounded w-1/2"></div>
						<div className="h-4 bg-gray-200 rounded w-1/3"></div>
					</div>
				</div>
			</div>
		)
	}

	if (!amIAdmin) {
		return (
			<div className="space-y-6 p-6">
				<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
					<div className="flex items-center gap-3">
						<Shield className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Team</h1>
							<p className="text-muted-foreground text-sm">Manage your team settings</p>
						</div>
					</div>
				</div>

				<Card>
					<CardContent className="p-6">
						<div className="text-center">
							<Shield className="w-16 h-16 mx-auto text-gray-400 mb-4" />
							<h3 className="text-lg font-medium mb-2">Access Denied</h3>
							<p className="text-gray-600">You don't have permission to manage team settings.</p>
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<div className="flex items-center gap-3">
					<Globe className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Team</h1>
						<p className="text-muted-foreground text-sm">Manage your team settings</p>
					</div>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-8">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<Globe className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Team</h1>
							<p className="text-muted-foreground text-sm">Manage your team settings</p>
						</div>
					</div>
				</div>
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ShieldCheck className="w-5 h-5" />
							Administrators
						</CardTitle>
						<CardDescription>Users with administrative privileges can manage the marketplace, products, and settings.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{formattedAdmins.length === 0 ? (
							<div className="text-center py-8 text-gray-500">
								<Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
								<p>No administrators found</p>
							</div>
						) : (
							<div className="space-y-3">
								{formattedAdmins.map((admin, index) => {
									const actions = getAvailableActions(admin.pubkey)
									return (
										<UserDisplayComponent
											key={admin.pubkey}
											userPubkey={admin.pubkey}
											index={index}
											customActions={
												actions.length > 0 ? (
													<>
														{actions.map((action, actionIndex) => {
															const Icon = action.icon
															return (
																<Button
																	key={actionIndex}
																	variant="outline"
																	size="sm"
																	onClick={action.handler}
																	disabled={
																		removeAdminMutation.isPending ||
																		promoteEditorToAdminMutation.isPending ||
																		demoteAdminToEditorMutation.isPending ||
																		removeUserFromAllRolesMutation.isPending
																	}
																	title={action.label}
																	className="h-8 w-8 p-0"
																>
																	<Icon className={`w-4 h-4 ${action.color}`} />
																</Button>
															)
														})}
													</>
												) : undefined
											}
										/>
									)
								})}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Editors Section */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Edit className="w-5 h-5" />
							Editors
						</CardTitle>
						<CardDescription>Users with editor privileges can manage content but have limited administrative access.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{formattedEditors.length === 0 ? (
							<div className="text-center py-8 text-gray-500">
								<Edit className="w-12 h-12 mx-auto mb-3 text-gray-300" />
								<p>No editors found</p>
							</div>
						) : (
							<div className="space-y-3">
								{formattedEditors.map((editor, index) => {
									const actions = getAvailableActions(editor.pubkey)
									return (
										<UserDisplayComponent
											key={editor.pubkey}
											userPubkey={editor.pubkey}
											index={index}
											customActions={
												actions.length > 0 ? (
													<>
														{actions.map((action, actionIndex) => {
															const Icon = action.icon
															return (
																<Button
																	key={actionIndex}
																	variant="outline"
																	size="sm"
																	onClick={action.handler}
																	disabled={
																		removeEditorMutation.isPending ||
																		promoteEditorToAdminMutation.isPending ||
																		demoteEditorToUserMutation.isPending ||
																		removeUserFromAllRolesMutation.isPending
																	}
																	title={action.label}
																	className="h-8 w-8 p-0"
																>
																	<Icon className={`w-4 h-4 ${action.color}`} />
																</Button>
															)
														})}
													</>
												) : undefined
											}
										/>
									)
								})}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Add New Admin */}
				{amIOwner && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<UserPlus className="w-5 h-5" />
								Add Administrator
							</CardTitle>
							<CardDescription>Add a new administrator by entering their npub or public key.</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="newAdmin">Npub or Public Key</Label>
								<div className="flex gap-2">
									<Input
										id="newAdmin"
										value={newAdminInput}
										onChange={(e) => setNewAdminInput(e.target.value)}
										placeholder="npub1... or hex pubkey"
										className="flex-1"
									/>
									<Button onClick={handleAddAdmin} disabled={isAddingAdmin || addAdminMutation.isPending || !newAdminInput.trim()}>
										{isAddingAdmin || addAdminMutation.isPending ? (
											<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
										) : (
											<UserPlus className="w-4 h-4" />
										)}
										Add
									</Button>
								</div>
							</div>
							<div className="text-xs text-gray-500">
								Note: New administrators will have full access to manage the marketplace settings and content.
							</div>
						</CardContent>
					</Card>
				)}

				{/* Add New Editor */}
				{amIAdmin && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<UserPlus className="w-5 h-5" />
								Add Editor
							</CardTitle>
							<CardDescription>Add a new editor by entering their npub or public key.</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="newEditor">Npub or Public Key</Label>
								<div className="flex gap-2">
									<Input
										id="newEditor"
										value={newEditorInput}
										onChange={(e) => setNewEditorInput(e.target.value)}
										placeholder="npub1... or hex pubkey"
										className="flex-1"
									/>
									<Button onClick={handleAddEditor} disabled={isAddingEditor || addEditorMutation.isPending || !newEditorInput.trim()}>
										{isAddingEditor || addEditorMutation.isPending ? (
											<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
										) : (
											<UserPlus className="w-4 h-4" />
										)}
										Add
									</Button>
								</div>
							</div>
							<div className="text-xs text-gray-500">
								Note: New editors will have limited access to manage content but cannot modify administrative settings.
							</div>
						</CardContent>
					</Card>
				)}

				{/* Permissions Info */}
				<Card>
					<CardHeader>
						<CardTitle>Your Permissions</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex items-center gap-3">
							{amIOwner ? <ShieldCheck className="w-5 h-5 text-green-600" /> : <Shield className="w-5 h-5 text-blue-600" />}
							<div>
								<div className="font-medium">{amIOwner ? 'Owner' : 'Administrator'}</div>
								<div className="text-sm text-gray-600">
									{amIOwner
										? 'You have full control over the marketplace and can manage all administrators.'
										: 'You can manage marketplace settings and content but cannot add/remove administrators.'}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
