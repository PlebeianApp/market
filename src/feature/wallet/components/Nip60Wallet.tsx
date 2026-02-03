import { authStore } from '@/lib/stores/auth'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import { ArrowDownLeft, ArrowUpRight, Loader2, Landmark, Plus, RefreshCw, X, Save } from 'lucide-react'
import { useEffect, useState } from 'react'

// Default mints for new wallets
const DEFAULT_MINTS = ['https://mint.minibits.cash/Bitcoin', 'https://mint.coinos.io', 'https://mint.cubabitcoin.org']

export function Nip60Wallet() {
	const { isAuthenticated, user } = useStore(authStore)
	const { status, balance, mintBalances, mints, transactions, error } = useStore(nip60Store)
	const [isCreating, setIsCreating] = useState(false)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [isSaving, setIsSaving] = useState(false)

	useEffect(() => {
		if (!isAuthenticated || !user?.pubkey) {
			return
		}

		// Initialize wallet if not already initialized
		if (status === 'idle') {
			nip60Actions.initialize(user.pubkey)
		}
	}, [isAuthenticated, user?.pubkey, status])

	const handleCreateWallet = async () => {
		setIsCreating(true)
		try {
			await nip60Actions.createWallet(DEFAULT_MINTS)
		} finally {
			setIsCreating(false)
		}
	}

	const handleRefresh = async () => {
		setIsRefreshing(true)
		try {
			await nip60Actions.refresh()
		} finally {
			setIsRefreshing(false)
		}
	}

	const handleAddMint = () => {
		if (!newMintUrl.trim()) return
		nip60Actions.addMint(newMintUrl)
		setNewMintUrl('')
	}

	const handleRemoveMint = (mintUrl: string) => {
		nip60Actions.removeMint(mintUrl)
	}

	const handleSaveWallet = async () => {
		setIsSaving(true)
		try {
			await nip60Actions.publishWallet()
		} finally {
			setIsSaving(false)
		}
	}

	if (!isAuthenticated) {
		return (
			<div className="p-4 text-center text-muted-foreground">
				<p>Please log in to view your wallet</p>
			</div>
		)
	}

	if (status === 'idle' || status === 'initializing') {
		return (
			<div className="flex items-center justify-center p-4">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className="p-4 text-center text-destructive">
				<p>{error}</p>
			</div>
		)
	}

	if (status === 'no_wallet') {
		return (
			<div className="p-4 text-center">
				<p className="text-muted-foreground mb-4">No Cashu wallet found</p>
				<button
					onClick={handleCreateWallet}
					disabled={isCreating}
					className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
				>
					{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
					Create Wallet
				</button>
			</div>
		)
	}

	return (
		<div className="p-4">
			<div className="text-center mb-4 relative">
				<button
					onClick={handleRefresh}
					disabled={isRefreshing}
					className="absolute right-0 top-0 p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
					title="Refresh"
				>
					<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
				</button>
				<p className="text-sm text-muted-foreground mb-1">Balance</p>
				<p className="text-2xl font-bold">{balance.toLocaleString()} sats</p>
			</div>

			<div className="border-t pt-4 mb-4">
				<p className="text-sm font-medium mb-2">Mints</p>
				<div className="space-y-2">
					{mints.map((mint) => (
						<div key={mint} className="flex items-center justify-between text-sm">
							<div className="flex items-center gap-2 min-w-0 flex-1">
								<Landmark className="w-4 h-4 text-muted-foreground shrink-0" />
								<span className="text-muted-foreground truncate" title={mint}>
									{new URL(mint).hostname}
								</span>
							</div>
							<div className="flex items-center gap-2 ml-2">
								{mintBalances[mint] !== undefined && <span className="font-medium">{mintBalances[mint].toLocaleString()} sats</span>}
								<button
									onClick={() => handleRemoveMint(mint)}
									className="p-1 text-muted-foreground hover:text-destructive"
									title="Remove mint"
								>
									<X className="w-3 h-3" />
								</button>
							</div>
						</div>
					))}
					{mints.length === 0 && <p className="text-muted-foreground text-sm">No mints configured</p>}
				</div>

				{/* Add mint input */}
				<div className="mt-3 flex gap-2">
					<input
						type="url"
						value={newMintUrl}
						onChange={(e) => setNewMintUrl(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && handleAddMint()}
						placeholder="https://mint.example.com"
						className="flex-1 px-2 py-1.5 text-sm border rounded-md bg-background"
					/>
					<button
						onClick={handleAddMint}
						disabled={!newMintUrl.trim()}
						className="px-2 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
					>
						<Plus className="w-4 h-4" />
					</button>
				</div>

				{/* Save button */}
				<button
					onClick={handleSaveWallet}
					disabled={isSaving}
					className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
				>
					{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
					Save Wallet
				</button>
			</div>

			{transactions.length > 0 && (
				<div className="border-t pt-4">
					<p className="text-sm font-medium mb-2">Recent Transactions</p>
					<div className="space-y-2 max-h-48 overflow-y-auto">
						{transactions.map((tx) => (
							<div key={tx.id} className="flex items-center justify-between text-sm">
								<div className="flex items-center gap-2">
									{tx.direction === 'in' ? (
										<ArrowDownLeft className="w-4 h-4 text-green-500" />
									) : (
										<ArrowUpRight className="w-4 h-4 text-red-500" />
									)}
									<span className="text-muted-foreground">{new Date(tx.timestamp * 1000).toLocaleDateString()}</span>
								</div>
								<span className={tx.direction === 'in' ? 'text-green-500' : 'text-red-500'}>
									{tx.direction === 'in' ? '+' : '-'}
									{tx.amount.toLocaleString()} sats
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{transactions.length === 0 && (
				<div className="border-t pt-4 text-center text-muted-foreground text-sm">
					<p>No transactions yet</p>
				</div>
			)}
		</div>
	)
}
