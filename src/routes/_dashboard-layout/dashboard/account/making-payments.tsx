import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ndkActions } from '@/lib/stores/ndk'
import { uiStore } from '@/lib/stores/ui'
import { parseNwcUri, useWallets, walletActions, type Wallet } from '@/lib/stores/wallet'
import { useNwcWalletBalanceQuery, useUserNwcWalletsQuery, type UserNwcWallet } from '@/queries/wallet'
import { walletKeys } from '@/queries/queryKeyFactory'
import { useSaveUserNwcWalletsMutation } from '@/publish/wallet'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, ChevronLeftIcon, EyeIcon, EyeOffIcon, PlusIcon, RefreshCwIcon, ScanIcon, TrashIcon, WalletIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/making-payments')({
	component: MakingPaymentsComponent,
})

function MakingPaymentsComponent() {
	// Local store state and actions
	const { wallets: localWallets, isLoading: localLoading, isInitialized } = useWallets()
	const queryClient = useQueryClient()
	useDashboardTitle('Making Payments')

	// NDK User for Nostr operations
	const [userPubkey, setUserPubkey] = useState<string | undefined>(undefined)
	const signer = ndkActions.getSigner()

	// TanStack Query for Nostr wallets - moved up to ensure consistent hook calls
	const { data: nostrWallets, isLoading: nostrLoading, refetch: refetchNostrWallets } = useUserNwcWalletsQuery(userPubkey)
	const saveNostrWalletsMutation = useSaveUserNwcWalletsMutation()

	// Form state for adding/editing a new wallet - moved up to ensure consistent hook calls
	const [isAddingWallet, setIsAddingWallet] = useState(false)

	const [editingWallet, setEditingWallet] = useState<Wallet | null>(null)
	const [editWalletName, setEditWalletName] = useState('')
	const [editNwcPubkey, setEditNwcPubkey] = useState('')
	const [editNwcRelays, setEditNwcRelays] = useState('')
	const [editNwcSecret, setEditNwcSecret] = useState('')
	const [showEditSecret, setShowEditSecret] = useState(false)
	const [editStoreOnNostr, setEditStoreOnNostr] = useState(false)
	const [openCollapsibleId, setOpenCollapsibleId] = useState<string | null>(null)
	const [deletingWalletId, setDeletingWalletId] = useState<string | null>(null)

	const combinedWallets = useMemo(() => {
		// This acts as the primary source of wallets for the UI
		return localWallets
	}, [localWallets])

	useEffect(() => {
		const getUserPubkey = async () => {
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					setUserPubkey(user.pubkey)
					// Initialize local store once user is available if not already done
					if (!isInitialized) {
						walletActions.initialize()
					}
				}
			} else if (!isInitialized) {
				// If no signer, still initialize from local storage
				walletActions.initialize()
			}
		}
		getUserPubkey()
	}, [signer, isInitialized])

	// Effect to merge Nostr wallets into local store when fetched/changed
	useEffect(() => {
		if (nostrWallets && userPubkey) {
			walletActions.setNostrWallets(nostrWallets as Wallet[]) // Type assertion if UserNwcWallet is compatible
		}
	}, [nostrWallets, userPubkey])

	useEffect(() => {
		const handleWalletChange = (wallets: Wallet[]) => {
			wallets.forEach((wallet) => {
				if (wallet.nwcUri) {
					queryClient.invalidateQueries({ queryKey: walletKeys.nwcBalance(wallet.nwcUri) })
				}
			})
		}

		walletActions.setOnWalletChange(handleWalletChange)

		// Cleanup
		return () => {
			walletActions.setOnWalletChange(() => {})
		}
	}, [queryClient])

	const handleCancelAdd = () => {
		setIsAddingWallet(false)
	}

	const resetEditForm = () => {
		setEditingWallet(null)
		setEditWalletName('')
		setEditNwcPubkey('')
		setEditNwcRelays('')
		setEditNwcSecret('')
		setShowEditSecret(false)
		setEditStoreOnNostr(false)
	}

	const handleAddWalletClick = () => {
		setIsAddingWallet(true)
	}

	const handleCancelEdit = () => {
		if (editingWallet) {
			setEditWalletName(editingWallet.name)
			const parsedUri = parseNwcUri(editingWallet.nwcUri)
			setEditNwcPubkey(editingWallet.pubkey)
			setEditNwcRelays(editingWallet.relays.join(', '))
			setEditNwcSecret(parsedUri?.secret || '')
			setEditStoreOnNostr(editingWallet.storedOnNostr || false)
			setShowEditSecret(false)
		} else {
			resetEditForm()
		}
	}

	const handleSaveWalletUpdate = async () => {
		if (!editingWallet || !userPubkey) {
			toast.error('Cannot update wallet: Missing context.')
			return
		}

		try {
			// Validations for edit form
			if (!editWalletName.trim()) {
				toast.error('Wallet name cannot be empty')
				return
			}
			if (!editNwcPubkey) {
				toast.error('Wallet pubkey is required')
				return
			}
			if (!editNwcRelays) {
				toast.error('At least one relay is required')
				return
			}

			const finalNwcUri = `nostr+walletconnect://${editNwcPubkey}?relay=${encodeURIComponent(editNwcRelays)}&secret=${editNwcSecret}`

			const walletUpdates: Partial<Omit<Wallet, 'id' | 'createdAt'>> = {
				name: editWalletName,
				nwcUri: finalNwcUri,
				pubkey: editNwcPubkey,
				relays: editNwcRelays.split(',').map((r) => r.trim()),
				storedOnNostr: editStoreOnNostr,
			}

			const updatedWallet = walletActions.updateWallet(editingWallet.id, walletUpdates)

			if (updatedWallet && (updatedWallet.storedOnNostr || editingWallet.storedOnNostr) && userPubkey) {
				const walletsToSaveToNostr = walletActions.getWallets().filter((w) => w.storedOnNostr)
				saveNostrWalletsMutation.mutate({ wallets: walletsToSaveToNostr as UserNwcWallet[], userPubkey })
			} else if (editStoreOnNostr && !userPubkey) {
				toast.warning('Cannot save changes to Nostr: User not logged in. Changes saved locally.')
			}

			toast.success('Wallet updated successfully!')
			resetEditForm()
			setOpenCollapsibleId(null) // Close collapsible after successful save
		} catch (error) {
			console.error('Error updating wallet:', error)
			toast.error('Failed to update wallet')
		}
	}

	const handleDeleteWallet = async (walletId: string) => {
		try {
			const walletToDelete = combinedWallets.find((w) => w.id === walletId)
			if (!walletToDelete) {
				toast.error('Wallet not found')
				return
			}

			setDeletingWalletId(walletId)

			toast.loading('Removing wallet...', { id: `delete-${walletId}` })

			walletActions.removeWallet(walletId)

			if (openCollapsibleId === walletId) {
				setOpenCollapsibleId(null)
				resetEditForm()
				setEditingWallet(null)
			}

			if (walletToDelete.storedOnNostr && userPubkey) {
				const walletsToSaveToNostr = walletActions.getWallets().filter((w) => w.storedOnNostr)
				saveNostrWalletsMutation.mutate(
					{ wallets: walletsToSaveToNostr as UserNwcWallet[], userPubkey },
					{
						onSuccess: () => {
							toast.success('Wallet removed successfully!', { id: `delete-${walletId}` })
							setDeletingWalletId(null)
						},
						onError: (error) => {
							console.error('Error syncing wallet deletion to Nostr:', error)
							toast.error('Wallet removed locally, but failed to sync to Nostr', { id: `delete-${walletId}` })
							setDeletingWalletId(null)
						},
					},
				)
			} else {
				setTimeout(() => {
					toast.success('Wallet removed successfully!', { id: `delete-${walletId}` })
					setDeletingWalletId(null)
				}, 100)
			}
		} catch (error) {
			console.error('Error removing wallet:', error)
			toast.error('Failed to remove wallet', { id: `delete-${walletId}` })
			setDeletingWalletId(null)
		}
	}

	const isLoading = localLoading || (nostrLoading && !isInitialized) || saveNostrWalletsMutation.isPending

	if (isLoading && !isInitialized) {
		// Show initial loading screen
		return (
			<div className="flex items-center justify-center h-64">
				<div className="flex flex-col items-center gap-2">
					<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					<p className="text-muted-foreground">Loading wallets...</p>
				</div>
			</div>
		)
	}

	// Add Wallet View
	if (isAddingWallet) {
		return (
			<AddWalletForm
				onSave={(formData) => {
					// Logic for saving a new wallet
					try {
						if (!formData.nwcPubkey) {
							toast.error('Wallet pubkey is required')
							return
						}
						if (!formData.nwcRelays) {
							toast.error('At least one relay is required')
							return
						}

						let finalNwcUri = formData.nwcUri
						if (!finalNwcUri || !finalNwcUri.startsWith('nostr+walletconnect://')) {
							finalNwcUri = `nostr+walletconnect://${formData.nwcPubkey}?relay=${encodeURIComponent(formData.nwcRelays)}&secret=${formData.nwcSecret}`
						}

						const newWalletData: Omit<Wallet, 'id' | 'createdAt' | 'updatedAt'> = {
							name: `Wallet ${combinedWallets.length + 1}`,
							nwcUri: finalNwcUri,
							pubkey: formData.nwcPubkey,
							relays: formData.nwcRelays.split(',').map((r) => r.trim()),
							storedOnNostr: formData.storeOnNostr,
						}

						const addedWallet = walletActions.addWallet(newWalletData, formData.storeOnNostr)

						if (formData.storeOnNostr && userPubkey) {
							const walletsToSaveToNostr = walletActions.getWallets().filter((w) => w.storedOnNostr || w.id === addedWallet.id)
							saveNostrWalletsMutation.mutate({ wallets: walletsToSaveToNostr as UserNwcWallet[], userPubkey })
						} else if (formData.storeOnNostr && !userPubkey) {
							toast.warning('Cannot save to Nostr: User not logged in. Wallet saved locally.')
						}

						setIsAddingWallet(false)
						toast.success('Wallet added successfully!')
					} catch (error) {
						console.error('Error saving new wallet:', error)
						toast.error('Failed to save new wallet')
					}
				}}
				onCancel={handleCancelAdd}
				userPubkeyPresent={!!userPubkey}
				isSaving={saveNostrWalletsMutation.isPending || localLoading /* consider overall loading state */}
			/>
		)
	}

	// Main View (List Wallets)
	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				{combinedWallets.length > 0 && !isAddingWallet && (
					<Button onClick={handleAddWalletClick} className="hidden sm:flex">
						<PlusIcon className="h-4 w-4 mr-2" /> Add Another Wallet
					</Button>
				)}
			</div>

			{combinedWallets.length === 0 && !isAddingWallet ? (
				<Card>
					<CardContent className="py-10 flex flex-col items-center justify-center">
						<p className="text-center text-muted-foreground mb-4">No wallets configured yet. Add a wallet to make payments.</p>
						<Button onClick={handleAddWalletClick}>
							<PlusIcon className="h-4 w-4 mr-2" /> Add Wallet
						</Button>
					</CardContent>
				</Card>
			) : (
				!isAddingWallet && (
					<>
						{combinedWallets.map((wallet) => (
							<WalletListItemWithBalance
								key={wallet.id}
								wallet={wallet}
								isOpen={openCollapsibleId === wallet.id}
								onToggleOpen={() => {
									const isCurrentlyOpen = openCollapsibleId === wallet.id
									if (isCurrentlyOpen) {
										setOpenCollapsibleId(null)
										resetEditForm() // Clear form when closing
										setEditingWallet(null)
									} else {
										// If another wallet was open and being edited, reset that form first
										if (openCollapsibleId && openCollapsibleId !== wallet.id) {
											resetEditForm()
										}
										setOpenCollapsibleId(wallet.id)
										// Populate form with this wallet's data
										setEditingWallet(wallet)
										setEditWalletName(wallet.name)
										const parsedUri = parseNwcUri(wallet.nwcUri)
										setEditNwcPubkey(wallet.pubkey)
										setEditNwcRelays(wallet.relays.join(', '))
										setEditNwcSecret(parsedUri?.secret || '')
										setEditStoreOnNostr(wallet.storedOnNostr || false)
										setShowEditSecret(false) // Reset visibility of secret
									}
								}}
								onCancelEdit={handleCancelEdit}
								onSaveEdit={handleSaveWalletUpdate}
								onDeleteWallet={() => handleDeleteWallet(wallet.id)}
								editWalletName={editWalletName}
								setEditWalletName={setEditWalletName}
								editNwcPubkey={editNwcPubkey}
								setEditNwcPubkey={setEditNwcPubkey}
								editNwcRelays={editNwcRelays}
								setEditNwcRelays={setEditNwcRelays}
								editNwcSecret={editNwcSecret}
								setEditNwcSecret={setEditNwcSecret}
								showEditSecret={showEditSecret}
								setShowEditSecret={setShowEditSecret}
								editStoreOnNostr={editStoreOnNostr}
								setEditStoreOnNostr={setEditStoreOnNostr}
								isSavingNostr={saveNostrWalletsMutation.isPending}
								userPubkeyPresent={!!userPubkey}
								isWalletSyncing={saveNostrWalletsMutation.isPending && localWallets.find((lw) => lw.id === wallet.id)?.storedOnNostr}
								isDeleting={deletingWalletId === wallet.id}
							/>
						))}

						{combinedWallets.length > 0 && (
							<Button onClick={handleAddWalletClick} className="w-full mt-4 sm:hidden">
								<PlusIcon className="h-4 w-4 mr-2" /> Add Another Wallet
							</Button>
						)}
					</>
				)
			)}
		</div>
	)
}

// Wrapper component that handles the balance query to avoid hook rule violations
function WalletListItemWithBalance(props: Omit<WalletListItemProps, 'balanceQuery'>) {
	const balanceQuery = useNwcWalletBalanceQuery(
		props.wallet.nwcUri,
		!!props.wallet.nwcUri, // Always enable if nwcUri is present
	)

	return <WalletListItem {...props} balanceQuery={balanceQuery} />
}

interface WalletListItemProps {
	wallet: Wallet
	balanceQuery: ReturnType<typeof useNwcWalletBalanceQuery>
	isOpen: boolean
	onToggleOpen: () => void
	onCancelEdit: () => void
	onSaveEdit: () => void
	onDeleteWallet: () => void
	editWalletName: string
	setEditWalletName: Dispatch<SetStateAction<string>>
	editNwcPubkey: string
	setEditNwcPubkey: Dispatch<SetStateAction<string>>
	editNwcRelays: string
	setEditNwcRelays: Dispatch<SetStateAction<string>>
	editNwcSecret: string
	setEditNwcSecret: Dispatch<SetStateAction<string>>
	showEditSecret: boolean
	setShowEditSecret: Dispatch<SetStateAction<boolean>>
	editStoreOnNostr: boolean
	setEditStoreOnNostr: Dispatch<SetStateAction<boolean>>
	isSavingNostr: boolean
	userPubkeyPresent: boolean
	isWalletSyncing?: boolean // Make optional as it might not always be calculable if localWallets is out of scope
	isDeleting?: boolean // Whether this wallet is currently being deleted
}

function WalletListItem({
	wallet,
	balanceQuery,
	isOpen,
	onToggleOpen,
	onCancelEdit,
	onSaveEdit,
	onDeleteWallet,
	editWalletName,
	setEditWalletName,
	editNwcPubkey,
	setEditNwcPubkey,
	editNwcRelays,
	setEditNwcRelays,
	editNwcSecret,
	setEditNwcSecret,
	showEditSecret,
	setShowEditSecret,
	editStoreOnNostr,
	setEditStoreOnNostr,
	isSavingNostr,
	userPubkeyPresent,
	isWalletSyncing,
	isDeleting,
}: WalletListItemProps) {
	return (
		<Collapsible open={isOpen} onOpenChange={onToggleOpen} className="space-y-2">
			<Card className={isDeleting ? 'opacity-50 pointer-events-none' : ''}>
				<CollapsibleTrigger asChild>
					<CardHeader className="pb-2 flex flex-row items-center justify-between cursor-pointer group">
						<div className="flex items-center gap-3">
							<WalletIcon className="h-6 w-6 text-muted-foreground" />
							<div>
								<CardTitle>{wallet.name}</CardTitle>
								<CardDescription className="text-xs">
									{isDeleting ? 'Removing...' : wallet.storedOnNostr ? 'Stored on Nostr (encrypted)' : 'Stored locally'}
									{isWalletSyncing && !isDeleting && ' (Syncing...)'}
								</CardDescription>
								{/* Compact Balance Display in Trigger */}
								<div className="text-xs mt-0.5">
									{balanceQuery.isLoading && <span className="text-muted-foreground">Balance: Loading...</span>}
									{balanceQuery.isError && <span className="text-red-500">Balance: Error</span>}
									{balanceQuery.data && (
										<span className="text-primary font-medium">Balance: {balanceQuery.data.balance.toLocaleString()} sats</span>
									)}
								</div>
							</div>
						</div>
						<div className="flex items-center">
							<Button
								variant="ghost"
								size="icon"
								onClick={(e) => {
									e.stopPropagation() // Prevent collapsible trigger
									onDeleteWallet()
								}}
								className="h-8 w-8 text-destructive hover:bg-destructive/10"
								aria-label="Delete wallet"
								disabled={isSavingNostr || isDeleting}
							>
								{isDeleting ? (
									<div className="animate-spin h-4 w-4 border-2 border-destructive border-t-transparent rounded-full" />
								) : (
									<TrashIcon className="h-4 w-4" />
								)}
							</Button>
							<ChevronLeftIcon className="h-4 w-4 ml-1 shrink-0 transition-transform duration-200 group-data-[state=open]:-rotate-90" />
						</div>
					</CardHeader>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent className="pt-2 pb-4 space-y-4">
						{/* Always show edit form when open */}
						<div className="space-y-4">
							<div>
								<Label htmlFor={`wallet-name-${wallet.id}`}>Wallet Name</Label>
								<Input
									id={`wallet-name-${wallet.id}`}
									placeholder="e.g. My Main Wallet"
									value={editWalletName}
									onChange={(e) => setEditWalletName(e.target.value)}
								/>
							</div>
							<div>
								<Label htmlFor={`wallet-pubkey-edit-${wallet.id}`}>Wallet Connect Pubkey</Label>
								<Input
									id={`wallet-pubkey-edit-${wallet.id}`}
									placeholder="e.g 60b37aeb4c521316374bab549c074abc..."
									value={editNwcPubkey}
									onChange={(e) => setEditNwcPubkey(e.target.value)}
								/>
							</div>

							<div>
								<Label htmlFor={`wallet-relays-edit-${wallet.id}`}>Wallet Connect Relays</Label>
								<Input
									id={`wallet-relays-edit-${wallet.id}`}
									placeholder="e.g wss://relay.nostr.band, wss://another.relay"
									value={editNwcRelays}
									onChange={(e) => setEditNwcRelays(e.target.value)}
								/>
							</div>

							<div>
								<Label htmlFor={`wallet-secret-edit-${wallet.id}`}>Wallet Connect Secret</Label>
								<div className="flex">
									<Input
										id={`wallet-secret-edit-${wallet.id}`}
										type={showEditSecret ? 'text' : 'password'}
										placeholder="Secret"
										value={editNwcSecret}
										onChange={(e) => setEditNwcSecret(e.target.value)}
										className="flex-1"
									/>
									<Button variant="outline" size="icon" onClick={() => setShowEditSecret(!showEditSecret)} className="ml-2">
										{showEditSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
									</Button>
								</div>
							</div>

							{userPubkeyPresent && (
								<div className="flex items-center space-x-2 pt-2">
									<Checkbox
										id={`store-wallet-edit-${wallet.id}`}
										checked={editStoreOnNostr}
										onCheckedChange={(checked) => setEditStoreOnNostr(checked === true)}
									/>
									<Label htmlFor={`store-wallet-edit-${wallet.id}`}>Store on Nostr (encrypted)</Label>
								</div>
							)}
							<div className="flex justify-end space-x-2 pt-2">
								<Button variant="outline" onClick={onCancelEdit} disabled={isSavingNostr}>
									Cancel
								</Button>
								<Button onClick={onSaveEdit} disabled={isSavingNostr}>
									{isSavingNostr ? 'Saving...' : 'Save Changes'}
								</Button>
							</div>
						</div>
						{/* Balance Details Section - remains for displaying fetched balance info */}
						<hr className="my-3" />
						<div>
							<p className="font-medium mb-1">Balance Details:</p>
							{balanceQuery.isLoading && <p className="text-muted-foreground">Loading balance...</p>}
							{balanceQuery.isError && (
								<div className="text-red-500">
									<p>Error fetching balance: {balanceQuery.error?.message || 'Unknown error'}</p>
									<Button
										variant="link"
										size="sm"
										onClick={() => balanceQuery.refetch()}
										className="p-0 h-auto text-red-500 hover:text-red-600"
									>
										Try again
									</Button>
								</div>
							)}
							{balanceQuery.data && (
								<div>
									<p className="text-lg font-semibold">{balanceQuery.data.balance.toLocaleString()} sats</p>
									<p className="text-xs text-muted-foreground">Last updated: {new Date(balanceQuery.data.timestamp).toLocaleString()}</p>
								</div>
							)}
							{isOpen &&
								!balanceQuery.isLoading && ( // Show refresh only if open and not already loading
									<Button variant="outline" size="sm" onClick={() => balanceQuery.refetch()} className="mt-2" aria-label="Refresh balance">
										<RefreshCwIcon className="h-3 w-3 mr-1.5" />
										Refresh
									</Button>
								)}
						</div>
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>
	)
}

interface AddWalletFormData {
	nwcUri: string
	nwcPubkey: string
	nwcRelays: string
	nwcSecret: string
	storeOnNostr: boolean
}

interface AddWalletFormProps {
	onSave: (formData: AddWalletFormData) => void
	onCancel: () => void
	userPubkeyPresent: boolean
	isSaving: boolean
}

function AddWalletForm({ onSave, onCancel, userPubkeyPresent, isSaving }: AddWalletFormProps) {
	const [nwcUri, setNwcUri] = useState('')
	const [nwcPubkeyInput, setNwcPubkeyInput] = useState('')
	const [nwcRelaysInput, setNwcRelaysInput] = useState('')
	const [nwcSecretInput, setNwcSecretInput] = useState('')
	const [showSecret, setShowSecret] = useState(false)
	const [storeOnNostr, setStoreOnNostr] = useState(false)

	const handleNwcUriChange = (uri: string) => {
		setNwcUri(uri)
		const parsed = parseNwcUri(uri)
		if (parsed) {
			setNwcPubkeyInput(parsed.pubkey)
			setNwcRelaysInput(parsed.relay)
			setNwcSecretInput(parsed.secret)
		}
	}

	const handlePaste = async () => {
		try {
			const text = await navigator.clipboard.readText()
			handleNwcUriChange(text)
		} catch (e) {
			console.error('Failed to read clipboard:', e)
			toast.error('Could not access clipboard')
		}
	}

	const handleScan = () => {
		uiStore.setState((state) => ({
			...state,
			dialogs: { ...state.dialogs, 'scan-qr': true },
			dialogCallbacks: {
				...state.dialogCallbacks,
				'scan-qr': (scannedUri: string) => {
					handleNwcUriChange(scannedUri)
					// setIsAddingWallet(true) // This component is already the "add wallet" view
					toast.success('QR code scanned successfully')
				},
			},
			activeElement: 'dialog-scan-qr',
		}))
	}

	const handleSubmit = () => {
		onSave({
			nwcUri,
			nwcPubkey: nwcPubkeyInput,
			nwcRelays: nwcRelaysInput,
			nwcSecret: nwcSecretInput,
			storeOnNostr,
		})
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center space-x-2">
				<Button variant="ghost" size="icon" onClick={onCancel} aria-label="Back">
					<ArrowLeftIcon className="h-4 w-4" />
				</Button>
				<h1 className="text-2xl font-bold">Add Wallet</h1>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Add Nostr Wallet Connect</CardTitle>
					<CardDescription>Paste your Nostr Wallet Connect URI or scan a QR code to connect your wallet.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex space-x-2">
						<Button onClick={handlePaste} className="flex-1 bg-yellow-500 hover:bg-yellow-600">
							Paste
						</Button>
						<Button onClick={handleScan} className="flex-1">
							<ScanIcon className="h-4 w-4 mr-2" /> Scan
						</Button>
					</div>

					<div className="space-y-4 mt-4">
						<div>
							<Label htmlFor="wallet-pubkey-add">Wallet Connect Pubkey</Label>
							<Input
								id="wallet-pubkey-add"
								placeholder="e.g 60b37aeb4c521316374bab549c074abc..."
								value={nwcPubkeyInput}
								onChange={(e) => setNwcPubkeyInput(e.target.value)}
							/>
						</div>

						<div>
							<Label htmlFor="wallet-relays-add">Wallet Connect Relays</Label>
							<Input
								id="wallet-relays-add"
								placeholder="e.g wss://relay.nostr.band"
								value={nwcRelaysInput}
								onChange={(e) => setNwcRelaysInput(e.target.value)}
							/>
						</div>

						<div>
							<Label htmlFor="wallet-secret-add">Wallet Connect Secret</Label>
							<div className="flex">
								<Input
									id="wallet-secret-add"
									type={showSecret ? 'text' : 'password'}
									placeholder="Secret"
									value={nwcSecretInput}
									onChange={(e) => setNwcSecretInput(e.target.value)}
									className="flex-1"
								/>
								<Button variant="outline" size="icon" onClick={() => setShowSecret(!showSecret)} className="ml-2">
									{showSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
								</Button>
							</div>
						</div>

						{userPubkeyPresent && (
							<div className="flex items-center space-x-2">
								<Checkbox id="store-wallet-add" checked={storeOnNostr} onCheckedChange={(checked) => setStoreOnNostr(checked === true)} />
								<Label htmlFor="store-wallet-add">Store wallet on Nostr (encrypted)</Label>
							</div>
						)}
					</div>
				</CardContent>
				<CardFooter className="flex justify-between">
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={isSaving}>
						{isSaving ? 'Saving...' : 'Save Wallet'}
					</Button>
				</CardFooter>
			</Card>
		</div>
	)
}
