import { authStore } from '@/lib/stores/auth'
import { nip60Actions, nip60Store, type PendingNip60Token } from '@/lib/stores/nip60'
import { cashuActions, cashuStore, type PendingToken } from '@/lib/stores/cashu'
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
	Clock,
	Eye,
	Copy,
	Check,
	RotateCcw,
	Trash2,
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
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { extractProofsByMint, getMintHostname, type ProofInfo } from '@/lib/wallet'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@/lib/utils'

// Unified pending token type for UI
type UnifiedPendingToken = (PendingToken | PendingNip60Token) & { source: 'cashu' | 'nip60' }

// Default mints for new wallets
const DEFAULT_MINTS = ['https://mint.minibits.cash/Bitcoin', 'https://mint.coinos.io', 'https://mint.cubabitcoin.org']

type ModalType = 'deposit' | 'withdraw' | 'send' | 'receive' | null

export function Nip60Wallet() {
	const { isAuthenticated, user } = useStore(authStore)
	const { status, balance, mintBalances, mints, defaultMint, transactions, error, pendingTokens: nip60PendingTokens } = useStore(nip60Store)
	const { pendingTokens: cashuPendingTokens } = useStore(cashuStore)
	const [isCreating, setIsCreating] = useState(false)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [isSaving, setIsSaving] = useState(false)
	const [openModal, setOpenModal] = useState<ModalType>(null)
	const [openSection, setOpenSection] = useState<'mints' | 'transactions' | 'proofs' | 'pending' | null>(null)
	const [expandedMints, setExpandedMints] = useState<Set<string>>(new Set())
	const [viewingToken, setViewingToken] = useState<UnifiedPendingToken | null>(null)
	const [isReclaiming, setIsReclaiming] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	// Combine pending tokens from both stores
	const activePendingTokens: UnifiedPendingToken[] = useMemo(
		() =>
			[
				...cashuPendingTokens.filter((t) => t.status === 'pending').map((t) => ({ ...t, source: 'cashu' as const })),
				...nip60PendingTokens.filter((t) => t.status === 'pending').map((t) => ({ ...t, source: 'nip60' as const })),
			].sort((a, b) => b.createdAt - a.createdAt),
		[cashuPendingTokens, nip60PendingTokens],
	)

	// Get proofs from wallet state using shared utility
	const proofsByMint = useMemo(() => {
		const wallet = nip60Actions.getWallet()
		if (!wallet) return new Map<string, ProofInfo[]>()
		return extractProofsByMint(wallet, mints)
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

	const handleCopyToken = async (tokenString: string) => {
		try {
			await navigator.clipboard.writeText(tokenString)
			setCopied(true)
			toast.success('Token copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy token')
		}
	}

	const handleReclaim = async (pendingToken: UnifiedPendingToken) => {
		setIsReclaiming(pendingToken.id)
		try {
			let success: boolean
			if (pendingToken.source === 'cashu') {
				success = await cashuActions.reclaimToken(pendingToken.id)
			} else {
				success = await nip60Actions.reclaimToken(pendingToken.id)
			}
			if (success) {
				toast.success('Token reclaimed! Funds returned to wallet.')
			} else {
				toast.info('Token already claimed by recipient')
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to reclaim token'
			toast.error(message)
		} finally {
			setIsReclaiming(null)
		}
	}

	const handleRemovePendingToken = (token: UnifiedPendingToken) => {
		if (token.source === 'cashu') {
			cashuActions.removePendingToken(token.id)
		} else {
			nip60Actions.removePendingToken(token.id)
		}
		toast.success('Token removed from history')
	}

	// Button appearance class definitions

	const classNameGhost = 'hover:bg-white/10 text-gray-400 hover:text-white'
	const classNameSubtle = 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
	const classNameMuted = 'bg-white/10 hover:bg-white/20 text-white'
	const classNameActive = 'bg-white/20 text-white'
	const classNameSuccess = 'bg-green-600 hover:bg-green-700 text-white'
	const classNameWarning = 'bg-orange-600 hover:bg-orange-700 text-white'
	const classNameDestructive = 'bg-transparent hover:bg-red-500/20 text-red-400 hover:text-red-300'

	if (!isAuthenticated) {
		return (
			<div className="bg-primary p-4 rounded-lg text-gray-400 text-center">
				<p>Please log in to view your wallet</p>
			</div>
		)
	}

	if (status === 'idle' || status === 'initializing') {
		return (
			<div className="flex justify-center items-center bg-primary p-4 rounded-lg">
				<Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className="bg-primary p-4 rounded-lg text-red-400 text-center">
				<p>{error}</p>
			</div>
		)
	}

	if (status === 'no_wallet') {
		return (
			<div className="bg-primary p-4 rounded-lg w-80 text-center">
				<p className="mb-4 text-gray-400">No Cashu wallet found</p>
				<Button onClick={handleCreateWallet} disabled={isCreating} variant="secondary">
					{isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
					Create Wallet
				</Button>
			</div>
		)
	}

	return (
		<div className="bg-primary p-4 rounded-lg max-w-full overflow-hidden text-white">
			<div className="relative mb-4 text-center">
				<div className="top-0 right-0 absolute flex gap-1">
					<Button className={classNameGhost} size="icon" onClick={handleRefresh} disabled={isRefreshing} title="Refresh & sync wallet">
						<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
					</Button>
				</div>
				<p className="mb-1 text-gray-400 text-sm">Balance</p>
				<p className="font-bold text-white text-2xl">{balance.toLocaleString()} sats</p>
			</div>

			{/* Action Buttons */}
			<div className="gap-2 grid grid-cols-2 mb-4">
				<Button className={classNameSuccess} size="sm" onClick={() => setOpenModal('deposit')}>
					<Zap className="w-4 h-4" />
					Deposit
				</Button>
				<Button className={classNameWarning} size="sm" onClick={() => setOpenModal('withdraw')} disabled={balance === 0}>
					<Zap className="w-4 h-4" />
					Withdraw
				</Button>
				<Button className={classNameMuted} size="sm" onClick={() => setOpenModal('receive')}>
					<QrCode className="w-4 h-4" />
					Receive eCash
				</Button>
				<Button className={classNameMuted} size="sm" onClick={() => setOpenModal('send')} disabled={balance === 0}>
					<Send className="w-4 h-4" />
					Send eCash
				</Button>
			</div>

			{/* Default Mint Selector */}
			<div className="mb-2 pt-2 overflow-hidden">
				<p className="mb-2 font-medium text-gray-300 text-sm">Default Mint</p>
				{mints.length > 0 ? (
					<Select value={defaultMint ?? ''} onValueChange={(value) => nip60Actions.setDefaultMint(value || null)}>
						<SelectTrigger className="bg-white/10 hover:bg-white/15 border-white/20 w-full text-white">
							<SelectValue placeholder="Select a default mint">
								{defaultMint ? (
									<span className="flex items-center gap-2 truncate">
										<Star className="fill-current w-4 h-4 text-yellow-500 shrink-0" />
										<span className="truncate">{getMintHostname(defaultMint)}</span>
										{mintBalances[defaultMint] !== undefined && (
											<span className="text-gray-400 shrink-0">({mintBalances[defaultMint].toLocaleString()})</span>
										)}
									</span>
								) : (
									'Select a default mint'
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="bg-primary border-white/20 max-w-[calc(100vw-2rem)]">
							{mints.map((mint) => (
								<SelectItem key={mint} value={mint} className="hover:bg-white/10 focus:bg-white/10 text-white focus:text-white">
									<div className="flex items-center gap-2">
										<Landmark className="w-4 h-4 shrink-0" />
										<span className="truncate">{getMintHostname(mint)}</span>
										{mintBalances[mint] !== undefined && (
											<span className="text-gray-400 shrink-0">({mintBalances[mint].toLocaleString()})</span>
										)}
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<p className="text-gray-400 text-sm">No mints configured</p>
				)}
			</div>

			{/* Toggle Row: Mints, Transactions, Proofs */}
			<div className="pt-2 overflow-hidden">
				{/* Toggle buttons row */}
				<div className="flex gap-1 mb-2">
					<Button
						className={cn(openSection === 'mints' ? classNameActive : classNameSubtle, 'flex-1 gap-1.5 px-2')}
						size="sm"
						onClick={() => setOpenSection(openSection === 'mints' ? null : 'mints')}
						title="Manage mints"
					>
						<Landmark className="w-4 h-4 shrink-0" />
						<span className="text-xs">{mints.length}</span>
					</Button>
					<Button
						className={cn(openSection === 'transactions' ? classNameActive : classNameSubtle, 'flex-1 gap-1.5 px-2')}
						size="sm"
						onClick={() => setOpenSection(openSection === 'transactions' ? null : 'transactions')}
						title="Transactions"
					>
						<ArrowUpDown className="w-4 h-4 shrink-0" />
						<span className="text-xs">{transactions.length}</span>
					</Button>
					<Button
						className={cn(openSection === 'transactions' ? classNameActive : classNameSubtle, 'flex-1 gap-1.5 px-2')}
						size="sm"
						onClick={() => setOpenSection(openSection === 'proofs' ? null : 'proofs')}
						title="Proofs"
					>
						<Coins className="w-4 h-4 shrink-0" />
						<span className="text-xs">{Array.from(proofsByMint.values()).flat().length}</span>
					</Button>
					{activePendingTokens.length > 0 && (
						<Button
							className={cn(openSection === 'transactions' ? classNameActive : classNameSubtle, 'flex-1 gap-1.5 px-2')}
							size="sm"
							onClick={() => setOpenSection(openSection === 'pending' ? null : 'pending')}
							title="Pending tokens"
						>
							<Clock className="w-4 h-4 shrink-0" />
							<span className="text-xs">{activePendingTokens.length}</span>
						</Button>
					)}
				</div>

				{/* Content panels */}
				{openSection === 'mints' && (
					<div className="space-y-2 pt-2 border-white/10 border-t overflow-hidden">
						{mints.map((mint) => (
							<div key={mint} className="flex justify-between items-center gap-2 text-sm">
								<span className="min-w-0 text-gray-300 truncate" title={mint}>
									{getMintHostname(mint)}
								</span>
								<div className="flex items-center gap-1 shrink-0">
									{mintBalances[mint] !== undefined && <span className="text-gray-400 text-xs">{mintBalances[mint].toLocaleString()}</span>}
									<Button className={cn(classNameGhost, 'w-6 h-6')} size="icon" onClick={() => handleRemoveMint(mint)} title="Remove mint">
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
								className="flex-1 bg-white/10 border-white/20 min-w-0 h-8 text-white placeholder:text-gray-500 text-sm"
							/>
							<Button className={cn(classNameMuted, 'px-2 h-8 shrink-0')} size="sm" onClick={handleAddMint} disabled={!newMintUrl.trim()}>
								<Plus className="w-4 h-4" />
							</Button>
						</div>
						<Button className={cn(classNameActive, 'w-full')} size="sm" onClick={handleSaveWallet} disabled={isSaving}>
							{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
							Save Wallet
						</Button>
					</div>
				)}

				{openSection === 'transactions' && (
					<div className="pt-2 border-white/10 border-t overflow-hidden">
						{transactions.length > 0 ? (
							<div className="space-y-2 max-h-48 overflow-y-auto">
								{transactions.map((tx) => (
									<div key={tx.id} className="flex justify-between items-center gap-2 text-sm">
										<div className="flex items-center gap-2 min-w-0">
											{tx.direction === 'in' ? (
												<ArrowDownLeft className="w-4 h-4 text-green-400 shrink-0" />
											) : (
												<ArrowUpRight className="w-4 h-4 text-red-400 shrink-0" />
											)}
											<span className="text-gray-400 truncate">{new Date(tx.timestamp * 1000).toLocaleDateString()}</span>
										</div>
										<span className={`shrink-0 ${tx.direction === 'in' ? 'text-green-400' : 'text-red-400'}`}>
											{tx.direction === 'in' ? '+' : '-'}
											{tx.amount.toLocaleString()}
										</span>
									</div>
								))}
							</div>
						) : (
							<p className="text-gray-400 text-sm">No transactions yet</p>
						)}
					</div>
				)}

				{openSection === 'proofs' && (
					<div className="space-y-2 pt-2 border-white/10 border-t max-h-48 overflow-x-hidden overflow-y-auto">
						{proofsByMint.size === 0 ? (
							<p className="text-gray-400 text-sm">No proofs in wallet</p>
						) : (
							Array.from(proofsByMint.entries()).map(([mint, proofs]) => (
								<Collapsible key={mint} open={expandedMints.has(mint)} onOpenChange={() => toggleMintExpanded(mint)}>
									<div className="bg-white/5 p-2 rounded-md overflow-hidden">
										<CollapsibleTrigger asChild>
											<Button className={cn(classNameGhost, 'justify-start gap-2 px-1 py-1 w-full h-auto overflow-hidden')} size="sm">
												<ChevronRight className="w-3 h-3 [[data-state=open]>&]:rotate-90 transition-transform shrink-0" />
												<span className="flex-1 min-w-0 font-medium text-white text-left truncate">{getMintHostname(mint)}</span>
												<span className="text-gray-400 text-xs whitespace-nowrap shrink-0">
													{proofs.length} • {proofs.reduce((s, p) => s + p.amount, 0).toLocaleString()}
												</span>
											</Button>
										</CollapsibleTrigger>
										<CollapsibleContent>
											<div className="space-y-1 mt-2 pl-5 overflow-hidden">
												{proofs.map((proof, idx) => (
													<div
														key={`${proof.id}-${proof.secret.slice(0, 8)}-${idx}`}
														className="flex justify-between items-center gap-2 bg-white/10 px-2 py-1 rounded text-xs"
													>
														<span className="min-w-0 font-mono text-gray-400 truncate" title={`Keyset: ${proof.id}`}>
															{proof.id.slice(0, 8)}...
														</span>
														<span className="font-medium text-white shrink-0">{proof.amount}</span>
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

				{openSection === 'pending' && (
					<div className="space-y-2 pt-2 border-white/10 border-t max-h-48 overflow-y-auto">
						{activePendingTokens.map((token) => (
							<div key={token.id} className="flex justify-between items-center gap-2 bg-white/5 p-2 rounded-lg">
								<div className="min-w-0">
									<p className="font-medium text-white text-sm">{token.amount.toLocaleString()} sats</p>
									<p className="text-gray-400 text-xs truncate">
										{getMintHostname(token.mintUrl)} • {new Date(token.createdAt).toLocaleDateString()}
									</p>
								</div>
								<div className="flex gap-0.5 shrink-0">
									<Button className={cn(classNameGhost, 'w-7 h-7')} size="icon" onClick={() => setViewingToken(token)} title="View token">
										<Eye className="w-3.5 h-3.5" />
									</Button>
									<Button
										className={cn(classNameGhost, 'w-7 h-7')}
										size="icon"
										onClick={() => handleCopyToken(token.token)}
										title="Copy token"
									>
										<Copy className="w-3.5 h-3.5" />
									</Button>
									<Button
										className={cn(classNameGhost, 'w-7 h-7')}
										size="icon"
										onClick={() => handleReclaim(token)}
										disabled={isReclaiming === token.id}
										title="Try to reclaim"
									>
										{isReclaiming === token.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
									</Button>
									<Button
										className={cn(classNameDestructive, 'w-7 h-7')}
										size="icon"
										onClick={() => handleRemovePendingToken(token)}
										title="Remove from list"
									>
										<Trash2 className="w-3.5 h-3.5" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Modals */}
			<DepositLightningModal open={openModal === 'deposit'} onClose={() => setOpenModal(null)} />
			<WithdrawLightningModal open={openModal === 'withdraw'} onClose={() => setOpenModal(null)} />
			<SendEcashModal open={openModal === 'send'} onClose={() => setOpenModal(null)} />
			<ReceiveEcashModal open={openModal === 'receive'} onClose={() => setOpenModal(null)} />

			{/* Pending Token Detail Modal */}
			<Dialog open={viewingToken !== null} onOpenChange={(isOpen) => !isOpen && setViewingToken(null)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Send className="w-5 h-5 text-purple-500" />
							Pending Token
						</DialogTitle>
						<DialogDescription>
							{viewingToken?.amount.toLocaleString()} sats • {viewingToken ? getMintHostname(viewingToken.mintUrl) : ''}
						</DialogDescription>
					</DialogHeader>

					{viewingToken && (
						<div className="space-y-4">
							<div className="flex justify-center">
								<div className="bg-white p-4 rounded-lg">
									<QRCodeSVG value={viewingToken.token} size={200} />
								</div>
							</div>
							<div className="space-y-2">
								<p className="font-medium text-sm">Cashu Token</p>
								<textarea
									value={viewingToken.token}
									readOnly
									className="bg-muted px-3 py-2 rounded-md w-full h-24 font-mono text-sm resize-none"
								/>
								<div className="flex justify-end">
									<Button variant="outline" size="sm" onClick={() => handleCopyToken(viewingToken.token)} className="gap-2">
										{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
										{copied ? 'Copied!' : 'Copy Token'}
									</Button>
								</div>
							</div>
							<p className="text-muted-foreground text-xs text-center">Created {new Date(viewingToken.createdAt).toLocaleString()}</p>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									onClick={() => {
										handleReclaim(viewingToken)
										setViewingToken(null)
									}}
									disabled={isReclaiming === viewingToken.id}
								>
									{isReclaiming === viewingToken.id ? (
										<Loader2 className="mr-2 w-4 h-4 animate-spin" />
									) : (
										<RotateCcw className="mr-2 w-4 h-4" />
									)}
									Reclaim
								</Button>
								<Button onClick={() => setViewingToken(null)}>Close</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	)
}
