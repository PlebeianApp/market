import { authStore } from '@/lib/stores/auth'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { useStore } from '@tanstack/react-store'
import {
	ArrowDownLeft,
	ArrowUpRight,
	ArrowUpDown,
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
	ChevronRight,
	Coins,
} from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { DepositLightningModal } from './DepositLightningModal'
import { WithdrawLightningModal } from './WithdrawLightningModal'
import { SendEcashModal } from './SendEcashModal'
import { ReceiveEcashModal } from './ReceiveEcashModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

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
	const [openSection, setOpenSection] = useState<'mints' | 'transactions' | 'proofs' | null>(null)
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
			<div className="p-4 text-center w-80">
				<p className="text-muted-foreground mb-4">No Cashu wallet found</p>
				<Button
					onClick={handleCreateWallet}
					disabled={isCreating}
					icon={isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
				>
					Create Wallet
				</Button>
			</div>
		)
	}

	return (
		<div className="p-4 w-80 max-w-full overflow-hidden">
			<div className="text-center mb-4 relative">
				<div className="absolute right-0 top-0 flex gap-1">
					<Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing} title="Refresh & sync wallet">
						<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
					</Button>
				</div>
				<p className="text-sm text-muted-foreground mb-1">Balance</p>
				<p className="text-2xl font-bold">{balance.toLocaleString()} sats</p>
			</div>

			{/* Action Buttons */}
			<div className="grid grid-cols-2 gap-2 mb-4">
				<Button
					variant="tertiary"
					size="sm"
					onClick={() => setOpenModal('deposit')}
					className="bg-green-600 hover:bg-green-700 border-green-700"
					icon={<Zap className="w-4 h-4" />}
				>
					Deposit
				</Button>
				<Button
					variant="tertiary"
					size="sm"
					onClick={() => setOpenModal('withdraw')}
					disabled={balance === 0}
					className="bg-orange-600 hover:bg-orange-700 border-orange-700"
					icon={<Zap className="w-4 h-4" />}
				>
					Withdraw
				</Button>
				<Button variant="secondary" size="sm" onClick={() => setOpenModal('receive')} icon={<QrCode className="w-4 h-4" />}>
					Receive eCash
				</Button>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => setOpenModal('send')}
					disabled={balance === 0}
					icon={<Send className="w-4 h-4" />}
				>
					Send eCash
				</Button>
			</div>

			{/* Default Mint Selector */}
			<div className="pt-2 mb-2 overflow-hidden">
				<p className="text-sm font-medium mb-2">Default Mint</p>
				{mints.length > 0 ? (
					<Select value={defaultMint ?? ''} onValueChange={(value) => nip60Actions.setDefaultMint(value || null)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select a default mint">
								{defaultMint ? (
									<span className="flex items-center gap-2 truncate">
										<Star className="w-4 h-4 text-yellow-500 fill-current shrink-0" />
										<span className="truncate">{new URL(defaultMint).hostname}</span>
										{mintBalances[defaultMint] !== undefined && (
											<span className="text-muted-foreground shrink-0">({mintBalances[defaultMint].toLocaleString()})</span>
										)}
									</span>
								) : (
									'Select a default mint'
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="max-w-[calc(100vw-2rem)]">
							{mints.map((mint) => (
								<SelectItem key={mint} value={mint}>
									<div className="flex items-center gap-2">
										<Landmark className="w-4 h-4 shrink-0" />
										<span className="truncate">{new URL(mint).hostname}</span>
										{mintBalances[mint] !== undefined && (
											<span className="text-muted-foreground shrink-0">({mintBalances[mint].toLocaleString()})</span>
										)}
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<p className="text-muted-foreground text-sm">No mints configured</p>
				)}
			</div>

			{/* Toggle Row: Mints, Transactions, Proofs */}
			<div className="pt-2 overflow-hidden">
				{/* Toggle buttons row */}
				<div className="flex gap-1 mb-2">
					<Button
						variant={openSection === 'mints' ? 'secondary' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'mints' ? null : 'mints')}
						className="flex-1 gap-1.5 px-2"
						title="Manage mints"
					>
						<Landmark className="w-4 h-4 shrink-0" />
						<span className="text-xs">{mints.length}</span>
					</Button>
					<Button
						variant={openSection === 'transactions' ? 'secondary' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'transactions' ? null : 'transactions')}
						className="flex-1 gap-1.5 px-2"
						title="Transactions"
					>
						<ArrowUpDown className="w-4 h-4 shrink-0" />
						<span className="text-xs">{transactions.length}</span>
					</Button>
					<Button
						variant={openSection === 'proofs' ? 'secondary' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'proofs' ? null : 'proofs')}
						className="flex-1 gap-1.5 px-2"
						title="Proofs"
					>
						<Coins className="w-4 h-4 shrink-0" />
						<span className="text-xs">{Array.from(proofsByMint.values()).flat().length}</span>
					</Button>
				</div>

				{/* Content panels */}
				{openSection === 'mints' && (
					<div className="space-y-2 pt-2 overflow-hidden border-t">
						{mints.map((mint) => (
							<div key={mint} className="flex items-center justify-between text-sm gap-2">
								<span className="text-muted-foreground truncate min-w-0" title={mint}>
									{new URL(mint).hostname}
								</span>
								<div className="flex items-center gap-1 shrink-0">
									{mintBalances[mint] !== undefined && (
										<span className="text-xs text-muted-foreground">{mintBalances[mint].toLocaleString()}</span>
									)}
									<Button variant="ghost" size="icon" onClick={() => handleRemoveMint(mint)} title="Remove mint" className="h-6 w-6">
										<X className="w-3 h-3" />
									</Button>
								</div>
							</div>
						))}
						<div className="flex gap-2">
							<Input
								type="url"
								value={newMintUrl}
								onChange={(e) => setNewMintUrl(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleAddMint()}
								placeholder="https://mint.example.com"
								className="flex-1 h-8 text-sm min-w-0"
							/>
							<Button variant="secondary" size="sm" onClick={handleAddMint} disabled={!newMintUrl.trim()} className="h-8 px-2 shrink-0">
								<Plus className="w-4 h-4" />
							</Button>
						</div>
						<Button
							variant="primary"
							size="sm"
							onClick={handleSaveWallet}
							disabled={isSaving}
							className="w-full"
							icon={isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
						>
							Save Wallet
						</Button>
					</div>
				)}

				{openSection === 'transactions' && (
					<div className="pt-2 overflow-hidden border-t">
						{transactions.length > 0 ? (
							<div className="space-y-2 max-h-48 overflow-y-auto">
								{transactions.map((tx) => (
									<div key={tx.id} className="flex items-center justify-between text-sm gap-2">
										<div className="flex items-center gap-2 min-w-0">
											{tx.direction === 'in' ? (
												<ArrowDownLeft className="w-4 h-4 text-green-500 shrink-0" />
											) : (
												<ArrowUpRight className="w-4 h-4 text-red-500 shrink-0" />
											)}
											<span className="text-muted-foreground truncate">{new Date(tx.timestamp * 1000).toLocaleDateString()}</span>
										</div>
										<span className={`shrink-0 ${tx.direction === 'in' ? 'text-green-500' : 'text-red-500'}`}>
											{tx.direction === 'in' ? '+' : '-'}
											{tx.amount.toLocaleString()}
										</span>
									</div>
								))}
							</div>
						) : (
							<p className="text-muted-foreground text-sm">No transactions yet</p>
						)}
					</div>
				)}

				{openSection === 'proofs' && (
					<div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden pt-2 border-t">
						{proofsByMint.size === 0 ? (
							<p className="text-sm text-muted-foreground">No proofs in wallet</p>
						) : (
							Array.from(proofsByMint.entries()).map(([mint, proofs]) => (
								<Collapsible key={mint} open={expandedMints.has(mint)} onOpenChange={() => toggleMintExpanded(mint)}>
									<div className="bg-muted/50 rounded-md p-2 overflow-hidden">
										<CollapsibleTrigger asChild>
											<Button variant="ghost" size="sm" className="w-full justify-start gap-2 px-1 h-auto py-1 overflow-hidden">
												<ChevronRight className="w-3 h-3 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
												<span className="font-medium truncate flex-1 text-left min-w-0">{new URL(mint).hostname}</span>
												<span className="text-muted-foreground text-xs shrink-0 whitespace-nowrap">
													{proofs.length} • {proofs.reduce((s, p) => s + p.amount, 0).toLocaleString()}
												</span>
											</Button>
										</CollapsibleTrigger>
										<CollapsibleContent>
											<div className="mt-2 space-y-1 pl-5 overflow-hidden">
												{proofs.map((proof, idx) => (
													<div
														key={`${proof.id}-${proof.secret.slice(0, 8)}-${idx}`}
														className="flex items-center justify-between text-xs bg-background rounded px-2 py-1 gap-2"
													>
														<span className="font-mono text-muted-foreground truncate min-w-0" title={`Keyset: ${proof.id}`}>
															{proof.id.slice(0, 8)}...
														</span>
														<span className="font-medium shrink-0">{proof.amount}</span>
													</div>
												))}
											</div>
										</CollapsibleContent>
									</div>
								</Collapsible>
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
