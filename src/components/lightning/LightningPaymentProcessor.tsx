import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QRCode } from '@/components/ui/qr-code'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import type { PaymentProof } from '@/lib/payments/proof'
import { paymentProofToReceiptPreimage } from '@/lib/payments/proof'
import { handleNWCPayment, handleWebLNPayment, hasWebLN, validatePreimage } from '@/lib/utils/payment.utils'
import { copyToClipboard } from '@/lib/utils'
import { NDKEvent, NDKUser, NDKZapper } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { ChevronLeft, ChevronRight, Copy, CreditCard, Loader2, Zap } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { toast } from 'sonner'

export interface LightningPaymentData {
	amount: number
	description: string
	/** Required when `isZap === true` and no `bolt11` is provided (invoice generation via NDKZapper). */
	recipient?: NDKEvent | NDKUser
	recipientName?: string
	bolt11?: string
	isZap?: boolean
	invoiceId: string
	/**
	 * If enabled, the processor waits for a zap receipt (NIP-57) for the invoice.
	 * If the receipt contains a preimage, it is the primary confirmation signal.
	 */
	monitorZapReceipt?: boolean
}

export interface PaymentResult {
	success: boolean
	invoiceId: string
	preimage?: string
	error?: string
	proofType?: PaymentProof['type']
}

export interface PaymentCapabilities {
	hasNwc: boolean
	hasWebLn: boolean
	canManualVerify: boolean
}

export interface LightningPaymentProcessorRef {
	triggerNwcPayment: () => Promise<void>
	isReady: () => boolean
	skipPayment: () => void
}

interface LightningPaymentProcessorProps {
	data: LightningPaymentData
	onPaymentComplete?: (result: PaymentResult) => void
	onPaymentFailed?: (result: PaymentResult) => void
	onSkipPayment?: () => void
	onCancel?: () => void
	className?: string
	showManualVerification?: boolean
	title?: string
	active?: boolean // Control when processor should be active
	showNavigation?: boolean
	currentIndex?: number
	totalInvoices?: number
	onNavigate?: (index: number) => void
	skippable?: boolean // Control whether skip/pay later buttons are shown (default: false)
	nwcWalletUri?: string | null // Override NWC wallet URI from parent (takes precedence over store)
}

/**
 * LightningPaymentProcessor - A comprehensive component for handling Lightning Network payments
 *
 * Features:
 * - Zap invoice generation using NDKZapper
 * - Real-time zap receipt monitoring
 * - Multiple payment methods: NWC, WebLN, QR code
 * - Manual preimage verification
 * - Proper cleanup and state management
 */
export const LightningPaymentProcessor = forwardRef<LightningPaymentProcessorRef, LightningPaymentProcessorProps>(
	(
		{
			data,
			onPaymentComplete,
			onPaymentFailed,
			onSkipPayment,
			onCancel,
			className,
			showManualVerification = false,
			title,
			active = true,
			showNavigation,
			currentIndex,
			totalInvoices,
			onNavigate,
			skippable = false,
			nwcWalletUri,
		},
		ref,
	) => {
		const ndkState = useStore(ndkStore)

		// Component state
		const [invoice, setInvoice] = useState<string | null>(data.bolt11 || null)
		const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false)
		const [isPaymentInProgress, setIsPaymentInProgress] = useState(false)
		const [isCheckingForReceipt, setIsCheckingForReceipt] = useState(false)
		const [manualPreimage, setManualPreimage] = useState('')

		// Refs for controlling behavior
		const hasRequestedInvoiceRef = useRef(false)
		const hasCompletedRef = useRef(false)
		const walletPreimageRef = useRef<string | null>(null)
		const zapMonitorCleanupRef = useRef<(() => void) | null>(null)
		const zapWaiterResolveRef = useRef<((receipt: { eventId: string; receiptPreimage?: string } | null) => void) | null>(null)
		const previousDataRef = useRef<{ amount: number; description: string }>({
			amount: data.amount,
			description: data.description,
		})

		// Determine effective NWC wallet URI - prop takes precedence over store
		const effectiveNwcWalletUri = nwcWalletUri ?? ndkState.activeNwcWalletUri

		// Check payment capabilities
		const capabilities: PaymentCapabilities = {
			hasNwc: !!effectiveNwcWalletUri,
			hasWebLn: hasWebLN(),
			canManualVerify: showManualVerification,
		}

		const lightningUrl = invoice ? `lightning:${invoice}` : ''
		const monitorZapReceipt = data.monitorZapReceipt !== false

		const stopZapMonitoring = useCallback(() => {
			if (zapWaiterResolveRef.current) {
				zapWaiterResolveRef.current(null)
				zapWaiterResolveRef.current = null
			}
			if (zapMonitorCleanupRef.current) {
				zapMonitorCleanupRef.current()
				zapMonitorCleanupRef.current = null
			}
			setIsCheckingForReceipt(false)
		}, [])

		/**
		 * Generate a zap invoice using NDKZapper
		 * This creates the invoice but doesn't automatically pay it
		 */
		const generateZapInvoice = useCallback(async () => {
			if (!data.isZap || data.bolt11 || !data.recipient || isGeneratingInvoice || !ndkState.ndk || !active) return

			try {
				setIsGeneratingInvoice(true)
				console.log('🔍 Generating zap invoice:', {
					amount: data.amount,
					invoiceId: data.invoiceId,
					recipientType: data.recipient instanceof NDKUser ? 'NDKUser' : 'NDKEvent',
				})

				// Ensure zap NDK is connected for monitoring
				if (!ndkState.isZapNdkConnected) {
					await ndkActions.connectZapNdk()
				}

				// Create zapper instance with lnPay callback to capture the generated invoice
				const zapper = new NDKZapper(data.recipient, data.amount * 1000, 'msat', {
					ndk: ndkState.ndk,
					signer: ndkState.ndk.signer || undefined,
					comment: data.description,
					lnPay: async (payment) => {
						console.log('📄 Zap invoice generated:', {
							invoiceId: data.invoiceId,
							invoicePreview: payment.pr.substring(0, 30) + '...',
						})
						setInvoice(payment.pr)
						// Return a placeholder confirmation so zapper doesn't treat this as a failure;
						// actual payment happens via the processor UI.
						return { pr: payment.pr }
					},
				})

				// Generate the zap invoice (calls lnPay callback)
				await zapper.zap()
				console.log('✅ Zap invoice generation complete for', data.invoiceId)
			} catch (error) {
				console.error('❌ Failed to generate zap invoice:', error)
				onPaymentFailed?.({
					success: false,
					error: error instanceof Error ? error.message : 'Failed to generate invoice',
				})
				hasRequestedInvoiceRef.current = false
			} finally {
				setIsGeneratingInvoice(false)
			}
		}, [
			data.isZap,
			data.recipient,
			data.amount,
			data.description,
			data.invoiceId,
			ndkState.ndk,
			ndkState.isZapNdkConnected,
			onPaymentFailed,
			active,
		])

		/**
		 * Finalize success once, stop monitoring, and notify parent.
		 */
		const handlePaymentSuccess = useCallback(
			(proof: PaymentProof) => {
				// Prevent duplicate success callbacks
				if (hasCompletedRef.current) {
					console.log('⚠️ Payment already completed, ignoring duplicate success')
					return
				}
				hasCompletedRef.current = true

				stopZapMonitoring()
				console.log('✅ Payment successful:', {
					invoiceId: data.invoiceId,
					proofType: proof.type,
				})

				setIsPaymentInProgress(false)
				onPaymentComplete?.({
					success: true,
					invoiceId: data.invoiceId,
					preimage: paymentProofToReceiptPreimage(proof),
					proofType: proof.type,
				})
			},
			[onPaymentComplete, data.invoiceId, stopZapMonitoring],
		)

		/**
		 * Wait for a zap receipt for this invoice (or timeout).
		 */
		const waitForZapReceipt = useCallback(
			async (bolt11: string, timeoutMs: number): Promise<{ eventId: string; receiptPreimage?: string } | null> => {
				if (!monitorZapReceipt || !active) return null

				try {
					if (!ndkState.isZapNdkConnected) {
						await ndkActions.connectZapNdk()
					}
				} catch (error) {
					console.warn('Zap NDK not available; skipping zap receipt monitoring', error)
					return null
				}

				return await new Promise((resolve) => {
					stopZapMonitoring()
					setIsCheckingForReceipt(true)
					zapWaiterResolveRef.current = resolve
					zapMonitorCleanupRef.current = ndkActions.monitorZapPayment(
						bolt11,
						(receipt) => {
							zapWaiterResolveRef.current = null
							setIsCheckingForReceipt(false)
							resolve(receipt)
						},
						timeoutMs,
						() => {
							zapWaiterResolveRef.current = null
							setIsCheckingForReceipt(false)
							resolve(null)
						},
					)
				})
			},
			[active, monitorZapReceipt, ndkState.isZapNdkConnected, stopZapMonitoring],
		)

		/**
		 * Background monitoring for externally-paid invoices (QR / open-in-wallet).
		 * Mirrors the legacy approach: subscribe as soon as we have an invoice and
		 * finalize on a matching zap receipt.
		 */
		useEffect(() => {
			if (!invoice || !active || !monitorZapReceipt) return
			if (isGeneratingInvoice || isPaymentInProgress) return
			if (hasCompletedRef.current) return

			let disposed = false

			const start = async () => {
				try {
					if (!ndkState.isZapNdkConnected) {
						await ndkActions.connectZapNdk()
					}
				} catch (error) {
					console.warn('Zap NDK not available; background monitoring disabled', error)
					return
				}

				if (disposed) return

				stopZapMonitoring()
				setIsCheckingForReceipt(true)

				zapMonitorCleanupRef.current = ndkActions.createZapReceiptSubscription((event) => {
					if (hasCompletedRef.current) return

					const receiptPreimage = event.tagValue('preimage') || undefined
					if (receiptPreimage && validatePreimage(invoice, receiptPreimage)) {
						handlePaymentSuccess({ type: 'preimage', preimage: receiptPreimage })
						return
					}

					handlePaymentSuccess({ type: 'zap_receipt', eventId: event.id })
				}, invoice)
			}

			void start()

			return () => {
				disposed = true
				stopZapMonitoring()
			}
		}, [
			active,
			handlePaymentSuccess,
			invoice,
			isGeneratingInvoice,
			isPaymentInProgress,
			monitorZapReceipt,
			ndkState.isZapNdkConnected,
			stopZapMonitoring,
		])

		/**
		 * Handle NWC (Nostr Wallet Connect) payment
		 * Uses the configured NWC wallet to pay the invoice
		 */
		const handleNwcPayment = useCallback(async () => {
			if (!effectiveNwcWalletUri || !ndkState.ndk?.signer) {
				toast.error('NWC wallet not connected')
				return
			}
			if (!invoice) {
				toast.error('No invoice available to pay')
				return
			}

			setIsPaymentInProgress(true)
			stopZapMonitoring()
			walletPreimageRef.current = null

			try {
				const walletResult = await handleNWCPayment(invoice, effectiveNwcWalletUri, ndkState.ndk.signer, { acceptAck: true })
				if (!walletResult.ok) {
					throw new Error(walletResult.error || 'NWC payment failed')
				}

				if (walletResult.preimage) {
					walletPreimageRef.current = walletResult.preimage
				}

				const receipt = await waitForZapReceipt(invoice, 20000)
				const receiptPreimage = receipt?.receiptPreimage
				const receiptHasValidPreimage = !!receiptPreimage && validatePreimage(invoice, receiptPreimage)

				if (receiptHasValidPreimage) {
					handlePaymentSuccess({ type: 'preimage', preimage: receiptPreimage! })
					return
				}

				if (walletPreimageRef.current) {
					handlePaymentSuccess({ type: 'preimage', preimage: walletPreimageRef.current })
					return
				}

				if (receipt) {
					handlePaymentSuccess({ type: 'zap_receipt', eventId: receipt.eventId })
					return
				}

				handlePaymentSuccess({ type: 'wallet_ack', method: 'nwc', atMs: Date.now() })
			} catch (err) {
				console.error('❌ NWC payment failed:', err)
				setIsPaymentInProgress(false)
				stopZapMonitoring()

				const errorMessage = err instanceof Error ? err.message : 'Payment failed'
				toast.error(`NWC payment failed: ${errorMessage}`)
				onPaymentFailed?.({ success: false, invoiceId: data.invoiceId, error: errorMessage })
			}
		}, [data.invoiceId, effectiveNwcWalletUri, invoice, ndkState.ndk?.signer, handlePaymentSuccess, onPaymentFailed, stopZapMonitoring, waitForZapReceipt])

		/**
		 * Handle WebLN payment
		 * Uses browser extension (e.g., Alby) to pay the invoice
		 */
		const handleWebLnPayment = useCallback(async () => {
			if (!invoice) {
				toast.error('No invoice available to pay')
				return
			}

			try {
				setIsPaymentInProgress(true)
				stopZapMonitoring()
				walletPreimageRef.current = null

				const walletResult = await handleWebLNPayment(invoice, { acceptAck: true })
				if (!walletResult.ok) {
					throw new Error(walletResult.error || 'WebLN payment failed')
				}

				if (walletResult.preimage) {
					walletPreimageRef.current = walletResult.preimage
				}

				const receipt = await waitForZapReceipt(invoice, 20000)
				const receiptPreimage = receipt?.receiptPreimage
				const receiptHasValidPreimage = !!receiptPreimage && validatePreimage(invoice, receiptPreimage)

				if (receiptHasValidPreimage) {
					handlePaymentSuccess({ type: 'preimage', preimage: receiptPreimage! })
					return
				}

				if (walletPreimageRef.current) {
					handlePaymentSuccess({ type: 'preimage', preimage: walletPreimageRef.current })
					return
				}

				if (receipt) {
					handlePaymentSuccess({ type: 'zap_receipt', eventId: receipt.eventId })
					return
				}

				handlePaymentSuccess({ type: 'wallet_ack', method: 'webln', atMs: Date.now() })
			} catch (error) {
				console.error('❌ WebLN payment failed:', error)
				setIsPaymentInProgress(false)
				stopZapMonitoring()

				const errorMessage = error instanceof Error ? error.message : 'Payment failed'
				toast.error(`WebLN payment failed: ${errorMessage}`)

				onPaymentFailed?.({
					success: false,
					error: errorMessage,
					invoiceId: data.invoiceId,
				})
			}
		}, [data.invoiceId, handlePaymentSuccess, invoice, onPaymentFailed, stopZapMonitoring, waitForZapReceipt])

		/**
		 * Handle manual preimage verification
		 * Validates the preimage against the invoice
		 */
		const handleManualVerification = useCallback(() => {
			if (!manualPreimage.trim()) {
				toast.error('Please enter a preimage')
				return
			}

			if (!invoice) {
				toast.error('No invoice available to validate preimage against')
				return
			}

			try {
				if (!validatePreimage(invoice, manualPreimage)) {
					toast.error('Invalid preimage. The preimage does not match this invoice.')
					return
				}

				console.log('✅ Manual preimage validated successfully')
				toast.success('Preimage validated!')
				handlePaymentSuccess({ type: 'preimage', preimage: manualPreimage })
			} catch (error) {
				console.error('❌ Failed to validate preimage:', error)
				toast.error('Failed to validate preimage: ' + (error instanceof Error ? error.message : 'Unknown error'))
			}
		}, [manualPreimage, invoice, handlePaymentSuccess])

		/**
		 * Handle skip payment
		 * Allows user to skip this invoice and continue with checkout
		 */
		const handleSkipPayment = useCallback(() => {
			console.log('⏭️ Skipping payment:', {
				invoiceId: data.invoiceId,
				recipientName: data.recipientName || 'Unknown',
				amount: data.amount,
			})

			stopZapMonitoring()

			setIsPaymentInProgress(false)
			onSkipPayment?.()
			toast.info('Payment skipped - you can pay this later')
		}, [data.invoiceId, data.recipientName, data.amount, onSkipPayment, stopZapMonitoring])

		/**
		 * Expose ref interface for programmatic control
		 */
		useImperativeHandle(
			ref,
			() => ({
				triggerNwcPayment: handleNwcPayment,
				isReady: () => !!invoice && capabilities.hasNwc && !isPaymentInProgress,
				skipPayment: handleSkipPayment,
			}),
			[handleNwcPayment, handleSkipPayment, invoice, capabilities.hasNwc, isPaymentInProgress],
		)

		/**
		 * Keep invoice state in sync when a bolt11 is provided by the parent.
		 */
		useEffect(() => {
			if (data.bolt11) {
				setInvoice(data.bolt11)
			}
		}, [data.bolt11])

		/**
		 * Effect: Generate invoice when component becomes active
		 */
		useEffect(() => {
			if (data.isZap && !invoice && !isGeneratingInvoice && !hasRequestedInvoiceRef.current && active) {
				hasRequestedInvoiceRef.current = true
				generateZapInvoice()
			}

			// Reset request flag when processor becomes inactive
			if (!active) {
				hasRequestedInvoiceRef.current = false
				hasCompletedRef.current = false
				stopZapMonitoring()
			}
		}, [active, data.isZap, generateZapInvoice, invoice, isGeneratingInvoice, stopZapMonitoring])

		// Cleanup on unmount
		useEffect(() => stopZapMonitoring, [stopZapMonitoring])

		/**
		 * Effect: Handle data changes (amount/description)
		 * Regenerate invoice if payment details change
		 */
		useEffect(() => {
			const prevAmount = previousDataRef.current.amount
			const prevDesc = previousDataRef.current.description
			const hasAmountChanged = prevAmount !== data.amount
			const hasDescriptionChanged = prevDesc !== data.description

			if (data.isZap && invoice && (hasAmountChanged || hasDescriptionChanged)) {
				console.log('🔄 Payment data changed, regenerating invoice:', {
					amountChanged: hasAmountChanged,
					descriptionChanged: hasDescriptionChanged,
				})

				stopZapMonitoring()

				// Clear invoice to trigger regeneration
				setInvoice(null)
				hasRequestedInvoiceRef.current = false
				hasCompletedRef.current = false
			}

			previousDataRef.current = { amount: data.amount, description: data.description }
		}, [data.amount, data.description, data.isZap, invoice, stopZapMonitoring])

		return (
			<TooltipProvider>
				<Card className={className}>
					{title && (
						<CardHeader>
							<CardTitle>{title}</CardTitle>
						</CardHeader>
					)}
					<CardContent className="space-y-6 p-6">
						{/* Loading state */}
						{(isGeneratingInvoice || isPaymentInProgress) && (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-8 w-8 animate-spin" />
								<span className="ml-2">{isGeneratingInvoice ? 'Generating invoice...' : 'Processing payment...'}</span>
							</div>
						)}

						{/* Error state - Failed to generate invoice */}
						{!invoice && !isGeneratingInvoice && !isPaymentInProgress && (
							<div className="space-y-4 py-4">
								<div className="text-center text-amber-600">
									<p className="font-medium">Unable to generate Lightning invoice</p>
									<p className="text-sm text-gray-600 mt-1">
										{skippable
											? 'The recipient may not have Lightning configured. You can skip this payment and pay directly later.'
											: 'The recipient may not have Lightning configured.'}
									</p>
								</div>
								{onSkipPayment && skippable && (
									<Button onClick={handleSkipPayment} variant="secondary" className="w-full">
										Skip Payment (Pay Later)
									</Button>
								)}
							</div>
						)}

						{/* Invoice QR Code - Always visible when available */}
						{invoice && !isGeneratingInvoice && (
							<div className="space-y-4">
								<div className="flex justify-center">
									<a href={lightningUrl} className="block hover:opacity-90 transition-opacity" target="_blank" rel="noopener noreferrer">
										<QRCode value={invoice} size={200} />
									</a>
								</div>

								{/* Mobile navigation under QR code */}
								{showNavigation && (totalInvoices || 0) > 1 && (
									<div className="sm:hidden mt-3 flex gap-2">
										<Button
											variant="outline"
											className="flex-1"
											onClick={() => onNavigate?.(Math.max(0, (currentIndex || 0) - 1))}
											disabled={(currentIndex || 0) === 0}
										>
											<ChevronLeft className="w-4 h-4 mr-2" />
											Previous
										</Button>
										<Button
											variant="outline"
											className="flex-1"
											onClick={() => onNavigate?.(Math.min((totalInvoices || 0) - 1, (currentIndex || 0) + 1))}
											disabled={(currentIndex || 0) >= (totalInvoices || 0) - 1}
										>
											Next
											<ChevronRight className="w-4 h-4 ml-2" />
										</Button>
									</div>
								)}

								{/* Invoice text with copy button */}
								<div className="space-y-2">
									<Label htmlFor="invoice">Lightning Invoice</Label>
									<div className="flex gap-2">
										<Input id="invoice" value={invoice} readOnly className="font-mono text-xs" />
										<Button variant="outline" size="icon" onClick={() => copyToClipboard(invoice)}>
											<Copy className="h-4 w-4" />
										</Button>
									</div>
								</div>

								{/* Passive monitoring status */}
								{isCheckingForReceipt && !isPaymentInProgress && (
									<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
										<Loader2 className="h-4 w-4 animate-spin" />
										<span>Checking for payment…</span>
									</div>
								)}
							</div>
						)}

						{/* Payment buttons */}
						{invoice && !isGeneratingInvoice && (
							<div className="space-y-3">
								<div className="flex flex-col gap-2 sm:flex-row">
									{/* NWC Payment Button */}
									{!capabilities.hasNwc ? (
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="w-full sm:flex-1">
													<Button disabled={true} className="w-full" variant="outline">
														<Zap className="h-4 w-4 mr-2" />
														Pay with NWC
													</Button>
												</div>
											</TooltipTrigger>
											<TooltipContent>
												<p>No NWC wallet connected</p>
											</TooltipContent>
										</Tooltip>
									) : (
										<Button onClick={handleNwcPayment} disabled={isPaymentInProgress} className="w-full sm:flex-1" variant="outline">
											<Zap className="h-4 w-4 mr-2" />
											Pay with NWC
										</Button>
									)}

									{/* WebLN Payment Button */}
									{!capabilities.hasWebLn ? (
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="w-full sm:flex-1">
													<Button disabled={true} className="w-full" variant="outline">
														<CreditCard className="h-4 w-4 mr-2" />
														Pay with WebLN
													</Button>
												</div>
											</TooltipTrigger>
											<TooltipContent>
												<p>WebLN not available</p>
											</TooltipContent>
										</Tooltip>
									) : (
										<Button onClick={handleWebLnPayment} disabled={isPaymentInProgress} className="w-full sm:flex-1" variant="outline">
											<CreditCard className="h-4 w-4 mr-2" />
											Pay with WebLN
										</Button>
									)}
								</div>

								{/* Manual verification */}
								{capabilities.canManualVerify && (
									<div className="space-y-2">
										<Label htmlFor="preimage">Payment Preimage (Manual Verification)</Label>
										<div className="flex gap-2">
											<Input
												id="preimage"
												placeholder="Enter payment preimage"
												value={manualPreimage}
												onChange={(e) => setManualPreimage(e.target.value)}
											/>
											<Button onClick={handleManualVerification} variant="secondary">
												Verify
											</Button>
										</div>
									</div>
								)}

								{/* Pay Later / Skip button */}
								{onSkipPayment && skippable && (
									<Button onClick={handleSkipPayment} variant="tertiary" className="w-full">
										Pay Later
									</Button>
								)}

								{/* Cancel button */}
								{onCancel && (
									<Button onClick={onCancel} variant="ghost" className="w-full">
										Cancel
									</Button>
								)}
							</div>
						)}
					</CardContent>
				</Card>
			</TooltipProvider>
		)
	},
)

LightningPaymentProcessor.displayName = 'LightningPaymentProcessor'
