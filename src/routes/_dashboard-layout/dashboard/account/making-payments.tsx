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
import { useDeletePaymentDetail, usePublishRichPaymentDetail, useRichUserPaymentDetails, useUpdatePaymentDetail, useWalletDetail, type PaymentScope, type RichPaymentDetail } from '@/queries/payment'
import { getCollectionId, getCollectionTitle, useCollectionsByPubkey } from '@/queries/collections'

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
		<div className="space-y-4">
			<WalletListItem
				wallet={null}
				isOpen={openWalletId === 'new'}
				onOpenChange={(open) => handleOpenChange('new', open)}
				onSuccess={handleSuccess}
				userPubkey={userPubkey}
			/>

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
							/>
						))}

						{combinedWallets.length > 0 && (
				<div className="mt-4 flex justify-end">
					<Button onClick={() => refetchNostrWallets()} disabled={nostrLoading || !userPubkey}>
						<RefreshCwIcon className={`w-4 h-4 mr-2 ${nostrLoading ? 'animate-spin' : ''}`} />
						Refresh Nostr Wallets
							</Button>
				</div>
			)}
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
	const { data: nostrWallets, isLoading: nostrLoading, refetch: refetchNostrWallets } = useUserNwcWalletsQuery(userPubkey)
	const saveNostrWalletsMutation = useSaveUserNwcWalletsMutation()

	const isEditing = !!wallet

	const [name, setName] = useState(wallet?.name || '')
	const [nwcUri, setNwcUri] = useState(wallet?.nwcUri || '')
	const [pubkey, setPubkey] = useState(wallet?.pubkey || '')
	const [relays, setRelays] = useState(wallet?.relays.join(', ') || '')
	const [secret, setSecret] = useState(parseNwcUri(wallet?.nwcUri || '')?.secret || '')
	const [storedOnNostr, setStoredOnNostr] = useState(wallet?.storedOnNostr || false)
	const [showSecret, setShowSecret] = useState(false)

	const handleNwcUriChange = (uri: string) => {
		setNwcUri(uri)
		const parsed = parseNwcUri(uri)
		if (parsed) {
			setPubkey(parsed.pubkey)
			setRelays(parsed.relay || '')
			setSecret(parsed.secret || '')
			if (parsed.name) {
				setName(parsed.name)
			}
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
		uiStore.getState().showDialog({
			component: 'qrScanner',
			props: {
				onScan: (result: string) => {
					handleNwcUriChange(result)
					uiStore.getState().hideDialog('qrScanner')
				},
			},
		})
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!name.trim() || !pubkey) {
			toast.error('Wallet name and pubkey are required')
			return
		}

		const finalNwcUri = `nostr+walletconnect://${pubkey}?relay=${encodeURIComponent(relays)}&secret=${secret}${name ? `&name=${encodeURIComponent(name)}` : ''}`

		const walletData: Omit<Wallet, 'id' | 'createdAt'> = {
			name,
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

	return (
		<form onSubmit={handleSubmit} className="p-4 border-t space-y-6">
			{!isEditing && (
				<div className="space-y-2">
					<Label htmlFor="nwc-uri">NWC Connection String</Label>
					<div className="flex gap-2">
						<Input id="nwc-uri" value={nwcUri} onChange={(e) => handleNwcUriChange(e.target.value)} placeholder="nostr+walletconnect://..." />
						<Button type="button" variant="outline" size="icon" onClick={handlePaste}>
							<ClipboardIcon className="h-4 w-4" />
						</Button>
						<Button type="button" variant="outline" size="icon" onClick={handleScan}>
							<ScanIcon className="h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
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
					<Label htmlFor="store-on-nostr" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
						Store on Nostr (encrypted)
					</Label>
				</div>
			)}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={saveNostrWalletsMutation.isPending}>
					{saveNostrWalletsMutation.isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Save Wallet'}
				</Button>
			</div>
		</form>
	)
}

function WalletListItem({
	wallet,
	isOpen,
	onOpenChange,
	onDelete,
	isDeleting,
	onSuccess,
	userPubkey,
}: {
	wallet: Wallet | null
	isOpen: boolean
	onOpenChange: (isOpen: boolean) => void
	onDelete?: () => void
	isDeleting?: boolean
	onSuccess: () => void
	userPubkey: string | undefined
}) {
	const balanceQuery = useNwcWalletBalanceQuery(wallet?.nwcUri, !!wallet)
	const isEditing = !!wallet

	const triggerContent = isEditing ? (
		<div className="flex items-center gap-3 min-w-0 flex-1">
			<WalletIcon className="w-5 h-5 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<div className="font-medium truncate">{wallet.name}</div>
				<div className="text-sm text-muted-foreground">
					{balanceQuery.data ? (
						`${(balanceQuery.data.balance / 1000).toLocaleString()} sats`
					) : balanceQuery.isLoading ? (
						'Loading balance...'
					) : (
						<span className="text-yellow-600">Could not fetch balance</span>
					)}
				</div>
			</div>
		</div>
	) : (
		<div className="flex items-center gap-2">
			<PlusIcon className="w-6 h-6" />
			<span>Add another wallet</span>
		</div>
	)

	const triggerActions = isEditing ? (
		<div className="flex items-center gap-2">
			<Button
				variant="ghost"
				size="icon"
				onClick={(e) => {
					e.stopPropagation()
					balanceQuery.refetch()
				}}
				disabled={balanceQuery.isFetching}
			>
				<RefreshCwIcon className={`w-4 h-4 ${balanceQuery.isFetching ? 'animate-spin' : ''}`} />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				onClick={(e) => {
					e.stopPropagation()
					if (onDelete) onDelete()
				}}
				disabled={isDeleting}
			>
				{isDeleting ? <Spinner className="w-4 h-4" /> : <TrashIcon className="w-4 h-4 text-destructive" />}
			</Button>
		</div>
	) : null

	return (
		<DashboardListItem
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			triggerContent={triggerContent}
			actions={triggerActions}
			data-testid={isEditing ? `wallet-item-${wallet.id}` : 'add-wallet-button'}
		>
			<WalletForm
				wallet={wallet}
				onSuccess={onSuccess}
				onCancel={() => onOpenChange(false)}
				userPubkey={userPubkey}
			/>
		</DashboardListItem>
	)
}
