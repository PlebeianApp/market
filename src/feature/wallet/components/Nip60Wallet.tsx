import { authStore } from '@/lib/stores/auth'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import {
	ArrowDownLeft,
	ArrowUpRight,
	Loader2,
	Landmark,
	Plus,
	RefreshCw,
	X,
	Save,
	Star,
	Zap,
	Send,
	QrCode,
	ChevronDown,
	ChevronRight,
	Coins,
} from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { DepositLightningModal } from './DepositLightningModal'
import { WithdrawLightningModal } from './WithdrawLightningModal'
import { SendEcashModal } from './SendEcashModal'
import { ReceiveEcashModal } from './ReceiveEcashModal'

// Default mints for new wallets
const DEFAULT_MINTS = ['https://mint.minibits.cash/Bitcoin', 'https://mint.coinos.io', 'https://mint.cubabitcoin.org']

type ModalType = 'deposit' | 'withdraw' | 'send' | 'receive' | null

interface ProofInfo {
	id: string
	amount: number
	secret: string
	C: string
	mint?: string
}

export function Nip60Wallet() {
	const { isAuthenticated, user } = useStore(authStore)
	const { status, balance, mintBalances, mints, defaultMint, transactions, error } = useStore(nip60Store)
	const [isCreating, setIsCreating] = useState(false)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [isSaving, setIsSaving] = useState(false)
	const [openModal, setOpenModal] = useState<ModalType>(null)
	const [showProofs, setShowProofs] = useState(false)
	const [expandedMints, setExpandedMints] = useState<Set<string>>(new Set())

	// Get proofs from wallet state
	const proofsByMint = useMemo(() => {
		const wallet = nip60Actions.getWallet()
		if (!wallet) return new Map<string, ProofInfo[]>()

		const result = new Map<string, ProofInfo[]>()

		try {
			const dump = wallet.state.dump()
			const dumpProofs = dump.proofs as unknown

			if (Array.isArray(dumpProofs)) {
				for (const entry of dumpProofs) {
					if (entry && typeof entry === 'object') {
						// Handle ProofEntry structure: { mint, proofs }
						if ('mint' in entry && 'proofs' in entry && Array.isArray(entry.proofs)) {
							const mintUrl = entry.mint as string
							const proofs = entry.proofs as ProofInfo[]
							result.set(mintUrl, proofs)
						}
						// Handle flat proof with mint attached
						else if ('mint' in entry && 'C' in entry && 'amount' in entry) {
							const mintUrl = (entry as ProofInfo).mint || 'unknown'
							const existing = result.get(mintUrl) || []
							existing.push(entry as ProofInfo)
							result.set(mintUrl, existing)
						}
					}
				}
			}

			// Also try getProofs for each mint
			if (result.size === 0 && typeof wallet.state.getProofs === 'function') {
				for (const mint of mints) {
					try {
						const proofs = wallet.state.getProofs({ mint })
						if (Array.isArray(proofs) && proofs.length > 0) {
							result.set(mint, proofs as ProofInfo[])
						}
					} catch {
						// ignore
					}
				}
			}
		} catch (e) {
			console.error('[Nip60Wallet] Failed to get proofs:', e)
		}

		return result
	}, [balance, mints]) // Re-compute when balance or mints change

	const toggleMintExpanded = (mint: string) => {
		setExpandedMints((prev) => {
			const next = new Set(prev)
			if (next.has(mint)) {
				next.delete(mint)
			} else {
				next.add(mint)
			}
			return next
		})
	}

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
			// Always consolidate on manual refresh to clean up spent proofs
			await nip60Actions.refresh({ consolidate: true })
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

	const handleSetDefaultMint = (mintUrl: string) => {
		// Toggle: if already default, clear it; otherwise set it
		if (defaultMint === mintUrl) {
			nip60Actions.setDefaultMint(null)
		} else {
			nip60Actions.setDefaultMint(mintUrl)
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
				<div className="absolute right-0 top-0 flex gap-1">
					<button
						onClick={handleRefresh}
						disabled={isRefreshing}
						className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
						title="Refresh & sync wallet"
					>
						<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
					</button>
				</div>
				<p className="text-sm text-muted-foreground mb-1">Balance</p>
				<p className="text-2xl font-bold">{balance.toLocaleString()} sats</p>
			</div>

			{/* Action Buttons */}
			<div className="grid grid-cols-2 gap-2 mb-4">
				<button
					onClick={() => setOpenModal('deposit')}
					className="flex items-center justify-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
				>
					<Zap className="w-4 h-4" />
					Deposit
				</button>
				<button
					onClick={() => setOpenModal('withdraw')}
					disabled={balance === 0}
					className="flex items-center justify-center gap-2 px-3 py-2 text-sm bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
				>
					<Zap className="w-4 h-4" />
					Withdraw
				</button>
				<button
					onClick={() => setOpenModal('receive')}
					className="flex items-center justify-center gap-2 px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
				>
					<QrCode className="w-4 h-4" />
					Receive eCash
				</button>
				<button
					onClick={() => setOpenModal('send')}
					disabled={balance === 0}
					className="flex items-center justify-center gap-2 px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
				>
					<Send className="w-4 h-4" />
					Send eCash
				</button>
			</div>

			<div className="border-t pt-4 mb-4">
				<p className="text-sm font-medium mb-2">Mints</p>
				<div className="space-y-2">
					{mints.map((mint) => (
						<div key={mint} className="flex items-center justify-between text-sm">
							<div className="flex items-center gap-2 min-w-0 flex-1">
								<button
									onClick={() => handleSetDefaultMint(mint)}
									className={`p-0.5 ${defaultMint === mint ? 'text-yellow-500' : 'text-muted-foreground hover:text-yellow-500'}`}
									title={defaultMint === mint ? 'Default mint (click to unset)' : 'Set as default mint'}
								>
									<Star className={`w-4 h-4 ${defaultMint === mint ? 'fill-current' : ''}`} />
								</button>
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

			{/* Proofs Section */}
			<div className="border-t pt-4">
				<button onClick={() => setShowProofs(!showProofs)} className="flex items-center gap-2 text-sm font-medium mb-2 w-full text-left">
					{showProofs ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
					<Coins className="w-4 h-4" />
					Proofs ({Array.from(proofsByMint.values()).flat().length})
				</button>

				{showProofs && (
					<div className="space-y-2 max-h-64 overflow-y-auto">
						{proofsByMint.size === 0 ? (
							<p className="text-sm text-muted-foreground">No proofs in wallet</p>
						) : (
							Array.from(proofsByMint.entries()).map(([mint, proofs]) => (
								<div key={mint} className="bg-muted/50 rounded-md p-2">
									<button onClick={() => toggleMintExpanded(mint)} className="flex items-center gap-2 text-sm w-full text-left">
										{expandedMints.has(mint) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
										<span className="font-medium truncate flex-1">{new URL(mint).hostname}</span>
										<span className="text-muted-foreground">
											{proofs.length} proof{proofs.length !== 1 ? 's' : ''} • {proofs.reduce((s, p) => s + p.amount, 0).toLocaleString()}{' '}
											sats
										</span>
									</button>

									{expandedMints.has(mint) && (
										<div className="mt-2 space-y-1 pl-5">
											{proofs.map((proof, idx) => (
												<div
													key={`${proof.id}-${proof.secret.slice(0, 8)}-${idx}`}
													className="flex items-center justify-between text-xs bg-background rounded px-2 py-1"
												>
													<div className="flex items-center gap-2 min-w-0">
														<span className="font-mono text-muted-foreground" title={`Keyset: ${proof.id}`}>
															{proof.id.slice(0, 8)}...
														</span>
													</div>
													<span className="font-medium">{proof.amount} sats</span>
												</div>
											))}
										</div>
									)}
								</div>
							))
						)}
					</div>
				)}
			</div>

			{/* Modals */}
			<DepositLightningModal open={openModal === 'deposit'} onClose={() => setOpenModal(null)} />
			<WithdrawLightningModal open={openModal === 'withdraw'} onClose={() => setOpenModal(null)} />
			<SendEcashModal open={openModal === 'send'} onClose={() => setOpenModal(null)} />
			<ReceiveEcashModal open={openModal === 'receive'} onClose={() => setOpenModal(null)} />
		</div>
	)
}
