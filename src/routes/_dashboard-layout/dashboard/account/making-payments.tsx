import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ndkActions } from '@/lib/stores/ndk'
import { uiStore } from '@/lib/stores/ui'
import { parseNwcUri, useWallets, walletActions, type Wallet } from '@/lib/stores/wallet'
import { useUserNwcWalletsQuery, type UserNwcWallet } from '@/queries/wallet'
import { walletKeys } from '@/queries/queryKeyFactory'
import { useSaveUserNwcWalletsMutation } from '@/publish/wallet'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
	ArrowLeftIcon,
	ChevronLeftIcon,
	EyeIcon,
	EyeOffIcon,
	PlusIcon,
	RefreshCwIcon,
	ScanIcon,
	TrashIcon,
	WalletIcon,
	ClipboardIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { Spinner } from '@/components/ui/spinner'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import {
	useDeletePaymentDetail,
	usePublishRichPaymentDetail,
	useRichUserPaymentDetails,
	useUpdatePaymentDetail,
	useWalletDetail,
	type PaymentScope,
	type RichPaymentDetail,
} from '@/queries/payment'
import { getCollectionId, getCollectionTitle, useCollectionsByPubkey } from '@/queries/collections'
import { uiActions } from '@/lib/stores/ui'

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

	// TanStack Query for Nostr wallets
	const { data: nostrWallets, isLoading: nostrLoading, refetch: refetchNostrWallets } = useUserNwcWalletsQuery(userPubkey)
	const saveNostrWalletsMutation = useSaveUserNwcWalletsMutation()

	const [openWalletId, setOpenWalletId] = useState<string | null>(null)
	const [deletingWalletId, setDeletingWalletId] = useState<string | null>(null)

	const combinedWallets = useMemo(() => {
		return localWallets
	}, [localWallets])

	useEffect(() => {
		const getUserPubkey = async () => {
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					setUserPubkey(user.pubkey)
					if (!isInitialized) {
						walletActions.initialize()
					}
				}
			} else if (!isInitialized) {
				walletActions.initialize()
			}
		}
		getUserPubkey()
	}, [signer, isInitialized])

	useEffect(() => {
		if (nostrWallets && userPubkey) {
			walletActions.setNostrWallets(nostrWallets as Wallet[])
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

		return () => {
			walletActions.setOnWalletChange(() => {})
		}
	}, [queryClient])

	const handleOpenChange = (walletId: string | null, open: boolean) => {
		if (open) {
			setOpenWalletId(walletId)
		} else {
			setOpenWalletId(null)
		}
	}

	const handleSuccess = () => {
		setOpenWalletId(null)
		refetchNostrWallets()
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

			if (openWalletId === walletId) {
				setOpenWalletId(null)
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
		return (
			<div className="flex items-center justify-center h-64">
				<div className="flex flex-col items-center gap-2">
					<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					<p className="text-muted-foreground">Loading wallets...</p>
				</div>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Making Payments</h1>
				<Button
					onClick={() => handleOpenChange('new', true)}
					className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold"
				>
					<PlusIcon className="w-5 h-5" />
					Add Wallet
				</Button>
			</div>
			<div className="space-y-4 p-4 lg:p-8">
				<div className="lg:hidden">
					<Button
						onClick={() => handleOpenChange('new', true)}
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<PlusIcon className="w-5 h-5" />
						Add Wallet
					</Button>
				</div>

				{/* Wallet form - shows at top when opened */}
				{openWalletId === 'new' && (
					<Card className="mt-4">
						<CardHeader>
							<CardTitle>Add New Wallet</CardTitle>
							<CardDescription>Connect your Nostr Wallet to make payments</CardDescription>
						</CardHeader>
						<CardContent>
							<WalletForm wallet={null} onSuccess={handleSuccess} onCancel={() => handleOpenChange('new', false)} userPubkey={userPubkey} />
						</CardContent>
					</Card>
				)}

				<div className="space-y-4">
					{combinedWallets.map((wallet) => (
						<WalletListItem
							key={wallet.id}
							wallet={wallet}
							isOpen={openWalletId === wallet.id}
							onOpenChange={(open) => handleOpenChange(wallet.id, open)}
							onDelete={() => handleDeleteWallet(wallet.id)}
							isDeleting={deletingWalletId === wallet.id}
							onSuccess={handleSuccess}
							userPubkey={userPubkey}
							onCancel={() => handleOpenChange(wallet.id, false)}
						/>
					))}
				</div>
			</div>
		</div>
	)
}

interface WalletFormProps {
	wallet: Wallet | null
	onSuccess: () => void
	onCancel: () => void
	userPubkey: string | undefined
}

function WalletForm({ wallet, onSuccess, onCancel, userPubkey }: WalletFormProps) {
	const { wallets } = useWallets()
	const { data: nostrWallets, isLoading: nostrLoading, refetch: refetchNostrWallets } = useUserNwcWalletsQuery(userPubkey)
	const saveNostrWalletsMutation = useSaveUserNwcWalletsMutation()

	const isEditing = !!wallet

	const [name, setName] = useState(wallet?.name || '')
	const [nwcUri, setNwcUri] = useState(wallet?.nwcUri || '')
	const [pubkey, setPubkey] = useState(wallet?.pubkey || '')
	const [relays, setRelays] = useState(wallet?.relays.join(', ') || '')
	const [secret, setSecret] = useState(wallet ? (parseNwcUri(wallet.nwcUri)?.secret ?? '') : '')
	const [storedOnNostr, setStoredOnNostr] = useState(wallet?.storedOnNostr || false)
	const [showSecret, setShowSecret] = useState(false)

	const handleNwcUriChange = (uri: string) => {
		setNwcUri(uri)
		const parsed = parseNwcUri(uri)
		if (parsed) {
			setPubkey(parsed.pubkey)
			setRelays(parsed.relay || '')
			setSecret(parsed.secret || '')
		}
	}

	const handlePaste = async () => {
		try {
			const text = await navigator.clipboard.readText()
			handleNwcUriChange(text)
			toast.success('Pasted from clipboard')
		} catch (err) {
			toast.error('Failed to read from clipboard')
		}
	}

	const handleScan = () => {
		uiActions.openDialog('scan-qr', {
			onScan: (result: string) => {
				handleNwcUriChange(result)
				uiActions.closeDialog('scan-qr')
			},
		})
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		const finalName = isEditing ? name.trim() : name.trim() || `Wallet ${wallets.length + 1}`

		if (isEditing && !finalName) {
			toast.error('Wallet name is required')
			return
		}

		if (!pubkey.trim()) {
			toast.error('Wallet Connect Pubkey is required')
			return
		}

		const finalNwcUri = `nostr+walletconnect://${pubkey}?relay=${encodeURIComponent(relays)}&secret=${secret}${finalName ? `&name=${encodeURIComponent(finalName)}` : ''}`

		const walletData: Omit<Wallet, 'id' | 'createdAt'> = {
			name: finalName,
			nwcUri: finalNwcUri,
			pubkey,
			relays: relays.split(',').map((r) => r.trim()),
			storedOnNostr,
			updatedAt: Math.round(Date.now() / 1000),
		}

		try {
			if (isEditing) {
				const updatedWallet = walletActions.updateWallet(wallet.id, walletData)
				if (updatedWallet && (updatedWallet.storedOnNostr || wallet.storedOnNostr) && userPubkey) {
					const walletsToSave = walletActions.getWallets().filter((w) => w.storedOnNostr)
					saveNostrWalletsMutation.mutate({
						wallets: walletsToSave as UserNwcWallet[],
						userPubkey: userPubkey,
					})
				}
			} else {
				const newWallet = walletActions.addWallet(walletData, storedOnNostr)
				if (newWallet.storedOnNostr && userPubkey) {
					const walletsToSave = walletActions.getWallets().filter((w) => w.storedOnNostr)
					saveNostrWalletsMutation.mutate({
						wallets: walletsToSave as UserNwcWallet[],
						userPubkey: userPubkey,
					})
				}
			}
			toast.success(`Wallet ${isEditing ? 'updated' : 'added'} successfully!`)
			onSuccess()
		} catch (error) {
			console.error(`Error saving wallet:`, error)
			toast.error(`Failed to ${isEditing ? 'update' : 'add'} wallet`)
		}
	}

	if (!isEditing) {
		return (
			<form onSubmit={handleSubmit} className="space-y-6">
				<div className="space-y-2">
					<p className="text-lg font-semibold">Add Nostr Wallet Connect</p>
					<p className="text-sm text-muted-foreground">Paste your Nostr Wallet Connect URI or scan a QR code to connect your wallet.</p>
				</div>
				<div className="flex gap-2">
					<Button type="button" onClick={handlePaste} className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black">
						PASTE
					</Button>
					<Button type="button" onClick={handleScan} className="flex-1 bg-black text-white hover:bg-gray-800">
						<ScanIcon className="h-4 w-4 mr-2" />
						SCAN
					</Button>
				</div>
				<div className="space-y-2">
					<Label htmlFor="nwc-pubkey-add">Wallet Connect Pubkey</Label>
					<Input
						id="nwc-pubkey-add"
						value={pubkey}
						onChange={(e) => setPubkey(e.target.value)}
						placeholder="e.g. 60b37aeb4c521316374bab549c074abc..."
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="nwc-relays-add">Wallet Connect Relays</Label>
					<Input id="nwc-relays-add" value={relays} onChange={(e) => setRelays(e.target.value)} placeholder="e.g. wss://relay.nostr.band" />
				</div>
				<div className="space-y-2">
					<Label htmlFor="nwc-secret-add">Wallet Connect Secret</Label>
					<div className="relative">
						<Input
							id="nwc-secret-add"
							type={showSecret ? 'text' : 'password'}
							value={secret}
							onChange={(e) => setSecret(e.target.value)}
							placeholder="Secret"
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="absolute top-1/2 right-2 -translate-y-1/2 h-7 w-7"
							onClick={() => setShowSecret(!showSecret)}
						>
							{showSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
						</Button>
					</div>
				</div>
				{userPubkey && (
					<div className="flex items-center space-x-2">
						<Checkbox id="store-on-nostr-add" checked={storedOnNostr} onCheckedChange={(checked) => setStoredOnNostr(!!checked)} />
						<Label htmlFor="store-on-nostr-add" className="text-sm font-medium leading-none">
							Store wallet on Nostr (encrypted)
						</Label>
					</div>
				)}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={saveNostrWalletsMutation.isPending}>
						{saveNostrWalletsMutation.isPending ? 'Saving...' : 'Save Wallet'}
					</Button>
				</div>
			</form>
		)
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor="wallet-name">Wallet Name</Label>
				<Input id="wallet-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Awesome Wallet" />
			</div>
			<div className="space-y-2">
				<Label htmlFor="nwc-pubkey">Wallet Connect Pubkey</Label>
				<Input id="nwc-pubkey" value={pubkey} onChange={(e) => setPubkey(e.target.value)} placeholder="npub..." />
			</div>
			<div className="space-y-2">
				<Label htmlFor="nwc-relays">Wallet Connect Relays</Label>
				<Input id="nwc-relays" value={relays} onChange={(e) => setRelays(e.target.value)} placeholder="wss://relay.one, wss://relay.two" />
			</div>
			<div className="space-y-2">
				<Label htmlFor="nwc-secret">Wallet Connect Secret</Label>
				<div className="relative">
					<Input
						id="nwc-secret"
						type={showSecret ? 'text' : 'password'}
						value={secret}
						onChange={(e) => setSecret(e.target.value)}
						placeholder="nsec..."
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="absolute top-1/2 right-2 -translate-y-1/2 h-7 w-7"
						onClick={() => setShowSecret(!showSecret)}
					>
						{showSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
					</Button>
				</div>
			</div>
			{userPubkey && (
				<div className="flex items-center space-x-2">
					<Checkbox id="store-on-nostr" checked={storedOnNostr} onCheckedChange={(checked) => setStoredOnNostr(!!checked)} />
					<Label
						htmlFor="store-on-nostr"
						className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
					>
						Store on Nostr (encrypted)
					</Label>
				</div>
			)}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={saveNostrWalletsMutation.isPending}>
					{saveNostrWalletsMutation.isPending ? 'Saving...' : 'Save Changes'}
				</Button>
			</div>
		</form>
	)
}

interface WalletListItemProps {
	wallet: Wallet | null
	isOpen: boolean
	onOpenChange: (isOpen: boolean) => void
	onDelete?: () => void
	isDeleting?: boolean
	onSuccess: () => void
	onCancel: () => void
	userPubkey: string | undefined
}

function WalletListItem({ wallet, isOpen, onOpenChange, onDelete, isDeleting, onSuccess, onCancel, userPubkey }: WalletListItemProps) {
	const triggerContent = (
		<div>
			<p className="font-semibold">{wallet?.name ?? 'Add a New Wallet'}</p>
			<p className="text-sm text-muted-foreground">
				{isDeleting ? 'Removing...' : wallet?.storedOnNostr ? 'Stored on Nostr (encrypted)' : 'Stored locally'}
			</p>
		</div>
	)

	const actions = wallet ? (
		<Button
			variant="ghost"
			size="icon"
			onClick={(e) => {
				e.stopPropagation()
				onDelete?.()
			}}
			className="h-8 w-8 text-destructive hover:bg-destructive/10"
			aria-label="Delete wallet"
			disabled={isDeleting}
		>
			{isDeleting ? <Spinner className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
		</Button>
	) : (
		<PlusIcon className="h-6 w-6 text-muted-foreground" />
	)

	return (
		<DashboardListItem
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			triggerContent={triggerContent}
			actions={actions}
			isDeleting={isDeleting}
		>
			<WalletForm wallet={wallet} onSuccess={onSuccess} onCancel={onCancel} userPubkey={userPubkey} />
		</DashboardListItem>
	)
}
