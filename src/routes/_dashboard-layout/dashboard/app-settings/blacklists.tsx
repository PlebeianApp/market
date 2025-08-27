import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAddToBlacklistMutation, useRemoveFromBlacklistMutation } from '@/publish/blacklist'
import { getFormattedBlacklist, useBlacklistSettings } from '@/queries/blacklist'
import { useConfigQuery } from '@/queries/config'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { formatPubkeyForDisplay, npubToHex } from '@/routes/setup'
import { createFileRoute } from '@tanstack/react-router'
import { Shield, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useUserRole } from '@/queries/app-settings'

export const Route = createFileRoute('/_dashboard-layout/dashboard/app-settings/blacklists')({
	component: BlacklistsComponent,
})

function BlacklistsComponent() {
	useDashboardTitle('Blacklists')
	const { data: config } = useConfigQuery()
	const { data: blacklistSettings, isLoading: isLoadingBlacklist } = useBlacklistSettings(config?.appPublicKey)
	const { amIAdmin, amIEditor, isLoading: isLoadingPermissions } = useUserRole(config?.appPublicKey)
	const [newUserInput, setNewUserInput] = useState('')
	const [isAddingUser, setIsAddingUser] = useState(false)

	// Mutation hooks
	const addToBlacklistMutation = useAddToBlacklistMutation()
	const removeFromBlacklistMutation = useRemoveFromBlacklistMutation()

	const formattedBlacklist = getFormattedBlacklist(blacklistSettings)

	const handleAddUser = async () => {
		if (!newUserInput.trim()) {
			toast.error('Please enter a valid npub or pubkey')
			return
		}

		try {
			setIsAddingUser(true)
			// Convert npub to hex if needed
			const hexPubkey = npubToHex(newUserInput.trim())
			await addToBlacklistMutation.mutateAsync({
				userPubkey: hexPubkey,
				appPubkey: config?.appPublicKey,
			})
			setNewUserInput('')
		} catch (error) {
			console.error('Failed to add user to blacklist:', error)
			toast.error(`Failed to add user to blacklist: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setIsAddingUser(false)
		}
	}

	const handleRemoveUser = async (pubkey: string) => {
		try {
			await removeFromBlacklistMutation.mutateAsync({
				userPubkey: pubkey,
				appPubkey: config?.appPublicKey,
			})
		} catch (error) {
			console.error('Failed to remove user from blacklist:', error)
		}
	}

	if (isLoadingBlacklist || isLoadingPermissions) {
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

	if (!amIAdmin && !amIEditor) {
		return (
			<div className="space-y-6 p-6">
				<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
					<div className="flex items-center gap-3">
						<Shield className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Blacklists</h1>
							<p className="text-muted-foreground text-sm">Manage user blacklists</p>
						</div>
					</div>
				</div>

				<Card>
					<CardContent className="p-6">
						<div className="text-center">
							<Shield className="w-16 h-16 mx-auto text-gray-400 mb-4" />
							<h3 className="text-lg font-medium mb-2">Access Denied</h3>
							<p className="text-gray-600">You don't have permission to manage blacklists.</p>
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
					<UserMinus className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Blacklists</h1>
						<p className="text-muted-foreground text-sm">Manage user blacklists</p>
					</div>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-8">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<UserMinus className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">Blacklists</h1>
							<p className="text-muted-foreground text-sm">Manage user blacklists</p>
						</div>
					</div>
				</div>

				{/* Blacklisted Users Section */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<UserMinus className="w-5 h-5" />
							Blacklisted Users
						</CardTitle>
						<CardDescription>Users that are banned from accessing the marketplace.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{formattedBlacklist.length === 0 ? (
							<div className="text-center py-8 text-gray-500">
								<UserMinus className="w-12 h-12 mx-auto mb-3 text-gray-300" />
								<p>No users are currently blacklisted</p>
							</div>
						) : (
							<div className="space-y-3">
								{formattedBlacklist.map((user) => (
									<div key={user.pubkey} className="flex items-center justify-between p-3 border rounded-lg">
										<div className="flex items-center gap-3">
											<UserMinus className="w-5 h-5 text-red-600" />
											<div>
												<div className="font-mono text-sm">{formatPubkeyForDisplay(user.pubkey)}</div>
												<div className="text-xs text-red-600 font-medium">Blacklisted</div>
											</div>
										</div>
										<Button
											variant="outline"
											size="sm"
											onClick={() => handleRemoveUser(user.pubkey)}
											disabled={removeFromBlacklistMutation.isPending}
											title="Remove from blacklist"
										>
											<Trash2 className="w-4 h-4 text-red-600" />
										</Button>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Add User to Blacklist */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<UserPlus className="w-5 h-5" />
							Add User to Blacklist
						</CardTitle>
						<CardDescription>Blacklist a user by entering their npub or public key.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="newUser">Npub or Public Key</Label>
							<div className="flex gap-2">
								<Input
									id="newUser"
									value={newUserInput}
									onChange={(e) => setNewUserInput(e.target.value)}
									placeholder="npub1... or hex pubkey"
									className="flex-1"
								/>
								<Button onClick={handleAddUser} disabled={isAddingUser || addToBlacklistMutation.isPending || !newUserInput.trim()}>
									{isAddingUser || addToBlacklistMutation.isPending ? (
										<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
									) : (
										<UserMinus className="w-4 h-4" />
									)}
									Add
								</Button>
							</div>
						</div>
						<div className="text-xs text-gray-500">
							Note: Blacklisted users will be prevented from accessing the marketplace and their content may be hidden.
						</div>
					</CardContent>
				</Card>

				{/* Permissions Info */}
				<Card>
					<CardHeader>
						<CardTitle>Your Permissions</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex items-center gap-3">
							{amIAdmin ? <Shield className="w-5 h-5 text-blue-600" /> : <UserMinus className="w-5 h-5 text-purple-600" />}
							<div>
								<div className="font-medium">{amIAdmin ? 'Administrator' : 'Editor'}</div>
								<div className="text-sm text-gray-600">
									{amIAdmin
										? 'You have full control over the marketplace and can manage blacklists.'
										: 'You can manage blacklists but have limited administrative access.'}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
