// @ts-nocheck
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QRCode } from '@/components/ui/qr-code'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { walletActions } from '@/lib/stores/wallet'
import { copyToClipboard } from '@/lib/utils'
import { Invoice } from '@getalby/lightning-tools'
import { NDKEvent, NDKUser, NDKZapper } from '@nostr-dev-kit/ndk'
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
		const walletPreimageRef = useRef<string | null>(null) // Store wallet preimage for zap monitoring
		const previousDataRef = useRef<{ amount: number; description: string }>({
			amount: data.amount,
			description: data.description,
		})

		// Determine effective NWC wallet URI - prop takes precedence over store
		const effectiveNwcWalletUri = nwcWalletUri ?? ndkState.activeNwcWalletUri

		// Check payment capabilities
		const capabilities: PaymentCapabilities = {
			hasNwc: !!effectiveNwcWalletUri,
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
		 * Start monitoring for zap receipts
		 * Subscribes to zap events and looks for our specific invoice
		 */
		const startZapMonitoring = useCallback(async () => {
			if (!invoice || !data.isZap || !active || paymentMonitoring) return

			// Ensure zap NDK is connected before starting monitoring
			if (!ndkState.isZapNdkConnected) {
				console.log('🔌 Connecting zap NDK for monitoring...')
				try {
					await ndkActions.connectZapNdk()
				} catch (error) {
					console.error('Failed to connect zap NDK:', error)
					return
				}
			}

			console.log('🔔 Starting zap monitoring:', {
				invoiceId: data.invoiceId,
				invoicePreview: invoice.substring(0, 30) + '...',
			})

			const stopMonitoring = ndkActions.monitorZapPayment(
				invoice,
				(receiptPreimage: string) => {
					// Use wallet preimage if available (real Lightning preimage), otherwise use receipt preimage
					const finalPreimage = walletPreimageRef.current || receiptPreimage
					console.log('⚡ Zap receipt detected!', {
						invoiceId: data.invoiceId,
						preimageSource: walletPreimageRef.current ? 'wallet' : 'receipt',
						preimagePreview: finalPreimage.substring(0, 20) + '...',
					})
					handlePaymentSuccess(finalPreimage)
				},
				90000, // 90 second timeout for zap receipts
			)

			setPaymentMonitoring(() => stopMonitoring)
		}, [invoice, data.isZap, data.invoiceId, active, paymentMonitoring, ndkState.isZapNdkConnected, handlePaymentSuccess])

		/**
		 * Handle NWC (Nostr Wallet Connect) payment
		 * Uses the configured NWC wallet to pay the invoice
		 */
		const handleNwcPayment = useCallback(async () => {
			console.log('🔄 handleNwcPayment called:', {
				hasNwcUri: !!effectiveNwcWalletUri,
				hasNdk: !!ndkState.ndk,
				hasInvoice: !!invoice,
				invoiceId: data.invoiceId,
			})

			if (!effectiveNwcWalletUri || !ndkState.ndk?.signer) {
				toast.error('NWC wallet not connected')
				return
			}

			if (!invoice) {
				toast.error('No invoice available to pay')
				return
			}

			setIsPaymentInProgress(true)

			const nwcClient = await walletActions.getOrCreateNwcClient(effectiveNwcWalletUri, ndkState.ndk.signer)
			if (!nwcClient) {
				setIsPaymentInProgress(false)
				toast.error('Invalid NWC wallet configuration')
				return
			}

			try {
				console.log('💳 Starting NWC payment:', {
					invoiceId: data.invoiceId,
					isZap: data.isZap,
					amount: data.amount,
					relay: nwcClient.relayUrl,
					invoicePreview: invoice.substring(0, 30) + '...',
				})

				// Pay the invoice directly using lnPay - this works for both zaps and regular invoices
				// The invoice was already generated (either via zapper or regular LNURL)
				console.log('📤 Sending lnPay request...')
				const response = await nwcClient.wallet.lnPay({ pr: invoice })

				console.log('💳 NWC lnPay response:', response)

				// For zaps: always wait for zap receipt as primary confirmation
				// Zap receipts are verifiable Nostr events that can be queried at any time
				if (data.isZap) {
					if (response?.preimage) {
						// Validate preimage like legacy code does - ensure SHA256(preimage) = payment_hash
						const invoiceObj = new Invoice({ pr: invoice })
						const isValidPreimage = invoiceObj.validatePreimage(response.preimage)

						if (isValidPreimage) {
							console.log('✅ NWC payment sent successfully, preimage validated:', response.preimage.substring(0, 20) + '...')
							// Store the validated wallet preimage for zap monitoring to use
							walletPreimageRef.current = response.preimage
						} else {
							console.log('⚠️ NWC returned preimage but validation failed (not a real Lightning preimage):', response.preimage.substring(0, 20) + '...')
							// Don't store invalid preimage - will fall back to zap receipt preimage
						}
					} else {
						console.log('✅ NWC payment sent successfully (no preimage returned - common with Primal wallets)')
					}
					console.log('👀 Waiting for zap receipt event to confirm payment...')
					// Keep isPaymentInProgress true - zap receipt monitoring will call handlePaymentSuccess
				} else {
					// For non-zap payments, use preimage as confirmation
					if (response?.preimage) {
						console.log('✅ NWC payment successful, preimage:', response.preimage.substring(0, 20) + '...')
						handlePaymentSuccess(response.preimage)
					} else {
						throw new Error('Payment failed: no preimage returned from wallet')
					}
				}
			} catch (err) {
				console.error('❌ NWC payment failed:', err)
				setIsPaymentInProgress(false)

				const errorMessage = (err as Error).message || 'Payment failed'
				toast.error(`NWC payment failed: ${errorMessage}`)

				onPaymentFailed?.({
					success: false,
					error: errorMessage,
					paymentHash: data.invoiceId,
				})
			}
		}, [data, invoice, ndkState, effectiveNwcWalletUri, handlePaymentSuccess, onPaymentFailed])

		/**
		 * Handle WebLN payment
		 * Uses browser extension (e.g., Alby) to pay the invoice
		 */
		const handleWebLnPayment = useCallback(async () => {
			if (!invoice || !window.webln) {
				toast.error('WebLN not available')
				return
			}

			try {
				setIsPaymentInProgress(true)
				console.log('🌐 Starting WebLN payment:', {
					invoiceId: data.invoiceId,
					isZap: data.isZap,
					invoicePreview: invoice.substring(0, 30) + '...',
				})

				await window.webln.enable()
				const result = await window.webln.sendPayment(invoice)

				console.log('✅ WebLN payment completed:', {
					invoiceId: data.invoiceId,
					hasPreimage: !!result.preimage,
					preimagePreview: result.preimage ? result.preimage.substring(0, 20) + '...' : 'none',
				})

				// For zaps: always wait for zap receipt as primary confirmation
				// Zap receipts are verifiable Nostr events that can be queried at any time
				if (data.isZap) {
					if (result.preimage) {
						// Validate preimage like legacy code does - ensure SHA256(preimage) = payment_hash
						const invoiceObj = new Invoice({ pr: invoice })
						const isValidPreimage = invoiceObj.validatePreimage(result.preimage)

						if (isValidPreimage) {
							console.log('✅ WebLN payment sent successfully, preimage validated:', result.preimage.substring(0, 20) + '...')
							// Store the validated wallet preimage for zap monitoring to use
							walletPreimageRef.current = result.preimage
						} else {
							console.log('⚠️ WebLN returned preimage but validation failed (not a real Lightning preimage):', result.preimage.substring(0, 20) + '...')
							// Don't store invalid preimage - will fall back to zap receipt preimage
						}
					} else {
						console.log('✅ WebLN payment sent successfully (no preimage returned)')
					}
					console.log('👀 Waiting for zap receipt event to confirm payment...')
					// Keep isPaymentInProgress true - zap receipt monitoring will call handlePaymentSuccess
				} else {
					// For non-zap payments, use preimage as confirmation
					if (result.preimage) {
						console.log('✅ WebLN payment successful, preimage:', result.preimage.substring(0, 20) + '...')
						handlePaymentSuccess(result.preimage)
					} else {
						throw new Error('Payment failed: no preimage returned from wallet')
					}
				}
			} catch (error) {
				console.error('❌ WebLN payment failed:', error)
				setIsPaymentInProgress(false)

				const errorMessage = error instanceof Error ? error.message : 'Payment failed'
				toast.error(`WebLN payment failed: ${errorMessage}`)

				onPaymentFailed?.({
					success: false,
					error: errorMessage,
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
