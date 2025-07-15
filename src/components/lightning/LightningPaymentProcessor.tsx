import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QRCode } from '@/components/ui/qr-code'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { authStore } from '@/lib/stores/auth'
import { ndkStore } from '@/lib/stores/ndk'
import {
	useGenerateInvoiceMutation,
	useNwcPaymentMutation,
	usePaymentReceiptSubscription,
	useWeblnPaymentMutation,
} from '@/queries/payment'
import { useStore } from '@tanstack/react-store'
import { AlertTriangle, Check, CheckCircle, ChevronDown, Copy, ExternalLink, Loader2, RefreshCw, Wallet, Zap } from 'lucide-react'
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
	id: string
	amount: number
	description: string
	recipientName?: string
	recipientPubkey: string
	lightningAddress?: string | null
	bolt11?: string | null
	type: 'zap' | 'payment'
	orderId?: string
}

export interface PaymentCapabilities {
	hasWebLN: boolean
	hasNWC: boolean
	allowManualProof?: boolean
	allowRefresh?: boolean
}

export interface PaymentResult {
	success: boolean
	preimage?: string
	error?: string
	paymentId: string
}

interface LightningPaymentProcessorProps {
	paymentData: LightningPaymentData
	onPaymentComplete?: (result: PaymentResult) => void
	onPaymentFailed?: (result: PaymentResult) => void
	capabilities?: Partial<PaymentCapabilities>
	className?: string
	showHeader?: boolean
	autoGenerate?: boolean
}

interface PaymentState {
	loading: boolean
	nwcLoading: boolean
	weblnLoading: boolean
	errorMessage: string | null
	invoice: string | null
	paymentComplete: boolean
	awaitingPayment: boolean
	manualProofMode: boolean
	preimageInput: string
}

export function LightningPaymentProcessor({
	paymentData,
	onPaymentComplete,
	onPaymentFailed,
	capabilities = {},
	className = '',
	showHeader = true,
	autoGenerate = true,
}: LightningPaymentProcessorProps) {
	const { user } = useStore(authStore)
	const ndkState = useStore(ndkStore)

	// Mutations
	const { mutateAsync: generateInvoice, isPending: isGeneratingInvoice } = useGenerateInvoiceMutation()
	const { mutateAsync: payWithWebln, isPending: isPayingWithWebln } = useWeblnPaymentMutation()
	const { mutateAsync: payWithNwc, isPending: isPayingWithNwc } = useNwcPaymentMutation()

	// State
	const [state, setState] = useState<PaymentState>({
		loading: false,
		nwcLoading: false,
		weblnLoading: false,
		errorMessage: null,
		invoice: paymentData.bolt11 || null,
		paymentComplete: false,
		awaitingPayment: false,
		manualProofMode: false,
		preimageInput: '',
	})

	const [copiedInvoice, setCopiedInvoice] = useState(false)
	const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)

	// Session management to prevent old receipt detection
	const sessionStartTimeRef = useRef<number>(Math.floor(Date.now() / 1000))

	// Determine capabilities
	const finalCapabilities: PaymentCapabilities = {
		hasWebLN: typeof window !== 'undefined' && !!window.webln,
		hasNWC: !!ndkState.activeNwcWalletUri,
		allowManualProof: capabilities.allowManualProof ?? true,
		allowRefresh: capabilities.allowRefresh ?? true,
	}

	// Subscribe to payment receipts for zaps
	const { data: paymentPreimage } = usePaymentReceiptSubscription({
		orderId: paymentData.orderId || paymentData.id,
		invoiceId: paymentData.id,
		sessionStartTime: sessionStartTimeRef.current,
		enabled: paymentData.type === 'zap' && !!state.invoice && !state.paymentComplete && state.awaitingPayment,
	})

	// Handle successful payment from subscription
	useEffect(() => {
		if (paymentPreimage && !state.paymentComplete) {
			console.log(`✅ Payment detected for ${paymentData.id} via subscription`)
			handlePaymentSuccess(paymentPreimage)
		}
	}, [paymentPreimage, state.paymentComplete])

	// Auto-generate invoice if enabled and no invoice exists
	useEffect(() => {
		if (autoGenerate && !state.invoice && paymentData.lightningAddress && !state.loading) {
			generateInvoiceFromAddress()
		}
	}, [autoGenerate, state.invoice, paymentData.lightningAddress, state.loading])

	const updateState = useCallback((updates: Partial<PaymentState>) => {
		setState((prev) => ({ ...prev, ...updates }))
	}, [])

	const handlePaymentSuccess = useCallback(
		(preimage: string) => {
			updateState({
				paymentComplete: true,
				awaitingPayment: false,
				loading: false,
				nwcLoading: false,
				weblnLoading: false,
			})

			const result: PaymentResult = {
				success: true,
				preimage,
				paymentId: paymentData.id,
			}

			onPaymentComplete?.(result)
			toast.success('Payment successful! ⚡')
		},
		[paymentData.id, onPaymentComplete, updateState],
	)

	const handlePaymentError = useCallback(
		(error: string) => {
			updateState({
				errorMessage: error,
				loading: false,
				nwcLoading: false,
				weblnLoading: false,
				awaitingPayment: false,
			})

			const result: PaymentResult = {
				success: false,
				error,
				paymentId: paymentData.id,
			}

			onPaymentFailed?.(result)
			toast.error(`Payment failed: ${error}`)
		},
		[paymentData.id, onPaymentFailed, updateState],
	)

	// Generate fresh BOLT11 invoice from lightning address
	const generateInvoiceFromAddress = async () => {
		if (!paymentData.lightningAddress) {
			handlePaymentError('No lightning address available')
			return
		}

		updateState({
			loading: true,
			errorMessage: null,
			invoice: null,
			paymentComplete: false,
			awaitingPayment: false,
		})

		try {
			const generated = await generateInvoice({
				sellerPubkey: paymentData.recipientPubkey,
				amountSats: paymentData.amount,
				description: paymentData.description,
				invoiceId: paymentData.id,
				items: [],
				type: paymentData.type === 'zap' ? 'v4v' : 'seller',
			})

			if (generated.status === 'failed' || !generated.bolt11) {
				throw new Error('Failed to generate invoice')
			}

			updateState({
				invoice: generated.bolt11,
				loading: false,
			})

			toast.success('Invoice generated successfully')
		} catch (error) {
			console.error('Invoice generation failed:', error)
			handlePaymentError('Failed to generate invoice')
		}
	}

	// Handle WebLN payment
	const handleWebLNPayment = async () => {
		if (!state.invoice) {
			toast.error('No invoice available')
			return
		}

		updateState({
			weblnLoading: true,
			errorMessage: null,
		})

		try {
			const preimage = await payWithWebln(state.invoice)
			handlePaymentSuccess(preimage)
		} catch (error) {
			handlePaymentError(error instanceof Error ? error.message : 'WebLN payment failed')
		}
	}

	// Handle NWC payment
	const handleNwcPayment = async () => {
		if (!state.invoice || !ndkState.activeNwcWalletUri || !user) {
			toast.error('Missing requirements for NWC payment')
			return
		}

		updateState({
			nwcLoading: true,
			errorMessage: null,
		})

		try {
			const preimage = await payWithNwc({
				bolt11: state.invoice,
				nwcUri: ndkState.activeNwcWalletUri,
				userPubkey: user.pubkey,
				recipientPubkey: paymentData.recipientPubkey,
				invoiceId: paymentData.id,
				amount: paymentData.amount,
				description: paymentData.description,
			})

			handlePaymentSuccess(preimage)
		} catch (error) {
			handlePaymentError(error instanceof Error ? error.message : 'NWC payment failed')
		}
	}

	// Manual payment verification
	const handleManualVerification = async () => {
		if (!state.preimageInput.trim()) {
			toast.error('Please enter a preimage')
			return
		}

		updateState({ loading: true })

		try {
			// In a real implementation, you might want to validate the preimage
			// against the invoice hash
			handlePaymentSuccess(state.preimageInput.trim())
		} catch (error) {
			handlePaymentError('Invalid preimage')
		}
	}

	// Copy invoice to clipboard
	const copyToClipboard = async () => {
		if (!state.invoice) return

		try {
			await navigator.clipboard.writeText(state.invoice)
			setCopiedInvoice(true)
			toast.success('Invoice copied to clipboard')

			// Mark as awaiting payment since user copied invoice
			updateState({ awaitingPayment: true })

			setTimeout(() => setCopiedInvoice(false), 2000)
		} catch (error) {
			toast.error('Failed to copy to clipboard')
		}
	}

	// Open lightning wallet
	const openLightningWallet = () => {
		if (!state.invoice) return

		const lightningUrl = `lightning:${state.invoice}`
		window.open(lightningUrl, '_blank')

		// Mark as awaiting payment since user opened external wallet
		updateState({ awaitingPayment: true })
	}

	// Calculate available payment methods
	const availableMethodsCount = [
		true, // QR code always available
		finalCapabilities.hasWebLN,
		finalCapabilities.hasNWC,
	].filter(Boolean).length

	const getGridColsClass = () => {
		if (availableMethodsCount === 1) return 'grid-cols-1'
		if (availableMethodsCount === 2) return 'grid-cols-2'
		return 'grid-cols-3'
	}

	return (
		<div className={`space-y-4 ${className}`}>
			{/* Header */}
			{showHeader && (
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-base flex items-center gap-2">
							<Zap className="w-4 h-4" />
							{paymentData.recipientName || 'Lightning Payment'}
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						<div className="flex justify-between">
							<span className="text-sm text-gray-600">Amount:</span>
							<span className="font-semibold">{paymentData.amount.toLocaleString()} sats</span>
						</div>
						<div className="flex justify-between">
							<span className="text-sm text-gray-600">Description:</span>
							<span className="text-sm">{paymentData.description}</span>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Error Display */}
			{state.errorMessage && (
				<div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg">
					<AlertTriangle className="w-4 h-4" />
					<span className="text-sm">{state.errorMessage}</span>
				</div>
			)}

			{/* Payment Complete State */}
			{state.paymentComplete && (
				<div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg">
					<CheckCircle className="w-4 h-4" />
					<span className="text-sm">Payment completed successfully!</span>
				</div>
			)}

			{/* Awaiting Payment State */}
			{state.awaitingPayment && !state.paymentComplete && (
				<div className="flex items-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg">
					<RefreshCw className="w-4 h-4 animate-spin" />
					<span className="text-sm">Listening for payment confirmation...</span>
				</div>
			)}

			{/* Payment Interface */}
			{!state.paymentComplete && (
				<>
					{/* Generate Invoice Button */}
					{!state.invoice && paymentData.lightningAddress && (
						<Button onClick={generateInvoiceFromAddress} disabled={state.loading} className="w-full">
							{state.loading ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									Generating Invoice...
								</>
							) : (
								<>
									<Zap className="w-4 h-4 mr-2" />
									Generate Invoice
								</>
							)}
						</Button>
					)}

					{/* Payment Methods */}
					{state.invoice && (
						<Tabs defaultValue="qr" className="w-full">
							<TabsList className={`grid w-full ${getGridColsClass()} bg-gray-100`}>
								<TabsTrigger value="qr">QR Code</TabsTrigger>
								<TabsTrigger className="disabled:opacity-50" disabled={!finalCapabilities.hasWebLN} value="webln">
									WebLN
								</TabsTrigger>
								<TabsTrigger className="disabled:opacity-50" disabled={!finalCapabilities.hasNWC} value="nwc">
									NWC
								</TabsTrigger>
							</TabsList>

							<TabsContent value="qr" className="space-y-4">
								<div className="flex flex-col items-center space-y-4">
									<QRCode value={state.invoice} size={256} />

									<div className="flex gap-2 w-full">
										<Button variant="outline" onClick={copyToClipboard} className="flex-1">
											{copiedInvoice ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
											{copiedInvoice ? 'Copied!' : 'Copy'}
										</Button>

										<Button variant="outline" onClick={openLightningWallet} className="flex-1">
											<ExternalLink className="w-4 h-4 mr-2" />
											Open Wallet
										</Button>
									</div>

									{!state.awaitingPayment && (
										<Button variant="secondary" onClick={() => updateState({ awaitingPayment: true })} className="w-full">
											<RefreshCw className="w-4 h-4 mr-2" />
											I've made the payment
										</Button>
									)}
								</div>
							</TabsContent>

							{finalCapabilities.hasWebLN && (
								<TabsContent value="webln">
									<Button onClick={handleWebLNPayment} disabled={state.weblnLoading} className="w-full">
										{state.weblnLoading ? (
											<>
												<Loader2 className="w-4 h-4 mr-2 animate-spin" />
												Processing...
											</>
										) : (
											<>
												<Zap className="w-4 h-4 mr-2" />
												Pay with WebLN
											</>
										)}
									</Button>
								</TabsContent>
							)}

							{finalCapabilities.hasNWC && (
								<TabsContent value="nwc">
									<Button onClick={handleNwcPayment} disabled={state.nwcLoading} className="w-full">
										{state.nwcLoading ? (
											<>
												<Loader2 className="w-4 h-4 mr-2 animate-spin" />
												Processing...
											</>
										) : (
											<>
												<Wallet className="w-4 h-4 mr-2" />
												Pay with NWC
											</>
										)}
									</Button>
								</TabsContent>
							)}
						</Tabs>
					)}

					{/* Advanced Options */}
					{(finalCapabilities.allowRefresh || finalCapabilities.allowManualProof) && state.invoice && (
						<Collapsible open={advancedOptionsOpen} onOpenChange={setAdvancedOptionsOpen}>
							<CollapsibleTrigger asChild>
								<Button variant="outline" className="w-full">
									Advanced Options
									<ChevronDown className="ml-2 h-4 w-4" />
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent className="space-y-4 pt-4">
								{/* Refresh Invoice */}
								{finalCapabilities.allowRefresh && paymentData.lightningAddress && (
									<Button variant="outline" onClick={generateInvoiceFromAddress} disabled={state.loading} className="w-full">
										{state.loading ? (
											<>
												<Loader2 className="w-4 h-4 mr-2 animate-spin" />
												Generating...
											</>
										) : (
											<>
												<RefreshCw className="w-4 h-4 mr-2" />
												Generate Fresh Invoice
											</>
										)}
									</Button>
								)}

								{/* Manual Proof */}
								{finalCapabilities.allowManualProof && (
									<div className="space-y-2">
										<Separator />
										<Label htmlFor="preimage">Manual Payment Verification</Label>
										<p className="text-sm text-gray-600">
											If you've paid but it wasn't detected, enter the payment preimage from your wallet.
										</p>
										<Input
											id="preimage"
											placeholder="Enter payment preimage"
											value={state.preimageInput}
											onChange={(e) => updateState({ preimageInput: e.target.value })}
										/>
										<Button onClick={handleManualVerification} disabled={state.loading || !state.preimageInput.trim()} className="w-full">
											{state.loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
											Verify Payment
										</Button>
									</div>
								)}
							</CollapsibleContent>
						</Collapsible>
					)}
				</>
			)}
		</div>
	)
}
