// @ts-nocheck
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QRCode } from '@/components/ui/qr-code'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { copyToClipboard } from '@/lib/utils'
import { Invoice } from '@getalby/lightning-tools'
import { NDKEvent, NDKUser, NDKZapper } from '@nostr-dev-kit/ndk'
import { NDKNWCWallet } from '@nostr-dev-kit/ndk-wallet'
import { useStore } from '@tanstack/react-store'
import { ChevronLeft, ChevronRight, Copy, CreditCard, Loader2, Zap } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { toast } from 'sonner'

// WebLN types
declare global {
	interface Window {
		webln?: {
			enable(): Promise<void>
			sendPayment(paymentRequest: string): Promise<{ preimage: string }>
		}
	}
}

export interface LightningPaymentData {
	amount: number
	description: string
	recipient: NDKEvent | NDKUser
	recipientName?: string
	bolt11?: string
	isZap?: boolean
	invoiceId?: string
}

export interface PaymentResult {
	success: boolean
	preimage?: string
	error?: string
	paymentHash?: string
}

interface PaymentCapabilities {
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
		},
		ref,
	) => {
		const { user } = useStore(authStore)
		const ndkState = useStore(ndkStore)

		// Component state
		const [invoice, setInvoice] = useState<string | null>(data.bolt11 || null)
		const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false)
		const [isPaymentInProgress, setIsPaymentInProgress] = useState(false)
		const [manualPreimage, setManualPreimage] = useState('')
		const [paymentMonitoring, setPaymentMonitoring] = useState<(() => void) | null>(null)

		// Refs for controlling behavior
		const hasRequestedInvoiceRef = useRef(false)
		const hasCompletedRef = useRef(false)
		const previousDataRef = useRef<{ amount: number; description: string }>({
			amount: data.amount,
			description: data.description,
		})

		// Check payment capabilities
		const capabilities: PaymentCapabilities = {
			hasNwc: !!ndkState.activeNwcWalletUri,
			hasWebLn: typeof window !== 'undefined' && !!window.webln,
			canManualVerify: showManualVerification,
		}

		const lightningUrl = invoice ? `lightning:${invoice}` : ''

		/**
		 * Generate a zap invoice using NDKZapper
		 * This creates the invoice but doesn't automatically pay it
		 */
		const generateZapInvoice = useCallback(async () => {
			if (!data.isZap || isGeneratingInvoice || !ndkState.ndk || !active) return

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
						return undefined // Don't auto-pay, just capture the invoice
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
		 * Start monitoring for zap receipts
		 * Subscribes to zap events and looks for our specific invoice
		 */
		const startZapMonitoring = useCallback(() => {
			if (!invoice || !data.isZap || !active || paymentMonitoring) return

			console.log('🔔 Starting zap monitoring:', {
				invoiceId: data.invoiceId,
				invoicePreview: invoice.substring(0, 30) + '...',
			})

			const stopMonitoring = ndkActions.monitorZapPayment(
				invoice,
				(preimage: string) => {
					console.log('⚡ Zap receipt detected!', {
						invoiceId: data.invoiceId,
						preimagePreview: preimage.substring(0, 20) + '...',
					})
					handlePaymentSuccess(preimage)
				},
				90000, // 90 second timeout for zap receipts
			)

			setPaymentMonitoring(() => stopMonitoring)
		}, [invoice, data.isZap, data.invoiceId, active, paymentMonitoring])

		/**
		 * Handle successful payment
		 * Cleanup monitoring and notify parent component
		 */
		const handlePaymentSuccess = useCallback(
			(preimage: string) => {
				// Prevent duplicate success callbacks
				if (hasCompletedRef.current) {
					console.log('⚠️ Payment already completed, ignoring duplicate success')
					return
				}
				hasCompletedRef.current = true

				console.log('✅ Payment successful:', {
					invoiceId: data.invoiceId,
					preimagePreview: preimage.substring(0, 20) + '...',
				})

				// Stop monitoring
				if (paymentMonitoring) {
					paymentMonitoring()
					setPaymentMonitoring(null)
				}

				setIsPaymentInProgress(false)
				onPaymentComplete?.({
					success: true,
					preimage,
					paymentHash: data.invoiceId,
				})
			},
			[paymentMonitoring, onPaymentComplete, data.invoiceId],
		)

		/**
		 * Handle NWC (Nostr Wallet Connect) payment
		 * Uses the configured NWC wallet to pay the invoice
		 */
		const handleNwcPayment = useCallback(async () => {
			if (!ndkState.activeNwcWalletUri || !ndkState.ndk) {
				toast.error('NWC wallet not connected')
				return
			}

			try {
				setIsPaymentInProgress(true)
				console.log('💳 Starting NWC payment:', {
					invoiceId: data.invoiceId,
					isZap: data.isZap,
					amount: data.amount,
				})

				const wallet = new NDKNWCWallet(ndkState.zapNdk as any, {
					pairingCode: ndkState.activeNwcWalletUri,
				})
				// @ts-ignore – NDK types don't include wallet property yet
				ndkState.ndk.wallet = wallet

				if (data.isZap) {
					// For zaps, use NDKZapper with NWC
					const zapper = new NDKZapper(data.recipient, data.amount * 1000, 'msat', {
						ndk: ndkState.ndk,
						comment: data.description,
					})

					// Listen for zap completion events
					;(zapper as any).on?.('complete', (results: Map<any, any>) => {
						console.log('⚡ Zap completed via NWC')
						handlePaymentSuccess('nwc-zap-complete')
					})
					;(zapper as any).on?.('ln_payment', ({ preimage }: { preimage: string }) => {
						console.log('⚡ Lightning payment confirmed via NWC')
						handlePaymentSuccess(preimage)
					})

					await zapper.zap()
				} else {
					// For regular invoices, pay directly
					if (!invoice) {
						throw new Error('No invoice available to pay')
					}
					await wallet.lnPay({ pr: invoice })
					handlePaymentSuccess('nwc-payment-preimage')
				}

				console.log('✅ NWC payment initiated successfully')
			} catch (err) {
				console.error('❌ NWC payment failed:', err)
				setIsPaymentInProgress(false)
				onPaymentFailed?.({
					success: false,
					error: (err as Error).message,
					paymentHash: data.invoiceId,
				})
			}
		}, [data, invoice, ndkState, handlePaymentSuccess, onPaymentFailed])

		/**
		 * Handle WebLN payment
		 * Uses browser extension (e.g., Alby) to pay the invoice
		 */
		const handleWebLnPayment = useCallback(async () => {
			if (!invoice || !window.webln) return

			try {
				setIsPaymentInProgress(true)
				console.log('🌐 Starting WebLN payment:', {
					invoiceId: data.invoiceId,
					isZap: data.isZap,
				})

				await window.webln.enable()
				const result = await window.webln.sendPayment(invoice)

				console.log('✅ WebLN payment completed:', {
					invoiceId: data.invoiceId,
					hasPreimage: !!result.preimage,
				})

				if (data.isZap) {
					// For zaps, the monitoring system will detect the zap receipt
					// Don't call success immediately - let monitoring handle it
					console.log('🔔 Waiting for zap receipt confirmation...')
					toast.info('Payment sent! Waiting for confirmation...')
				} else {
					// For regular invoices, we can call success immediately
					handlePaymentSuccess(result.preimage || 'webln-payment-preimage')
				}
			} catch (error) {
				console.error('❌ WebLN payment failed:', error)
				setIsPaymentInProgress(false)
				onPaymentFailed?.({
					success: false,
					error: error instanceof Error ? error.message : 'Payment failed',
					paymentHash: data.invoiceId,
				})
			}
		}, [invoice, data.isZap, data.invoiceId, handlePaymentSuccess, onPaymentFailed])

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
				const invoiceObj = new Invoice({ pr: invoice })
				const isValid = invoiceObj.validatePreimage(manualPreimage)

				if (!isValid) {
					toast.error('Invalid preimage. The preimage does not match this invoice.')
					return
				}

				console.log('✅ Manual preimage validated successfully')
				toast.success('Preimage validated!')
				handlePaymentSuccess(manualPreimage)
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

			// Stop monitoring
			if (paymentMonitoring) {
				paymentMonitoring()
				setPaymentMonitoring(null)
			}

			setIsPaymentInProgress(false)
			onSkipPayment?.()
			toast.info('Payment skipped - you can pay this later')
		}, [data.invoiceId, data.recipientName, data.amount, paymentMonitoring, onSkipPayment])

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
			}
		}, [data.isZap, invoice, isGeneratingInvoice, active, generateZapInvoice])

		/**
		 * Effect: Start monitoring when invoice is available
		 */
		useEffect(() => {
			if (invoice && data.isZap && !paymentMonitoring && active) {
				console.log('🔔 Invoice ready, starting zap monitoring:', data.invoiceId)
				startZapMonitoring()
			}

			// Stop monitoring when processor becomes inactive
			if (!active && paymentMonitoring) {
				console.log('🔕 Processor inactive, stopping monitoring:', data.invoiceId)
				paymentMonitoring()
				setPaymentMonitoring(null)
			}

			// Cleanup on unmount
			return () => {
				if (paymentMonitoring) {
					paymentMonitoring()
				}
			}
		}, [invoice, data.isZap, data.invoiceId, paymentMonitoring, active, startZapMonitoring])

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

				// Cleanup existing monitoring
				if (paymentMonitoring) {
					paymentMonitoring()
					setPaymentMonitoring(null)
				}

				// Clear invoice to trigger regeneration
				setInvoice(null)
				hasRequestedInvoiceRef.current = false
				hasCompletedRef.current = false
			}

			previousDataRef.current = { amount: data.amount, description: data.description }
		}, [data.amount, data.description, invoice, data.isZap, paymentMonitoring])

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
										The recipient may not have Lightning configured. You can skip this payment and pay directly later.
									</p>
								</div>
								{onSkipPayment && (
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
								{onSkipPayment && (
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
