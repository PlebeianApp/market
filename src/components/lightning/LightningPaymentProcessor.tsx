import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QRCode } from '@/components/ui/qr-code'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { copyToClipboard } from '@/lib/utils'
import { NDKEvent, NDKUser, NDKZapper } from '@nostr-dev-kit/ndk'
import { NDKNWCWallet } from '@nostr-dev-kit/ndk-wallet'
import { useStore } from '@tanstack/react-store'
import { Copy, CreditCard, Loader2, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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

interface LightningPaymentProcessorProps {
	data: LightningPaymentData
	onPaymentComplete?: (result: PaymentResult) => void
	onPaymentFailed?: (result: PaymentResult) => void
	onCancel?: () => void
	className?: string
	showManualVerification?: boolean
	title?: string
}

export function LightningPaymentProcessor({
	data,
	onPaymentComplete,
	onPaymentFailed,
	onCancel,
	className,
	showManualVerification = false,
	title,
}: LightningPaymentProcessorProps) {
	const { user } = useStore(authStore)
	const ndkState = useStore(ndkStore)

	const [invoice, setInvoice] = useState<string | null>(data.bolt11 || null)
	const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false)
	const [isPaymentInProgress, setIsPaymentInProgress] = useState(false)
	const [manualPreimage, setManualPreimage] = useState('')
	const [paymentMonitoring, setPaymentMonitoring] = useState<(() => void) | null>(null)

	// Prevent duplicate invoice generation
	const hasRequestedInvoiceRef = useRef(false)

	// Store previous values to detect actual changes
	const previousDataRef = useRef<{ amount: number; description: string }>({ amount: data.amount, description: data.description })

	// Check payment capabilities
	const capabilities: PaymentCapabilities = {
		hasNwc: !!ndkState.activeNwcWalletUri,
		hasWebLn: typeof window !== 'undefined' && !!window.webln,
		canManualVerify: showManualVerification,
	}

	const lightningUrl = invoice ? `lightning:${invoice}` : ''

	const generateZapInvoice = useCallback(async () => {
		if (!data.isZap || isGeneratingInvoice || !ndkState.ndk) return

		try {
			setIsGeneratingInvoice(true)
			console.log('🔍 Generating zap invoice for amount:', data.amount)

			// Ensure zap NDK is connected
			if (!ndkState.isZapNdkConnected) {
				await ndkActions.connectZapNdk()
			}

			// Create zapper instance with lnPay callback to get invoice
			const zapper = new NDKZapper(data.recipient, data.amount * 1000, 'msat', {
				ndk: ndkState.ndk,
				signer: ndkState.ndk.signer || undefined,
				comment: data.description,
				lnPay: async (payment) => {
					console.log('📄 Invoice generated:', payment.pr.substring(0, 20) + '...')
					setInvoice(payment.pr)
					return undefined // Don't auto-pay, just get the invoice
				},
			})

			// This call will generate the invoice via lnPay callback but not pay it
			await zapper.zap()
		} catch (error) {
			console.error('Failed to generate zap invoice:', error)
			onPaymentFailed?.({
				success: false,
				error: error instanceof Error ? error.message : 'Failed to generate invoice',
			})
		} finally {
			setIsGeneratingInvoice(false)
		}
	}, [data.isZap, data.recipient, data.amount, data.description, ndkState.ndk, onPaymentFailed])

	const startZapMonitoring = useCallback(() => {
		if (!invoice || !data.isZap) return

		console.log('🔔 Starting zap monitoring for invoice:', invoice.substring(0, 20) + '...')

		const stopMonitoring = ndkActions.monitorZapPayment(
			invoice,
			(preimage: string) => {
				console.log('⚡ Zap payment confirmed!')
				handlePaymentSuccess(preimage)
			},
			60000, // 60 second timeout
		)

		setPaymentMonitoring(() => stopMonitoring)
	}, [invoice, data.isZap])

	const handlePaymentSuccess = useCallback(
		(preimage: string) => {
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
		[paymentMonitoring, onPaymentComplete],
	)

	const handleNwcPayment = useCallback(async () => {
		if (!invoice || !ndkState.activeNwcWalletUri || !ndkState.ndk) {
			console.error('❌ NWC payment failed - missing requirements')
			return
		}

		try {
			setIsPaymentInProgress(true)
			console.log('💳 Starting NWC payment')

			const nwcWallet: any = new (NDKNWCWallet as any)(ndkState.ndk, { pairingCode: ndkState.activeNwcWalletUri })

			if (data.isZap) {
				// For zaps, pay the existing invoice via NWC
				const result = await nwcWallet.pay({ invoice })
				console.log('✅ Zap invoice paid via NWC - monitoring will handle confirmation')
				// For zaps, the monitoring system will detect the zap receipt
				// Don't call handlePaymentSuccess here, let zap monitoring handle it
			} else {
				// For regular payments, use wallet directly
				const result = await nwcWallet.pay({ invoice })
				console.log('✅ NWC payment completed')
				handlePaymentSuccess(result?.preimage || 'nwc-payment-preimage')
			}
		} catch (error) {
			console.error('NWC payment failed:', error)
			setIsPaymentInProgress(false)
			onPaymentFailed?.({
				success: false,
				error: error instanceof Error ? error.message : 'Payment failed',
				paymentHash: data.invoiceId,
			})
		}
	}, [data, invoice, ndkState, handlePaymentSuccess, onPaymentFailed])

	const handleWebLnPayment = useCallback(async () => {
		if (!invoice || !window.webln) return

		try {
			setIsPaymentInProgress(true)
			console.log('🌐 Starting WebLN payment')

			await window.webln.enable()
			const result = await window.webln.sendPayment(invoice)

			console.log('✅ WebLN payment completed')

			if (data.isZap) {
				console.log('Zap sent via WebLN - monitoring will handle confirmation')
				// For zaps, the monitoring system will detect the zap receipt
				// Don't call success immediately, let zap monitoring handle it
			} else {
				// For regular invoices, we can call success immediately
				handlePaymentSuccess(result.preimage || 'webln-payment-preimage')
			}
		} catch (error) {
			console.error('WebLN payment failed:', error)
			setIsPaymentInProgress(false)
			onPaymentFailed?.({
				success: false,
				error: error instanceof Error ? error.message : 'Payment failed',
				paymentHash: data.invoiceId,
			})
		}
	}, [invoice, data.isZap, handlePaymentSuccess, onPaymentFailed])

	const handleManualVerification = useCallback(() => {
		if (!manualPreimage.trim()) {
			toast.error('Please enter a preimage')
			return
		}

		handlePaymentSuccess(manualPreimage)
	}, [manualPreimage, handlePaymentSuccess])

	// Generate invoice when needed (no function deps to avoid loops)
	useEffect(() => {
		if (data.isZap && !invoice && !isGeneratingInvoice && !hasRequestedInvoiceRef.current) {
			hasRequestedInvoiceRef.current = true // mark as requested
			generateZapInvoice()
		}
	}, [data.isZap, invoice, isGeneratingInvoice])

	// Start monitoring when invoice is available
	useEffect(() => {
		if (invoice && data.isZap && !paymentMonitoring) {
			console.log('🔔 Starting zap monitoring')
			startZapMonitoring()
		}

		// Cleanup on unmount
		return () => {
			if (paymentMonitoring) {
				paymentMonitoring()
			}
		}
	}, [invoice, data.isZap, paymentMonitoring])

	// Clear and regenerate when amount or description actually changes (only for zaps)
	useEffect(() => {
		const prevAmount = previousDataRef.current.amount
		const prevDesc = previousDataRef.current.description
		const hasAmountChanged = prevAmount !== data.amount
		const hasDescriptionChanged = prevDesc !== data.description
		if (data.isZap && invoice && (hasAmountChanged || hasDescriptionChanged)) {
			if (paymentMonitoring) {
				paymentMonitoring()
				setPaymentMonitoring(null)
			}
			setInvoice(null)
			hasRequestedInvoiceRef.current = false // reset so we can request new invoice
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
				<CardContent className="space-y-6">
					{/* Loading state */}
					{(isGeneratingInvoice || isPaymentInProgress) && (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-8 w-8 animate-spin" />
							<span className="ml-2">{isGeneratingInvoice ? 'Generating invoice...' : 'Processing payment...'}</span>
						</div>
					)}

					{/* Invoice QR Code - Always visible when available */}
					{invoice && (
						<div className="space-y-4">
							<div className="flex justify-center">
								<a href={lightningUrl} className="block hover:opacity-90 transition-opacity" target="_blank" rel="noopener noreferrer">
									<QRCode value={invoice} size={200} />
								</a>
							</div>

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
					{invoice && (
						<div className="space-y-3">
							<div className="flex gap-2">
								{/* NWC Payment Button */}
								{!capabilities.hasNwc ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="flex-1">
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
									<Button onClick={handleNwcPayment} disabled={isPaymentInProgress} className="flex-1" variant="outline">
										<Zap className="h-4 w-4 mr-2" />
										Pay with NWC
									</Button>
								)}

								{/* WebLN Payment Button */}
								{!capabilities.hasWebLn ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="flex-1">
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
									<Button onClick={handleWebLnPayment} disabled={isPaymentInProgress} className="flex-1" variant="outline">
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
}
