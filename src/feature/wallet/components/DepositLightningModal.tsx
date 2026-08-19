import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'
import { ndkActions } from '@/lib/stores/ndk'
import { useWallets, walletActions } from '@/lib/stores/wallet'
import { useStore } from '@tanstack/react-store'
import { Loader2, Copy, Check, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { getMintHostname, normalizeMintUrl } from '@/lib/wallet'

const isValidMintUrl = (mintUrl: string): boolean => {
	const normalizedMintUrl = normalizeMintUrl(mintUrl)
	if (!normalizedMintUrl) return false
	try {
		new URL(normalizedMintUrl)
		return true
	} catch {
		return false
	}
}

const normalizeValidMintUrl = (mintUrl: string): string | null => {
	const normalizedMintUrl = normalizeMintUrl(mintUrl)
	return isValidMintUrl(normalizedMintUrl) ? normalizedMintUrl : null
}

interface DepositLightningModalProps {
	open: boolean
	onClose: () => void
	initialAmount?: number
	preferredMint?: string
	allowedMints?: string[]
	onSuccess?: () => void
	onInvoiceCreated?: (invoice: string) => void
	onPaymentAcknowledged?: () => void
	onMintingStarted?: () => void
	onFundingFailed?: (reason: AuctionFundingFailureReason) => void
	/**
	 * 'bid' renders the compact "Bid with lightning" quick-pay view: fixed
	 * (non-editable) amount, auto-generated QR once a mint resolves, and a
	 * "Top up your wallet" escape hatch into the classic form below.
	 */
	variant?: 'bid' | 'topup'
}

export type AuctionFundingFailureReason = 'invoice_unpaid_or_expired_reclaimable' | 'invoice_paid_mint_failed_reclaimable'

type NwcDepositPaymentStatus = 'idle' | 'paying' | 'sent'

export function DepositLightningModal({
	open,
	onClose,
	initialAmount,
	preferredMint,
	allowedMints,
	onSuccess,
	onInvoiceCreated,
	onPaymentAcknowledged,
	onMintingStarted,
	onFundingFailed,
	variant = 'topup',
}: DepositLightningModalProps) {
	const { mints, defaultMint, depositInvoice, depositStatus, error: depositError } = useStore(nip60Store)
	const { wallets, isInitialized: walletsInitialized, isLoading: walletsLoading, initialize: initializeWallets } = useWallets()
	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [copied, setCopied] = useState(false)
	const [selectedNwcWalletId, setSelectedNwcWalletId] = useState('')
	const [nwcPaymentStatus, setNwcPaymentStatus] = useState<NwcDepositPaymentStatus>('idle')
	const [showClassicTopUp, setShowClassicTopUp] = useState(false)
	const [isCheckingDeposit, setIsCheckingDeposit] = useState(false)
	const isBidQuickView = variant === 'bid' && !showClassicTopUp
	const autoGenerateAttemptedKeyRef = useRef<string | null>(null)
	const wasOpenRef = useRef(false)
	const sentNwcInvoiceRef = useRef<string | null>(null)
	const nwcPaymentSentForCurrentInvoice = !!depositInvoice && sentNwcInvoiceRef.current === depositInvoice
	const isPayingWithNwc = nwcPaymentStatus === 'paying'
	const needsConfirmationRetry = depositStatus === 'awaiting_confirmation_retry'
	const nwcPaymentSent = nwcPaymentStatus === 'sent' || nwcPaymentSentForCurrentInvoice
	const nwcPaymentAttempted = nwcPaymentStatus !== 'idle' || nwcPaymentSentForCurrentInvoice
	const successNotifiedRef = useRef(false)
	const paymentAcknowledgedRef = useRef(false)
	const failureNotifiedRef = useRef(false)
	const notifiedInvoiceRef = useRef<string | null>(null)
	const filteredMints = useMemo(() => {
		const normalizedWalletMints = mints.map(normalizeValidMintUrl).filter((mintUrl): mintUrl is string => mintUrl !== null)
		const normalizedAllowedMints = allowedMints?.map(normalizeValidMintUrl).filter((mintUrl): mintUrl is string => mintUrl !== null) ?? []

		if (!allowedMints?.length) return normalizedWalletMints

		const allowedMintSet = new Set(normalizedAllowedMints)
		return normalizedWalletMints.filter((mint) => allowedMintSet.has(mint))
	}, [allowedMints, mints])
	const hasAllowedMints = filteredMints.length > 0

	const savedNwcWallets = useMemo(() => wallets.filter((wallet) => !!wallet.nwcUri), [wallets])

	const resetNwcPaymentState = useCallback(() => {
		setNwcPaymentStatus('idle')
	}, [])

	useEffect(() => {
		if (!open) {
			wasOpenRef.current = false
			return
		}

		const normalizedPreferredMint = normalizeValidMintUrl(preferredMint ?? '')
		const normalizedDefaultMint = normalizeValidMintUrl(defaultMint ?? '')
		const preferred = normalizedPreferredMint ? filteredMints.find((mint) => mint === normalizedPreferredMint) : ''
		const defaultAllowedMint = normalizedDefaultMint ? filteredMints.find((mint) => mint === normalizedDefaultMint) : ''
		const nextSelectedMint = preferred || defaultAllowedMint || filteredMints[0] || ''

		if (!wasOpenRef.current) {
			wasOpenRef.current = true
			setSelectedMint(nextSelectedMint)
			if (typeof initialAmount === 'number' && Number.isFinite(initialAmount) && initialAmount > 0) {
				setAmount(String(Math.ceil(initialAmount)))
			}
			return
		}

		setSelectedMint((currentMint) => {
			const normalizedCurrentMint = normalizeValidMintUrl(currentMint)
			if (normalizedCurrentMint && filteredMints.includes(normalizedCurrentMint)) {
				return currentMint
			}
			return nextSelectedMint
		})
	}, [open, defaultMint, filteredMints, initialAmount, preferredMint])

	useEffect(() => {
		if (open && !walletsInitialized && !walletsLoading) {
			void initializeWallets()
		}
	}, [open, walletsInitialized, walletsLoading, initializeWallets])

	useEffect(() => {
		if (!depositInvoice || savedNwcWallets.length === 0) {
			setSelectedNwcWalletId('')
			return
		}

		const selectedWalletStillAvailable = savedNwcWallets.some((wallet) => wallet.id === selectedNwcWalletId)
		if (!selectedWalletStillAvailable) {
			setSelectedNwcWalletId(savedNwcWallets[0].id)
		}
	}, [depositInvoice, savedNwcWallets, selectedNwcWalletId])

	useEffect(() => {
		if (depositStatus === 'success' || depositStatus === 'error' || (!depositInvoice && depositStatus !== 'pending')) {
			sentNwcInvoiceRef.current = null
			resetNwcPaymentState()
		}
	}, [depositInvoice, depositStatus, resetNwcPaymentState])

	useEffect(() => {
		if (!depositInvoice || depositStatus !== 'pending') {
			if (!depositInvoice) notifiedInvoiceRef.current = null
			return
		}
		if (notifiedInvoiceRef.current === depositInvoice) return
		notifiedInvoiceRef.current = depositInvoice
		onInvoiceCreated?.(depositInvoice)
	}, [depositInvoice, depositStatus, onInvoiceCreated])

	useEffect(() => {
		if (nwcPaymentStatus !== 'sent' && !nwcPaymentSentForCurrentInvoice) return
		paymentAcknowledgedRef.current = true
		onPaymentAcknowledged?.()
		onMintingStarted?.()
	}, [nwcPaymentSentForCurrentInvoice, nwcPaymentStatus, onMintingStarted, onPaymentAcknowledged])

	useEffect(() => {
		if (depositStatus !== 'error') return
		if (failureNotifiedRef.current) return
		failureNotifiedRef.current = true
		onFundingFailed?.(paymentAcknowledgedRef.current ? 'invoice_paid_mint_failed_reclaimable' : 'invoice_unpaid_or_expired_reclaimable')
	}, [depositStatus, onFundingFailed])

	useEffect(() => {
		if (depositStatus !== 'success') {
			successNotifiedRef.current = false
			return
		}

		if (successNotifiedRef.current) return
		successNotifiedRef.current = true
		failureNotifiedRef.current = false
		onSuccess?.()
	}, [depositStatus, onSuccess])

	// Bid quick view has no "Generate Invoice" button — once a mint resolves
	// (auto-picked from preferredMint/defaultMint/filteredMints), immediately
	// start the deposit so the QR appears without an extra click.
	useEffect(() => {
		if (!isBidQuickView || !open || !selectedMint) return
		if (depositInvoice || depositStatus === 'pending' || depositStatus === 'success') return

		const amountNum = parseInt(amount, 10)
		if (!Number.isFinite(amountNum) || amountNum <= 0) return

		const genKey = `${selectedMint}:${amountNum}`
		if (autoGenerateAttemptedKeyRef.current === genKey) return
		autoGenerateAttemptedKeyRef.current = genKey

		setIsGenerating(true)
		resetNwcPaymentState()
		void nip60Actions
			.startDeposit(amountNum, selectedMint, { includeFeePadding: !!allowedMints?.length })
			.finally(() => setIsGenerating(false))
	}, [isBidQuickView, open, selectedMint, depositInvoice, depositStatus, amount, allowedMints, resetNwcPaymentState])

	const handleConfirmCheckNow = async () => {
		setIsCheckingDeposit(true)
		try {
			await nip60Actions.checkDepositNow()
		} finally {
			setIsCheckingDeposit(false)
		}
	}

	const handleGenerateInvoice = async () => {
		const amountNum = parseInt(amount, 10)
		if (isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		if (!selectedMint) {
			toast.error('Please select a mint')
			return
		}

		setIsGenerating(true)
		resetNwcPaymentState()
		try {
			await nip60Actions.startDeposit(amountNum, selectedMint, {
				includeFeePadding: !!allowedMints?.length,
			})
		} finally {
			setIsGenerating(false)
		}
	}

	const handleCopyInvoice = async () => {
		if (!depositInvoice) return
		try {
			await navigator.clipboard.writeText(depositInvoice)
			setCopied(true)
			toast.success('Invoice copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy invoice')
		}
	}

	const handlePayWithNwc = async () => {
		if (!depositInvoice || nwcPaymentStatus !== 'idle' || nwcPaymentSentForCurrentInvoice) return

		const selectedWallet = savedNwcWallets.find((wallet) => wallet.id === selectedNwcWalletId)
		if (!selectedWallet?.nwcUri) {
			toast.error('Could not pay invoice with connected wallet')
			return
		}

		const signer = ndkActions.getSigner()
		if (!signer) {
			toast.error('Connected wallet is not authorized')
			return
		}

		const invoiceBeingPaid = depositInvoice
		setNwcPaymentStatus('paying')
		try {
			await walletActions.payInvoiceWithNwc(selectedWallet.nwcUri, invoiceBeingPaid, signer)
			sentNwcInvoiceRef.current = invoiceBeingPaid
			setNwcPaymentStatus('sent')
			toast.success('Payment sent. Waiting for mint confirmation...')
		} catch (error) {
			setNwcPaymentStatus('idle')
			toast.error(error instanceof Error ? error.message : 'Could not pay invoice with connected wallet')
		}
	}

	const handleRetryConfirmation = () => {
		nip60Actions.retryDepositConfirmation()
	}

	const handleClose = () => {
		if (isPayingWithNwc) return

		const isPendingDeposit = depositStatus === 'pending' || depositStatus === 'awaiting_confirmation_retry'

		// Always tear down the deposit so the modal starts fresh on reopen.
		// For pending deposits, notify the funding lifecycle so it transitions
		// to a reclaimable terminal state instead of hanging.
		if (isPendingDeposit && !failureNotifiedRef.current) {
			onFundingFailed?.(paymentAcknowledgedRef.current ? 'invoice_paid_mint_failed_reclaimable' : 'invoice_unpaid_or_expired_reclaimable')
		}
		// cancelDeposit() unconditionally resets the store to idle — works for
		// pending, terminal, and idle states. This replaces the previous
		// conditional cancel/clear that left stale state in the NWC-sent case.
		nip60Actions.cancelDeposit()

		// Reset ALL local state for a clean reopen.
		setAmount('')
		setCopied(false)
		resetNwcPaymentState()
		successNotifiedRef.current = false
		paymentAcknowledgedRef.current = false
		failureNotifiedRef.current = false
		notifiedInvoiceRef.current = null
		sentNwcInvoiceRef.current = null
		setShowClassicTopUp(false)
		setIsCheckingDeposit(false)
		autoGenerateAttemptedKeyRef.current = null
		onClose()
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="w-5 h-5 text-yellow-500" />
						{isBidQuickView ? 'Bid with lightning' : 'Deposit Lightning'}
					</DialogTitle>
					<DialogDescription>
						{isBidQuickView ? 'Pay this invoice to fund your bid.' : 'Generate a Lightning invoice to mint eCash'}
					</DialogDescription>
				</DialogHeader>

				{depositStatus === 'success' ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
							<Check className="w-6 h-6 text-green-600" />
						</div>
						<p className="text-lg font-medium text-green-600">Deposit Successful!</p>
						<p className="text-sm text-muted-foreground mt-2">Your eCash has been minted</p>
						<Button onClick={handleClose} className="mt-4">
							Done
						</Button>
					</div>
				) : isBidQuickView ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<div className="w-[216px] h-[216px] flex items-center justify-center bg-white rounded-lg p-4">
								{depositInvoice ? (
									<button type="button" onClick={handleCopyInvoice} className="cursor-pointer outline-none" title="Click to copy invoice">
										<QRCodeSVG value={depositInvoice} size={184} />
									</button>
								) : (
									<div className="text-xs text-muted-foreground text-center px-2">
										{selectedMint || isGenerating ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'No mint selected yet'}
									</div>
								)}
							</div>
						</div>

						<p className="text-center text-2xl font-bold">
							{Number.isFinite(parseInt(amount, 10)) ? parseInt(amount, 10).toLocaleString() : 0} sats
						</p>

						{copied && <p className="text-xs text-center text-muted-foreground">Invoice copied to clipboard</p>}

						{depositStatus === 'error' && (
							<p className="text-sm text-destructive text-center">{depositError || 'Failed to generate invoice. Please try again.'}</p>
						)}
						{!hasAllowedMints && !depositInvoice && (
							<p className="text-sm text-destructive text-center">No accepted auction mints are available in this wallet.</p>
						)}

						<div className="flex items-center justify-between gap-2 pt-1">
							<Button
								type="button"
								variant="link"
								className="h-auto px-0 text-sm text-muted-foreground"
								onClick={() => setShowClassicTopUp(true)}
							>
								OR Top up your wallet
							</Button>
							<Button type="button" onClick={handleConfirmCheckNow} disabled={!depositInvoice || isCheckingDeposit}>
								{isCheckingDeposit ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Confirm
							</Button>
						</div>
					</div>
				) : depositInvoice ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<div className="p-4 bg-white rounded-lg">
								<QRCodeSVG value={depositInvoice} size={200} />
							</div>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Lightning Invoice</p>
							<div className="flex gap-2">
								<input
									type="text"
									value={depositInvoice}
									readOnly
									className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono truncate"
								/>
								<Button variant="outline" size="icon" onClick={handleCopyInvoice}>
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
								</Button>
							</div>
						</div>
						{savedNwcWallets.length > 0 && (
							<div className="space-y-2 rounded-md border p-3">
								<label className="text-sm font-medium" htmlFor="deposit-nwc-wallet">
									Pay with connected wallet
								</label>
								<select
									id="deposit-nwc-wallet"
									value={selectedNwcWalletId}
									onChange={(e) => setSelectedNwcWalletId(e.target.value)}
									disabled={isPayingWithNwc || nwcPaymentAttempted}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									{savedNwcWallets.map((wallet) => (
										<option key={wallet.id} value={wallet.id}>
											{wallet.name}
										</option>
									))}
								</select>
								<Button
									type="button"
									className="w-full"
									onClick={handlePayWithNwc}
									disabled={isPayingWithNwc || nwcPaymentAttempted || !selectedNwcWalletId}
								>
									{isPayingWithNwc ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
									Pay invoice with NWC
								</Button>
							</div>
						)}
						<p className="text-sm text-muted-foreground text-center">
							{needsConfirmationRetry
								? 'Confirmation timed out. Retry to check the mint again.'
								: nwcPaymentSent
									? 'Payment sent. Waiting for mint confirmation...'
									: 'Waiting for payment...'}
						</p>
						{needsConfirmationRetry ? (
							<div className="flex justify-center">
								<Button type="button" onClick={handleRetryConfirmation}>
									Retry confirmation
								</Button>
							</div>
						) : (
							<div className="flex justify-center">
								<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
							</div>
						)}
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose} disabled={isPayingWithNwc}>
								{nwcPaymentAttempted ? 'Close' : 'Cancel'}
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Amount (sats)</label>
							<input
								type="number"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								placeholder="Enter amount in sats"
								className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								min="1"
							/>
						</div>

						<div className="space-y-2">
							<label className="text-sm font-medium">Mint</label>
							{hasAllowedMints ? (
								<select
									value={selectedMint}
									onChange={(e) => setSelectedMint(e.target.value)}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									{filteredMints.map((mint) => (
										<option key={mint} value={mint}>
											{getMintHostname(mint)}
										</option>
									))}
								</select>
							) : (
								<p className="text-sm text-destructive">
									{allowedMints?.length ? 'No accepted auction mints are available in this wallet.' : 'No mints available.'}
								</p>
							)}
						</div>

						{depositStatus === 'error' && (
							<p className="text-sm text-destructive">{depositError || 'Failed to generate invoice. Please try again.'}</p>
						)}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleGenerateInvoice} disabled={isGenerating || !amount || !selectedMint || !hasAllowedMints}>
								{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Generate Invoice
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
