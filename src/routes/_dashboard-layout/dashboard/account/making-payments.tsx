import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ndkActions } from '@/lib/stores/ndk'
import { uiStore } from '@/lib/stores/ui'
import { parseNwcUri, useWallets, type Wallet } from '@/lib/stores/wallet'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon, ChevronDownIcon, EditIcon, EyeIcon, EyeOffIcon, PlusIcon, ScanIcon, TrashIcon, WalletIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/making-payments')({
	component: MakingPaymentsComponent,
})

function MakingPaymentsComponent() {
	// Use the wallet store instead of local state
	const { wallets, addWallet, removeWallet, updateWallet, isLoading, isInitialized } = useWallets()

	// Form state for adding a new wallet
	const [isAddingWallet, setIsAddingWallet] = useState(false)
	const [nwcUri, setNwcUri] = useState('')
	const [nwcPubkey, setNwcPubkey] = useState('')
	const [nwcRelays, setNwcRelays] = useState('')
	const [nwcSecret, setNwcSecret] = useState('')
	const [showSecret, setShowSecret] = useState(false)
	const [storeOnNostr, setStoreOnNostr] = useState(false)
	const [editingWallet, setEditingWallet] = useState<Wallet | null>(null)
	const [editWalletName, setEditWalletName] = useState('')
	const [editNwcPubkey, setEditNwcPubkey] = useState('')
	const [editNwcRelays, setEditNwcRelays] = useState('')
	const [editNwcSecret, setEditNwcSecret] = useState('')
	const [showEditSecret, setShowEditSecret] = useState(false)
	const [editStoreOnNostr, setEditStoreOnNostr] = useState(false)
	const [openCollapsibleId, setOpenCollapsibleId] = useState<string | null>(null)

	// Get current user's pubkey (to check if Nostr storage is available)
	const [userPubkey, setUserPubkey] = useState<string | null>(null)
	const signer = ndkActions.getSigner()

	useEffect(() => {
		const getUser = async () => {
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					setUserPubkey(user.pubkey)
				}
			}
		}

		getUser()
	}, [signer])

	const handleCancelAdd = () => {
		setIsAddingWallet(false)
		resetForm()
	}

	const resetForm = () => {
		setNwcUri('')
		setNwcPubkey('')
		setNwcRelays('')
		setNwcSecret('')
		setShowSecret(false)
		setStoreOnNostr(false)
	}

	const handleAddWallet = () => {
		setIsAddingWallet(true)
		resetForm()
	}

	const handleNwcUriChange = (uri: string) => {
		setNwcUri(uri)
		const parsed = parseNwcUri(uri)
		if (parsed) {
			setNwcPubkey(parsed.pubkey)
			setNwcRelays(parsed.relay)
			setNwcSecret(parsed.secret)
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
		// Open the QR scanner dialog with a callback
		uiStore.setState((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				'scan-qr': true,
			},
			dialogCallbacks: {
				...state.dialogCallbacks,
				'scan-qr': (scannedUri: string) => {
					handleNwcUriChange(scannedUri)
					setIsAddingWallet(true)
					toast.success('QR code scanned successfully')
				},
			},
			activeElement: 'dialog-scan-qr',
		}))
	}

	const saveWallet = async () => {
		try {
			// Validate inputs
			if (!nwcPubkey) {
				toast.error('Wallet pubkey is required')
				return
			}

			if (!nwcRelays) {
				toast.error('At least one relay is required')
				return
			}

			// Check if we're logged in (required for Nostr storage)
			if (storeOnNostr && !userPubkey) {
				toast.warning('You need to be logged in to store wallets on Nostr. Wallet will be saved locally only.')
				setStoreOnNostr(false)
			}

			// Create full NWC URI if we only have components
			let finalNwcUri = nwcUri
			if (!finalNwcUri || !finalNwcUri.startsWith('nostr+walletconnect://')) {
				finalNwcUri = `nostr+walletconnect://${nwcPubkey}?relay=${encodeURIComponent(nwcRelays)}&secret=${nwcSecret}`
			}

			// Create the wallet object
			const newWallet: Omit<Wallet, 'id' | 'createdAt' | 'updatedAt'> = {
				name: `Wallet ${wallets.length + 1}`,
				nwcUri: finalNwcUri,
				pubkey: nwcPubkey,
				relays: nwcRelays.split(',').map((r) => r.trim()),
			}

			// Add the wallet using the store
			await addWallet(newWallet, storeOnNostr)

			// Reset form and close
			setIsAddingWallet(false)
			resetForm()
			toast.success('Wallet added successfully!')
		} catch (error) {
			console.error('Error saving wallet:', error)
			toast.error('Failed to save wallet')
		}
	}

	const handleDeleteWallet = async (walletId: string) => {
		try {
			await removeWallet(walletId)
			toast.success('Wallet removed successfully!')
		} catch (error) {
			console.error('Error removing wallet:', error)
			toast.error('Failed to remove wallet')
		}
	}

	const resetEditForm = () => {
		setEditingWallet(null)
		setEditWalletName('')
		setEditNwcPubkey('')
		setEditNwcRelays('')
		setEditNwcSecret('')
		setShowEditSecret(false)
		setEditStoreOnNostr(false)
		setOpenCollapsibleId(null)
	}

	const handleEditWallet = (wallet: Wallet) => {
		setEditingWallet(wallet)
		setEditWalletName(wallet.name)
		const parsedUri = parseNwcUri(wallet.nwcUri)
		setEditNwcPubkey(wallet.pubkey)
		setEditNwcRelays(wallet.relays.join(', '))
		setEditNwcSecret(parsedUri?.secret || '')
		setEditStoreOnNostr(wallet.storedOnNostr || false)
		setOpenCollapsibleId(wallet.id) // Keep the current collapsible open
	}

	const handleCancelEdit = () => {
		resetEditForm()
	}

	const handleSaveWalletUpdate = async () => {
		if (!editingWallet) return

		try {
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

			// Check if we're logged in (required for Nostr storage)
			if (editStoreOnNostr && !userPubkey) {
				toast.warning('You need to be logged in to store wallets on Nostr. Wallet will be saved locally only.')
				setEditStoreOnNostr(false) //  Ensure it's saved locally
			}

			const finalNwcUri = `nostr+walletconnect://${editNwcPubkey}?relay=${encodeURIComponent(editNwcRelays)}&secret=${editNwcSecret}`

			const walletUpdates: Partial<Omit<Wallet, 'id' | 'createdAt'>> = {
				name: editWalletName,
				nwcUri: finalNwcUri,
				pubkey: editNwcPubkey,
				relays: editNwcRelays.split(',').map((r) => r.trim()),
				storedOnNostr: editStoreOnNostr,
			}

			await updateWallet(editingWallet.id, walletUpdates)
			toast.success('Wallet updated successfully!')
			resetEditForm()
		} catch (error) {
			console.error('Error updating wallet:', error)
			toast.error('Failed to update wallet')
		}
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="flex flex-col items-center gap-2">
					<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					<p className="text-muted-foreground">Loading wallets...</p>
				</div>
			</div>
		)
	}

	if (isAddingWallet) {
		return (
			<div className="space-y-6">
				<div className="flex items-center space-x-2">
					<Button variant="ghost" size="icon" onClick={handleCancelAdd} aria-label="Back">
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
								<Label htmlFor="wallet-pubkey">Wallet Connect Pubkey</Label>
								<Input
									id="wallet-pubkey"
									placeholder="e.g 60b37aeb4c521316374bab549c074abc..."
									value={nwcPubkey}
									onChange={(e) => setNwcPubkey(e.target.value)}
								/>
							</div>

							<div>
								<Label htmlFor="wallet-relays">Wallet Connect Relays</Label>
								<Input
									id="wallet-relays"
									placeholder="e.g wss://relay.nostr.band"
									value={nwcRelays}
									onChange={(e) => setNwcRelays(e.target.value)}
								/>
							</div>

							<div>
								<Label htmlFor="wallet-secret">Wallet Connect Secret</Label>
								<div className="flex">
									<Input
										id="wallet-secret"
										type={showSecret ? 'text' : 'password'}
										placeholder="Secret"
										value={nwcSecret}
										onChange={(e) => setNwcSecret(e.target.value)}
										className="flex-1"
									/>
									<Button variant="outline" size="icon" onClick={() => setShowSecret(!showSecret)} className="ml-2">
										{showSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
									</Button>
								</div>
							</div>

							{userPubkey && (
								<div className="flex items-center space-x-2">
									<Checkbox id="store-wallet" checked={storeOnNostr} onCheckedChange={(checked) => setStoreOnNostr(checked === true)} />
									<Label htmlFor="store-wallet">Store wallet on Nostr (encrypted)</Label>
								</div>
							)}
						</div>
					</CardContent>
					<CardFooter className="flex justify-between">
						<Button variant="outline" onClick={handleCancelAdd}>
							Cancel
						</Button>
						<Button onClick={saveWallet}>Save Wallet</Button>
					</CardFooter>
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<h1 className="text-2xl font-bold">Making Payments</h1>
				{wallets.length > 0 && !isAddingWallet && (
					<Button onClick={handleAddWallet} className="hidden sm:flex">
						<PlusIcon className="h-4 w-4 mr-2" /> Add Another Wallet
					</Button>
				)}
			</div>

			{wallets.length === 0 && !isAddingWallet ? (
				<Card>
					<CardContent className="py-10 flex flex-col items-center justify-center">
						<p className="text-center text-muted-foreground mb-4">No wallets configured yet. Add a wallet to make payments.</p>
						<Button onClick={handleAddWallet}>
							<PlusIcon className="h-4 w-4 mr-2" /> Add Wallet
						</Button>
					</CardContent>
				</Card>
			) : (
				!isAddingWallet && (
					<>
						{wallets.map((wallet) => (
							<Collapsible
								key={wallet.id}
								className="space-y-2"
								open={openCollapsibleId === wallet.id}
								onOpenChange={(isOpen) => {
									if (isOpen) {
										// If opening this one, and it's not already the one being edited, set it for editing
										if (editingWallet?.id !== wallet.id) {
											handleEditWallet(wallet)
										}
									} else {
										// If closing, and it was the one being edited, reset edit form
										if (editingWallet?.id === wallet.id) {
											resetEditForm()
										}
									}
									setOpenCollapsibleId(isOpen ? wallet.id : null)
								}}
							>
								<Card>
									<CollapsibleTrigger asChild>
										<CardHeader className="pb-2 flex flex-row items-center justify-between cursor-pointer group">
											<div className="flex items-center gap-3">
												<WalletIcon className="h-6 w-6 text-muted-foreground" />
												<div>
													<CardTitle>{wallet.name}</CardTitle>
													<CardDescription className="text-xs">
														{wallet.storedOnNostr ? 'Stored on Nostr (encrypted)' : 'Stored locally'}
													</CardDescription>
												</div>
											</div>
											<div className="flex items-center">
												{editingWallet?.id !== wallet.id && ( // Show edit icon only if not currently editing this wallet
													<Button
														variant="ghost"
														size="icon"
														onClick={(e) => {
															e.stopPropagation()
															handleEditWallet(wallet)
														}}
														className="h-8 w-8"
														aria-label="Edit wallet"
													>
														<EditIcon className="h-4 w-4" />
													</Button>
												)}
												<Button
													variant="ghost"
													size="icon"
													onClick={(e) => {
														e.stopPropagation() // Prevent collapsible from toggling
														handleDeleteWallet(wallet.id)
													}}
													className="h-8 w-8 text-destructive"
													aria-label="Delete wallet"
												>
													<TrashIcon className="h-4 w-4" />
												</Button>
												<ChevronDownIcon className="h-4 w-4 ml-1 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
											</div>
										</CardHeader>
									</CollapsibleTrigger>
									<CollapsibleContent>
										<CardContent className="pt-2 pb-4">
											{editingWallet && editingWallet.id === wallet.id ? (
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

													{userPubkey && (
														<div className="flex items-center space-x-2 pt-2">
															<Checkbox
																id={`store-wallet-edit-${wallet.id}`}
																checked={editStoreOnNostr}
																onCheckedChange={(checked) => setEditStoreOnNostr(checked === true)}
															/>
															<Label htmlFor={`store-wallet-edit-${wallet.id}`}>Re-save on Nostr (encrypted)</Label>
														</div>
													)}
													<div className="flex justify-end space-x-2 pt-2">
														<Button variant="outline" onClick={handleCancelEdit}>
															Cancel
														</Button>
														<Button onClick={handleSaveWalletUpdate}>Save Changes</Button>
													</div>
												</div>
											) : (
												<div className="text-sm space-y-2">
													<div>
														<p className="font-medium">Public Key:</p>
														<p className="text-muted-foreground font-mono text-xs truncate">{wallet.pubkey}</p>
													</div>
													{wallet.relays && wallet.relays.length > 0 && (
														<div>
															<p className="font-medium">Relays:</p>
															<p className="text-muted-foreground font-mono text-xs truncate">
																{Array.isArray(wallet.relays)
																	? wallet.relays.join(', ')
																	: typeof wallet.relays === 'string'
																		? wallet.relays
																		: 'Unknown'}
															</p>
														</div>
													)}
													<Button variant="outline" size="sm" className="mt-2" onClick={() => handleEditWallet(wallet)}>
														<EditIcon className="h-3 w-3 mr-2" /> Edit Wallet
													</Button>
												</div>
											)}
										</CardContent>
									</CollapsibleContent>
								</Card>
							</Collapsible>
						))}
						{wallets.length > 0 && (
							<Button onClick={handleAddWallet} className="w-full mt-4 sm:hidden">
								<PlusIcon className="h-4 w-4 mr-2" /> Add Another Wallet
							</Button>
						)}
					</>
				)
			)}
		</div>
	)
}
