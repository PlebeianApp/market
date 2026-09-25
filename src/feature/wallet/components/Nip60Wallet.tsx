import { DEFAULT_TRUSTED_MINTS } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { configStore } from '@/lib/stores/config'
import {
	nip60Actions,
	nip60Store,
	NIP60_DEV_TEST_MINTS,
	isNip60WalletDevModeEnabled,
	type PendingNip60Token,
	type Nip60DevAuctionBidResult,
	type Nip60TestMintResult,
} from '@/lib/stores/nip60'
import { cashuActions, cashuStore, type PendingToken } from '@/lib/stores/cashu'
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
	ChevronRight,
	Coins,
	Gavel,
	Clock,
	Eye,
	Copy,
	Check,
	RotateCcw,
	Trash2,
	History,
	Settings2,
	ShieldCheck,
} from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { DepositLightningModal } from './DepositLightningModal'
import { WithdrawLightningModal } from './WithdrawLightningModal'
import { SendEcashModal } from './SendEcashModal'
import { ReceiveEcashModal } from './ReceiveEcashModal'
import { Button } from '@/components/ui/button'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { extractProofsByMint, getMintHostname, type ProofInfo } from '@/lib/wallet'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@/lib/utils'
import { isCocoV2AuctionMode, readCocoV2AuctionEnvironment } from '@/lib/coco/auctions'
import {
	addCocoAuctionTestFunds,
	assertCocoTestFundingAllowed,
	COCO_DEFAULT_FAKE_FUNDING_AMOUNT,
	COCO_MAX_FAKE_FUNDING_AMOUNT,
	getCocoAuctionBalances,
	type CocoAuctionBalanceProjection,
} from '@/lib/coco/runtime'
import { ensureBrowserFreshAuctionsdevPreflight, resetBrowserCocoAuctionTestState } from '@/lib/coco/migration/freshAuctionsdevBrowser'

// Unified pending token type for UI
type UnifiedPendingToken = (PendingToken | PendingNip60Token) & { source: 'cashu' | 'nip60' }

type ModalType = 'deposit' | 'withdraw' | 'send' | 'receive' | null

export function Nip60Wallet() {
	const cocoMode = isCocoV2AuctionMode()
	const { isAuthenticated, user } = useStore(authStore)
	const appStage = useStore(configStore, (state) => state.config.stage)
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
	const [devMintAmount, setDevMintAmount] = useState('1000')
	const [devBidAmount, setDevBidAmount] = useState('')
	const [isDevMinting, setIsDevMinting] = useState(false)
	const [isDevBidding, setIsDevBidding] = useState(false)
	const [lastDevMint, setLastDevMint] = useState<Nip60TestMintResult | null>(null)
	const [lastDevBid, setLastDevBid] = useState<Nip60DevAuctionBidResult | null>(null)
	const walletDevMode = appStage === 'staging' || isNip60WalletDevModeEnabled()
	const defaultMints = useMemo(
		() => Array.from(new Set([...DEFAULT_TRUSTED_MINTS, ...(walletDevMode ? NIP60_DEV_TEST_MINTS : [])])),
		[walletDevMode],
	)
	const [tokenPendingRemoval, setTokenPendingRemoval] = useState<UnifiedPendingToken | null>(null)
	const [cocoBalances, setCocoBalances] = useState<readonly CocoAuctionBalanceProjection[]>([])
	const [isAddingCocoFunds, setIsAddingCocoFunds] = useState(false)
	const [cocoFundingAmount, setCocoFundingAmount] = useState(String(COCO_DEFAULT_FAKE_FUNDING_AMOUNT))
	const [cocoFundingMint, setCocoFundingMint] = useState('')
	const [cocoSetupBlocked, setCocoSetupBlocked] = useState(false)
	const [isResettingCocoTestWallet, setIsResettingCocoTestWallet] = useState(false)

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
		if (cocoMode) return new Map<string, ProofInfo[]>()
		const wallet = nip60Actions.getWallet()
		if (!wallet) return new Map<string, ProofInfo[]>()
		return extractProofsByMint(wallet, mints)
	}, [balance, cocoMode, mints]) // Re-compute when balance or mints change

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
		if (cocoMode || !isAuthenticated || !user?.pubkey) {
			return
		}

		// Initialize wallet if not already initialized
		if (status === 'idle') {
			nip60Actions.initialize(user.pubkey)
		}
	}, [cocoMode, isAuthenticated, user?.pubkey, status])

	useEffect(() => {
		if (!cocoMode || !isAuthenticated || !user?.pubkey) return
		let cancelled = false
		const environmentId = readCocoV2AuctionEnvironment().environmentId
		const refresh = () => {
			if (environmentId !== 'auctionsdev' && environmentId !== 'test') return
			void ensureBrowserFreshAuctionsdevPreflight({ account: user.pubkey, environment: environmentId })
				.then(() => {
					setCocoSetupBlocked(false)
					return getCocoAuctionBalances({ accountPubkey: user.pubkey, environmentId })
				})
				.then((next) => {
					if (!cancelled) setCocoBalances(next)
				})
				.catch(() => {
					if (!cancelled) setCocoSetupBlocked(true)
				})
		}
		refresh()
		window.addEventListener('coco-auction-balance-changed', refresh)
		return () => {
			cancelled = true
			window.removeEventListener('coco-auction-balance-changed', refresh)
		}
	}, [cocoMode, isAuthenticated, user?.pubkey])

	const handleCreateWallet = async () => {
		setIsCreating(true)
		try {
			await nip60Actions.createWallet(defaultMints)
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

	const handleDevMintTestEcash = async () => {
		const amount = Math.floor(parseInt(devMintAmount || '0', 10))
		if (!Number.isFinite(amount) || amount <= 0) {
			toast.error('Mint amount must be a positive number')
			return
		}

		setIsDevMinting(true)
		try {
			const preferredMintUrl = defaultMint || mints[0]
			const result = await nip60Actions.mintTestEcash(amount, preferredMintUrl)
			setLastDevMint(result)
			toast.success(`Minted ${result.amount.toLocaleString()} sats from ${getMintHostname(result.mintUrl)}`)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to mint test ecash')
		} finally {
			setIsDevMinting(false)
		}
	}

	const handleDevBidSeededAuction = async () => {
		const preferredBidAmount = devBidAmount.trim() ? parseInt(devBidAmount.trim(), 10) : undefined
		if (preferredBidAmount !== undefined && (!Number.isFinite(preferredBidAmount) || preferredBidAmount <= 0)) {
			toast.error('Bid amount must be a positive number')
			return
		}

		setIsDevBidding(true)
		try {
			const preferredMintUrl = defaultMint || mints[0]
			const result = await nip60Actions.placeDevBidOnSeededAuction({ preferredBidAmount, preferredMintUrl })
			setLastDevBid(result)
			toast.success(`Bid placed: ${result.bidAmount.toLocaleString()} sats on "${result.auctionTitle}"`)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to place dev bid')
		} finally {
			setIsDevBidding(false)
		}
	}

	const handleConfirmRemovePendingToken = () => {
		if (!tokenPendingRemoval) return
		handleRemovePendingToken(tokenPendingRemoval)
		setTokenPendingRemoval(null)
	}

	const handleClaimFirst = async () => {
		if (!tokenPendingRemoval) return
		const token = tokenPendingRemoval
		setTokenPendingRemoval(null)
		await handleReclaim(token)
	}

	const handleAddCocoFakeFunds = async () => {
		if (!user?.pubkey) {
			toast.error('Sign in before funding the test wallet')
			return
		}
		setIsAddingCocoFunds(true)
		try {
			const environment = readCocoV2AuctionEnvironment()
			const amount = Number(cocoFundingAmount.trim())
			const mintUrl = cocoFundingMint || environment.fakeMintAllowlist[0]
			assertCocoTestFundingAllowed(environment, amount, mintUrl)
			await ensureBrowserFreshAuctionsdevPreflight({ account: user.pubkey, environment: environment.environmentId })
			setCocoSetupBlocked(false)
			await addCocoAuctionTestFunds({ accountPubkey: user.pubkey, environmentId: environment.environmentId }, amount, mintUrl)
			const nextBalances = await getCocoAuctionBalances({ accountPubkey: user.pubkey, environmentId: environment.environmentId })
			setCocoBalances(nextBalances)
			window.dispatchEvent(new Event('coco-auction-balance-changed'))
			toast.success(`${amount.toLocaleString()} fake sats added — ready to test an auction`)
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not fund the test wallet'
			if (message.includes('fresh AuctionsDev preflight blocked')) {
				setCocoSetupBlocked(true)
				toast.error('Old local test data is blocking this wallet. Reset the test wallet, then add funds again.')
			} else {
				toast.error(message)
			}
		} finally {
			setIsAddingCocoFunds(false)
		}
	}

	const handleResetCocoTestWallet = async () => {
		if (!user?.pubkey) {
			toast.error('Sign in before resetting the test wallet')
			return
		}
		setIsResettingCocoTestWallet(true)
		try {
			const environment = readCocoV2AuctionEnvironment()
			await resetBrowserCocoAuctionTestState({ account: user.pubkey, environment: environment.environmentId })
			window.location.reload()
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not reset the test wallet')
			setIsResettingCocoTestWallet(false)
		}
	}

	const classNameGhost = 'text-white/50 hover:bg-white/10 hover:text-white'
	const classNameMuted = 'bg-white/10 text-white hover:bg-white/15'
	const classNameActive = 'bg-white/15 text-white'
	const classNameDestructive = 'bg-transparent hover:bg-red-500/20 text-red-400 hover:text-red-300'
	const walletShell =
		'relative isolate max-w-full overflow-hidden rounded-[1.75rem] border border-white/15 bg-black text-white shadow-[0_28px_80px_rgba(0,0,0,0.72)]'

	if (!isAuthenticated) {
		return (
			<div className={walletShell}>
				<div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_right,rgba(236,72,153,0.22),transparent_62%)]" />
				<div className="relative p-6 text-center">
					<div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-white/10">
						<Coins className="size-6 text-pink-400" />
					</div>
					<p className="font-semibold">Your private Cashu wallet</p>
					<p className="mt-1 text-sm text-white/50">Log in to see your balance and pay for auctions.</p>
				</div>
			</div>
		)
	}

	if (cocoMode) {
		const cocoEnvironment = readCocoV2AuctionEnvironment()
		const selectedCocoMint = cocoEnvironment.fakeMintAllowlist.includes(cocoFundingMint)
			? cocoFundingMint
			: cocoEnvironment.fakeMintAllowlist[0]
		const spendable = cocoBalances.reduce((sum, item) => sum + item.spendable, 0)
		const reserved = cocoBalances.reduce((sum, item) => sum + item.reserved, 0)
		return (
			<div
				className={cn(walletShell, 'p-5 sm:p-6')}
				style={{
					backgroundColor: '#07080a',
					backgroundImage:
						'radial-gradient(circle at 82% 0%, rgba(236, 72, 153, 0.22), transparent 46%), radial-gradient(circle at 12% 12%, rgba(250, 204, 21, 0.1), transparent 34%)',
				}}
			>
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2.5">
						<div className="flex size-10 items-center justify-center rounded-2xl bg-pink-500 text-black shadow-[0_8px_24px_rgba(236,72,153,0.35)]">
							<Coins className="size-5" />
						</div>
						<div>
							<p className="text-[10px] font-semibold tracking-[0.2em] text-white/55">PLEBEIAN CASH</p>
							<p className="text-sm font-semibold">Auction wallet</p>
						</div>
					</div>
					<span className="shrink-0 rounded-full border border-yellow-300/30 bg-yellow-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-yellow-200">
						Fake funds
					</span>
				</div>

				<div className="pb-7 pt-10 text-center">
					<p className="text-xs font-medium uppercase tracking-[0.16em] text-white/45">Available for bids</p>
					<p data-testid="coco-spendable-balance" className="mt-3 text-5xl font-semibold leading-none tracking-[-0.04em] sm:text-[3.5rem]">
						{spendable.toLocaleString()}
						<span className="ml-2 text-base font-medium tracking-normal text-white/45">sats</span>
					</p>
					{reserved > 0 && (
						<p className="mt-4 inline-flex rounded-full border border-amber-300/15 bg-amber-300/10 px-3 py-1.5 text-[11px] font-medium text-amber-200">
							{reserved.toLocaleString()} sats held for active bids
						</p>
					)}
				</div>

				<div className="rounded-2xl border border-white/10 p-3.5" style={{ backgroundColor: '#141519' }}>
					<div className="mb-3 flex items-center gap-2.5">
						<span className="flex size-9 items-center justify-center rounded-xl bg-yellow-300 text-black">
							<Zap className="size-4 fill-current" />
						</span>
						<div>
							<p className="text-sm font-semibold">Fund with test mint</p>
							<p className="text-[11px] text-white/45">Choose any amount of fake sats for auction testing</p>
						</div>
					</div>
					<div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5">
						<div className="min-w-0">
							<p className="text-[10px] font-medium uppercase tracking-wide text-white/40">Testnet mint</p>
							<p className="truncate text-xs font-semibold text-white">{getMintHostname(selectedCocoMint)}</p>
						</div>
						{cocoEnvironment.fakeMintAllowlist.length > 1 && (
							<Select value={selectedCocoMint} onValueChange={setCocoFundingMint}>
								<SelectTrigger
									aria-label="Cashu testnet mint"
									className="h-9 w-36 rounded-lg border-white/10 bg-white/5 text-xs text-white"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{cocoEnvironment.fakeMintAllowlist.map((mintUrl) => (
										<SelectItem key={mintUrl} value={mintUrl}>
											{getMintHostname(mintUrl)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
					<div className="flex gap-2">
						<div className="relative min-w-0 flex-1">
							<Input
								aria-label="Fake sats amount"
								data-testid="coco-test-funding-amount"
								type="number"
								inputMode="numeric"
								min={1}
								max={COCO_MAX_FAKE_FUNDING_AMOUNT}
								step={1}
								value={cocoFundingAmount}
								onChange={(event) => setCocoFundingAmount(event.target.value)}
								disabled={isAddingCocoFunds}
								className="h-12 rounded-xl border-white/10 bg-black pr-12 text-lg font-semibold text-white placeholder:text-white/25 focus-visible:border-yellow-300/60 focus-visible:ring-yellow-300/20"
								style={{ backgroundColor: '#08090c' }}
							/>
							<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-white/35">sats</span>
						</div>
						<Button
							aria-label="Add fake sats from test mint"
							data-testid="coco-test-fund-button"
							className="h-12 shrink-0 rounded-xl bg-yellow-300 px-4 font-semibold text-black shadow-[0_12px_28px_rgba(250,204,21,0.16)] hover:bg-yellow-200"
							onClick={() => void handleAddCocoFakeFunds()}
							disabled={isAddingCocoFunds || !cocoFundingAmount.trim()}
						>
							{isAddingCocoFunds ? <Loader2 className="size-4 animate-spin" /> : 'Add funds'}
						</Button>
					</div>
					<p className="mt-2 text-[10px] text-white/35">Test only · 1–{COCO_MAX_FAKE_FUNDING_AMOUNT.toLocaleString()} sats per top-up</p>
				</div>

				{cocoSetupBlocked && (
					<div className="mt-3 rounded-2xl border border-yellow-300/25 bg-yellow-300/10 p-3.5">
						<p className="text-sm font-semibold text-yellow-100">Fresh test setup required</p>
						<p className="mt-1 text-[11px] leading-relaxed text-yellow-100/65">
							This browser has older fake-wallet or interrupted auction data. Resetting removes local Coco test data only; real funds are
							never involved.
						</p>
						<Button
							data-testid="coco-reset-test-wallet"
							className="mt-3 h-10 w-full rounded-xl bg-yellow-300 font-semibold text-black hover:bg-yellow-200"
							onClick={() => void handleResetCocoTestWallet()}
							disabled={isResettingCocoTestWallet || isAddingCocoFunds}
						>
							{isResettingCocoTestWallet ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
							Reset test wallet
						</Button>
					</div>
				)}

				<Button
					aria-label="Receive fake eCash"
					className="mt-3 h-12 w-full rounded-2xl border border-white/12 bg-black font-semibold text-white shadow-none hover:bg-white/10"
					style={{ backgroundColor: '#17181c' }}
					onClick={() => setOpenModal('receive')}
				>
					<QrCode className="size-5 text-pink-400" />
					Receive eCash token
				</Button>

				<div
					className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-3.5 py-3 text-xs"
					style={{ backgroundColor: '#111216' }}
				>
					<span className={cn('flex items-center gap-2 font-medium', cocoSetupBlocked ? 'text-yellow-200' : 'text-emerald-300')}>
						<span
							className={cn(
								'size-2 rounded-full',
								cocoSetupBlocked ? 'bg-yellow-300' : 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.75)]',
							)}
						/>
						<ShieldCheck className="size-4" /> {cocoSetupBlocked ? 'Reset required' : 'Ready to test bids'}
					</span>
					<span className="shrink-0 text-white/40">{cocoEnvironment.environmentId} · fake sats</span>
				</div>
				<ReceiveEcashModal open={openModal === 'receive'} onClose={() => setOpenModal(null)} />
			</div>
		)
	}

	if (status === 'idle' || status === 'initializing') {
		return (
			<div className={cn(walletShell, 'flex min-h-44 items-center justify-center')}>
				<Loader2 className="size-6 animate-spin text-pink-400" />
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className={cn(walletShell, 'p-6 text-center')}>
				<p className="font-medium text-red-300">Wallet unavailable</p>
				<p className="mt-1 text-sm text-white/50">{error}</p>
			</div>
		)
	}

	if (status === 'no_wallet') {
		return (
			<div className={walletShell}>
				<div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_right,rgba(236,72,153,0.25),transparent_62%)]" />
				<div className="relative p-6 text-center">
					<div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-pink-500 text-black">
						<Coins className="size-6" />
					</div>
					<p className="font-semibold">Create your private wallet</p>
					<p className="mx-auto mt-1 max-w-64 text-sm text-white/50">Pay and get paid with Cashu, right inside Plebeian Market.</p>
					<Button
						onClick={handleCreateWallet}
						disabled={isCreating}
						className="mt-5 h-11 w-full rounded-xl bg-pink-500 font-semibold text-black hover:bg-pink-400"
					>
						{isCreating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
						Create wallet
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className={cn(walletShell, 'p-4')}>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2.5">
					<div className="flex size-9 items-center justify-center rounded-xl bg-pink-500 text-black shadow-[0_8px_24px_rgba(236,72,153,0.3)]">
						<Coins className="size-5" />
					</div>
					<div>
						<p className="text-[10px] font-semibold tracking-[0.18em] text-white/45">PLEBEIAN CASH</p>
						<p className="text-sm font-semibold">Private Cashu wallet</p>
					</div>
				</div>
				<Button
					className={cn(classNameGhost, 'size-9 rounded-xl')}
					size="icon"
					onClick={handleRefresh}
					disabled={isRefreshing}
					title="Refresh & sync wallet"
				>
					<RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} />
				</Button>
			</div>

			<div className="pb-5 pt-8 text-center">
				<p className="text-xs font-medium text-white/45">Available balance</p>
				<p className="mt-1 text-[2.5rem] font-bold leading-none tracking-tight">
					{balance.toLocaleString()}
					<span className="ml-2 text-base font-medium text-white/45">sats</span>
				</p>
				{defaultMint && (
					<p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/55">
						<ShieldCheck className="size-3.5 text-emerald-300" /> {getMintHostname(defaultMint)}
					</p>
				)}
			</div>

			<div className="mb-5 grid grid-cols-4 gap-1">
				<Button
					aria-label="Deposit"
					className="h-auto flex-col gap-2 bg-transparent px-1 py-1.5 text-[11px] font-medium text-white/70 hover:bg-transparent hover:text-white"
					onClick={() => setOpenModal('deposit')}
				>
					<span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-400 text-black transition-transform hover:scale-105">
						<Zap className="size-5" />
					</span>
					Add
				</Button>
				<Button
					aria-label="Send eCash"
					className="h-auto flex-col gap-2 bg-transparent px-1 py-1.5 text-[11px] font-medium text-white/70 hover:bg-transparent hover:text-white"
					onClick={() => setOpenModal('send')}
					disabled={balance === 0}
				>
					<span className="flex size-12 items-center justify-center rounded-2xl bg-pink-500 text-black transition-transform hover:scale-105">
						<ArrowUpRight className="size-5" />
					</span>
					Send
				</Button>
				<Button
					aria-label="Receive eCash"
					className="h-auto flex-col gap-2 bg-transparent px-1 py-1.5 text-[11px] font-medium text-white/70 hover:bg-transparent hover:text-white"
					onClick={() => setOpenModal('receive')}
				>
					<span className="flex size-12 items-center justify-center rounded-2xl bg-yellow-300 text-black transition-transform hover:scale-105">
						<ArrowDownLeft className="size-5" />
					</span>
					Receive
				</Button>
				<Button
					aria-label="Withdraw"
					className="h-auto flex-col gap-2 bg-transparent px-1 py-1.5 text-[11px] font-medium text-white/70 hover:bg-transparent hover:text-white"
					onClick={() => setOpenModal('withdraw')}
					disabled={balance === 0}
				>
					<span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-white transition-transform hover:scale-105">
						<Landmark className="size-5" />
					</span>
					Cash out
				</Button>
			</div>

			<div className="space-y-1.5">
				<Button
					className={cn(
						'w-full justify-start gap-3 rounded-xl border border-white/[0.07] px-3 py-3 text-white hover:bg-white/10',
						openSection === 'transactions' ? 'bg-white/10' : 'bg-white/[0.04]',
					)}
					onClick={() => setOpenSection(openSection === 'transactions' ? null : 'transactions')}
				>
					<span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.07]">
						<History className="size-4" />
					</span>
					<span className="flex-1 text-left text-sm font-medium">Activity</span>
					<span className="text-xs text-white/35">{transactions.length}</span>
					<ChevronRight className={cn('size-4 text-white/30 transition-transform', openSection === 'transactions' && 'rotate-90')} />
				</Button>
				{activePendingTokens.length > 0 && (
					<Button
						className={cn(
							'w-full justify-start gap-3 rounded-xl border border-amber-300/10 px-3 py-3 text-white hover:bg-white/10',
							openSection === 'pending' ? 'bg-white/10' : 'bg-amber-300/[0.04]',
						)}
						onClick={() => setOpenSection(openSection === 'pending' ? null : 'pending')}
					>
						<span className="flex size-8 items-center justify-center rounded-lg bg-amber-300/10 text-amber-200">
							<Clock className="size-4" />
						</span>
						<span className="flex-1 text-left text-sm font-medium">Pending sends</span>
						<span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-xs text-amber-200">{activePendingTokens.length}</span>
						<ChevronRight className={cn('size-4 text-white/30 transition-transform', openSection === 'pending' && 'rotate-90')} />
					</Button>
				)}
				<Button
					className={cn(
						'w-full justify-start gap-3 rounded-xl border border-white/[0.07] px-3 py-3 text-white hover:bg-white/10',
						openSection === 'mints' || openSection === 'proofs' ? 'bg-white/10' : 'bg-white/[0.04]',
					)}
					onClick={() => setOpenSection(openSection === 'mints' ? null : 'mints')}
				>
					<span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.07]">
						<Settings2 className="size-4" />
					</span>
					<span className="flex-1 text-left text-sm font-medium">Wallet settings</span>
					<ChevronRight className={cn('size-4 text-white/30 transition-transform', openSection === 'mints' && 'rotate-90')} />
				</Button>
			</div>

			<div className="overflow-hidden">
				{/* Content panels */}
				{openSection === 'mints' && (
					<div className="mt-3 space-y-3 rounded-xl border border-white/[0.07] bg-black/25 p-3">
						<div>
							<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">Default mint</p>
							{mints.length > 0 ? (
								<Select value={defaultMint ?? ''} onValueChange={(value) => nip60Actions.setDefaultMint(value || null)}>
									<SelectTrigger className="w-full border-white/10 bg-white/[0.06] text-white hover:bg-white/10">
										<SelectValue placeholder="Choose a mint">
											{defaultMint ? (
												<span className="flex items-center gap-2 truncate">
													<Star className="size-3.5 shrink-0 fill-current text-yellow-300" />
													<span className="truncate">{getMintHostname(defaultMint)}</span>
												</span>
											) : (
												'Choose a mint'
											)}
										</SelectValue>
									</SelectTrigger>
									<SelectContent className="max-w-[calc(100vw-2rem)] border-white/20 bg-[#15151a]">
										{mints.map((mint) => (
											<SelectItem key={mint} value={mint} className="text-white focus:bg-white/10 focus:text-white">
												<div className="flex items-center gap-2">
													<Landmark className="size-4 shrink-0" />
													<span className="truncate">{getMintHostname(mint)}</span>
													<span className="text-white/40">{(mintBalances[mint] ?? 0).toLocaleString()}</span>
												</div>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : (
								<p className="text-sm text-white/45">No mints configured</p>
							)}
						</div>

						<div className="border-t border-white/[0.07] pt-3">
							<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">Trusted mints</p>
							{mints.map((mint) => (
								<div key={mint} className="flex items-center justify-between gap-2 py-1 text-sm">
									<span className="min-w-0 truncate text-white/70" title={mint}>
										{getMintHostname(mint)}
									</span>
									<div className="flex shrink-0 items-center gap-1">
										<span className="text-xs text-white/35">{(mintBalances[mint] ?? 0).toLocaleString()} sats</span>
										<Button className={cn(classNameGhost, 'size-7')} size="icon" onClick={() => handleRemoveMint(mint)} title="Remove mint">
											<X className="size-3" />
										</Button>
									</div>
								</div>
							))}
						</div>
						<div className="flex gap-2">
							<Input
								type="url"
								value={newMintUrl}
								onChange={(e) => setNewMintUrl(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleAddMint()}
								placeholder="https://mint.example.com"
								className="h-9 min-w-0 flex-1 border-white/10 bg-white/[0.06] text-sm text-white placeholder:text-white/25"
							/>
							<Button className={cn(classNameMuted, 'h-9 shrink-0 px-3')} size="sm" onClick={handleAddMint} disabled={!newMintUrl.trim()}>
								<Plus className="w-4 h-4" />
							</Button>
						</div>
						<Button className={cn(classNameActive, 'w-full rounded-lg')} size="sm" onClick={handleSaveWallet} disabled={isSaving}>
							{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
							Save Wallet
						</Button>

						<Button
							className="w-full justify-between rounded-lg bg-transparent px-2 text-xs text-white/45 hover:bg-white/[0.06] hover:text-white"
							size="sm"
							onClick={() => setOpenSection('proofs')}
						>
							<span className="flex items-center gap-2">
								<Coins className="size-3.5" /> Cashu proof details
							</span>
							<span>{Array.from(proofsByMint.values()).flat().length}</span>
						</Button>

						{walletDevMode && (
							<details className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] p-3">
								<summary className="cursor-pointer text-xs font-semibold text-amber-200">Auction test tools</summary>
								<div className="mt-3 space-y-2">
									<p className="text-[11px] leading-relaxed text-amber-100/60">For seeded auctions and local test mints.</p>
									<div className="flex gap-2">
										<Input
											type="number"
											min={1}
											step={1}
											value={devMintAmount}
											onChange={(e) => setDevMintAmount(e.target.value)}
											placeholder="Mint sats"
											className="h-8 border-white/10 bg-white/[0.06] text-sm text-white placeholder:text-white/25"
										/>
										<Button
											variant="dark-active"
											size="sm"
											onClick={() => void handleDevMintTestEcash()}
											disabled={isDevMinting}
											icon={isDevMinting ? <Loader2 className="size-3.5 animate-spin" /> : <Coins className="size-3.5" />}
										>
											Mint test
										</Button>
									</div>
									<div className="flex gap-2">
										<Input
											type="number"
											min={1}
											step={1}
											value={devBidAmount}
											onChange={(e) => setDevBidAmount(e.target.value)}
											placeholder="Bid sats (optional)"
											className="h-8 border-white/10 bg-white/[0.06] text-sm text-white placeholder:text-white/25"
										/>
										<Button
											variant="dark-active"
											size="sm"
											onClick={() => void handleDevBidSeededAuction()}
											disabled={isDevBidding}
											icon={isDevBidding ? <Loader2 className="size-3.5 animate-spin" /> : <Gavel className="size-3.5" />}
										>
											Bid seeded
										</Button>
									</div>
									{lastDevMint && (
										<p className="text-[11px] text-amber-100/70">
											Last mint: {lastDevMint.amount.toLocaleString()} sats via {getMintHostname(lastDevMint.mintUrl)}
										</p>
									)}
									{lastDevBid && (
										<p className="break-words text-[11px] text-amber-100/70">
											Last bid: {lastDevBid.bidAmount.toLocaleString()} sats on {lastDevBid.auctionTitle}
										</p>
									)}
								</div>
							</details>
						)}
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
										onClick={() => setTokenPendingRemoval(token)}
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

			{/* Remove Pending Token Confirmation */}
			<AlertDialog open={tokenPendingRemoval !== null} onOpenChange={(isOpen) => !isOpen && setTokenPendingRemoval(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove token from list?</AlertDialogTitle>
						<AlertDialogDescription>
							This token is a bearer instrument worth {tokenPendingRemoval?.amount.toLocaleString()} sats. Removing it from the list does
							not reclaim the funds — if the token has not been claimed yet, removing it may make those funds unreachable. Consider claiming
							it first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={handleConfirmRemovePendingToken}>
							Remove anyway
						</AlertDialogAction>
						<Button variant="outline" onClick={handleClaimFirst} disabled={isReclaiming === tokenPendingRemoval?.id}>
							{isReclaiming === tokenPendingRemoval?.id ? (
								<Loader2 className="mr-2 w-4 h-4 animate-spin" />
							) : (
								<RotateCcw className="mr-2 w-4 h-4" />
							)}
							Claim first
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
