import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { QRCode } from '@/components/ui/qr-code'
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
import {
	AlertTriangle,
	Check,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Copy,
	CreditCard,
	ExternalLink,
	RefreshCw,
	Users,
	Wallet,
	Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

export interface PaymentInvoiceData {
	id: string
	orderId: string
	bolt11?: string | null
	amount: number
	description: string
	recipientName: string
	status: 'pending' | 'paid' | 'expired'
	expiresAt?: number
	createdAt: number
	lightningAddress?: string | null
	recipientPubkey: string
	type: 'merchant' | 'v4v'
}

interface PaymentContentProps {
	invoices: PaymentInvoiceData[]
	currentIndex?: number
	onPaymentComplete?: (invoiceId: string, preimage: string) => void
	onPaymentFailed?: (invoiceId: string, error: string) => void
	showNavigation?: boolean
	nwcEnabled?: boolean
	onNavigate?: (index: number) => void
}

interface InvoiceState {
	loading: boolean
	nwcLoading: boolean
	errorMessage: string | null
	invoice: string | null
	lightningAddress: string | null
	paymentComplete: boolean
	paymentPending: boolean
	awaitingPayment: boolean // For QR code payments - waiting for external payment
}

export function PaymentContent({
	invoices,
	currentIndex = 0,
	onPaymentComplete,
	onPaymentFailed,
	showNavigation = true,
	nwcEnabled = true,
	onNavigate,
}: PaymentContentProps) {
	const { user } = useStore(authStore)
	const ndkState = useStore(ndkStore)
	const { mutateAsync: generateInvoice, isPending: isGeneratingInvoice } = useGenerateInvoiceMutation()
	const { mutateAsync: payWithWebln, isPending: isPayingWithWebln } = useWeblnPaymentMutation()
	const { mutateAsync: payWithNwc, isPending: isPayingWithNwc } = useNwcPaymentMutation()

	const [activeIndex, setActiveIndex] = useState(currentIndex)
	const [invoiceStates, setInvoiceStates] = useState<Record<string, InvoiceState>>({})
	const [copiedInvoices, setCopiedInvoices] = useState<Set<string>>(new Set())

	// Keep track of timeouts for cleanup
	const [timeoutIds, setTimeoutIds] = useState<Set<NodeJS.Timeout>>(new Set())

	// Session management to prevent old receipt detection
	const sessionStartTimeRef = useRef<number>(Math.floor(Date.now() / 1000))

	// Initialize invoice states
	useEffect(() => {
		sessionStartTimeRef.current = Math.floor(Date.now() / 1000)
		console.log('🔄 New checkout session started at', sessionStartTimeRef.current)

		const newStates: Record<string, InvoiceState> = {}
		invoices.forEach((invoice) => {
			newStates[invoice.id] = {
				loading: false,
				nwcLoading: false,
				errorMessage: null,
				invoice: invoice.bolt11 || null,
				lightningAddress: invoice.lightningAddress || null,
				paymentComplete: invoice.status === 'paid',
				paymentPending: false,
				awaitingPayment: false,
			}
		})
		setInvoiceStates(newStates)
	}, [invoices])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			// Clear all timeouts when component unmounts
			timeoutIds.forEach(clearTimeout)
		}
	}, [])

	// Update active index when currentIndex prop changes
	useEffect(() => {
		setActiveIndex(currentIndex)
	}, [currentIndex])

	const updateInvoiceState = (invoiceId: string, updates: Partial<InvoiceState>) => {
		setInvoiceStates((prev) => ({
			...prev,
			[invoiceId]: { ...prev[invoiceId], ...updates },
		}))
	}

	// Helper to create tracked timeouts for cleanup
	const createTrackedTimeout = (callback: () => void, delay: number) => {
		const timeoutId = setTimeout(() => {
			callback()
			// Remove timeout from tracking set when it completes
			setTimeoutIds((prev) => {
				const newSet = new Set(prev)
				newSet.delete(timeoutId)
				return newSet
			})
		}, delay)

		// Add timeout to tracking set
		setTimeoutIds((prev) => new Set(prev).add(timeoutId))
		return timeoutId
	}

	const currentInvoice = invoices[activeIndex]
	const currentState = invoiceStates[currentInvoice?.id]

	// Subscribe to payment receipts
	const { data: paymentPreimage } = usePaymentReceiptSubscription({
		orderId: currentInvoice?.orderId,
		invoiceId: currentInvoice?.id,
		sessionStartTime: sessionStartTimeRef.current,
		enabled: !!currentInvoice && !currentState?.paymentComplete && currentState?.awaitingPayment,
	})

	// Handle successful payment from subscription
	useEffect(() => {
		if (paymentPreimage && currentInvoice && !currentState.paymentComplete) {
			console.log(`✅ Payment detected for ${currentInvoice.id} via subscription`)
			updateInvoiceState(currentInvoice.id, {
				paymentComplete: true,
				paymentPending: false,
				awaitingPayment: false,
			})
			onPaymentComplete?.(currentInvoice.id, paymentPreimage)
			toast.success('Payment detected and confirmed!')

			// Auto-advance to the next invoice
			createTrackedTimeout(() => {
				if (activeIndex < invoices.length - 1) {
					handleNavigate(activeIndex + 1)
				}
			}, 1500)
		}
	}, [paymentPreimage, currentInvoice?.id, currentState?.paymentComplete])

	// Generate fresh BOLT11 invoice from lightning address
	const generateInvoiceFromAddress = async (invoiceId: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		if (!invoice || !invoice.lightningAddress) return

		updateInvoiceState(invoiceId, {
			loading: true,
			errorMessage: null,
			invoice: null,
			paymentComplete: false,
			paymentPending: false,
		})

		try {
			const generated = await generateInvoice({
				sellerPubkey: invoice.recipientPubkey,
				amountSats: invoice.amount,
				description: invoice.description,
				invoiceId: invoice.id,
				items: [], // Items are not needed for simple invoice regeneration
				type: invoice.type === 'merchant' ? 'seller' : 'v4v',
			})

			if (generated.status === 'failed' || !generated.bolt11) {
				throw new Error('Failed to generate new invoice.')
			}

			updateInvoiceState(invoiceId, {
				invoice: generated.bolt11,
				loading: false,
			})
			toast.success('New invoice generated')
		} catch (error) {
			console.error('Invoice regeneration failed:', error)
			updateInvoiceState(invoiceId, {
				errorMessage: 'Failed to generate new invoice.',
				loading: false,
			})
			toast.error('Could not generate a new invoice.')
		}
	}

	// Handle WebLN payment
	const handleWebLNPayment = async (invoiceId: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		const bolt11 = invoiceStates[invoiceId]?.invoice
		if (!invoice || !bolt11) {
			toast.error('No invoice available to pay.')
			return
		}

		updateInvoiceState(invoiceId, {
			paymentPending: true,
			errorMessage: null,
		})

		try {
			const preimage = await payWithWebln(bolt11)
			updateInvoiceState(invoiceId, {
				paymentComplete: true,
				paymentPending: false,
			})
			onPaymentComplete?.(invoiceId, preimage)

			// Auto-advance to the next invoice
			createTrackedTimeout(() => {
				if (activeIndex < invoices.length - 1) {
					handleNavigate(activeIndex + 1)
				}
			}, 1500)
		} catch (error) {
			// Error toast is handled by the mutation hook
			updateInvoiceState(invoiceId, {
				paymentPending: false,
				errorMessage: error instanceof Error ? error.message : 'Payment failed.',
			})
			onPaymentFailed?.(invoiceId, error instanceof Error ? error.message : 'Payment failed.')
		}
	}

	// Handle NWC payment using NDK Zapper (treating marketplace payment as a zap)
	const handleNwcPayment = async (invoiceId: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		const bolt11 = invoiceStates[invoiceId]?.invoice
		const nwcUri = ndkState.activeNwcWalletUri

		if (!invoice || !bolt11 || !nwcUri || !user) {
			toast.error('User, NWC URI or invoice not available.')
			return
		}

		updateInvoiceState(invoiceId, {
			nwcLoading: true,
			errorMessage: null,
		})

		try {
			const preimage = await payWithNwc({
				bolt11,
				nwcUri,
				userPubkey: user.pubkey,
				recipientPubkey: invoice.recipientPubkey,
				invoiceId: invoice.id,
				amount: invoice.amount,
				description: invoice.description,
			})

			updateInvoiceState(invoiceId, {
				paymentComplete: true,
				nwcLoading: false,
			})
			onPaymentComplete?.(invoiceId, preimage)

			// Auto-advance to the next invoice
			createTrackedTimeout(() => {
				if (activeIndex < invoices.length - 1) {
					handleNavigate(activeIndex + 1)
				}
			}, 1500)
		} catch (error) {
			// Error toast is handled by the mutation hook
			updateInvoiceState(invoiceId, {
				nwcLoading: false,
				errorMessage: error instanceof Error ? error.message : 'NWC payment failed.',
			})
			onPaymentFailed?.(invoiceId, error instanceof Error ? error.message : 'NWC payment failed.')
		}
	}

	const copyToClipboard = async (text: string, invoiceId: string) => {
		try {
			await navigator.clipboard.writeText(text)
			setCopiedInvoices((prev) => new Set(prev).add(invoiceId))
			toast.success('Copied to clipboard!')
			createTrackedTimeout(() => {
				setCopiedInvoices((prev) => {
					const newSet = new Set(prev)
					newSet.delete(invoiceId)
					return newSet
				})
			}, 2000)
		} catch (error) {
			toast.error('Failed to copy to clipboard')
		}
	}

	const openLightningWallet = (bolt11: string) => {
		const lightningUrl = `lightning:${bolt11}`
		window.open(lightningUrl, '_blank')

		// Mark as awaiting payment since user opened external wallet
		updateInvoiceState(currentInvoice.id, {
			awaitingPayment: true,
		})
	}

	const startAwaitingPayment = (invoiceId: string) => {
		updateInvoiceState(invoiceId, {
			awaitingPayment: true,
		})
	}

	const handleNavigate = (newIndex: number) => {
		setActiveIndex(newIndex)
		onNavigate?.(newIndex)
	}

	if (!currentInvoice || !currentState) {
		return null
	}

	const hasWebLN = typeof window !== 'undefined' && window.webln
	const hasNWC = ndkState.activeNwcWalletUri

	return (
		<div className="space-y-4">
			{/* Navigation Header */}
			{showNavigation && invoices.length > 1 && (
				<div className="flex items-center justify-between">
					<h3 className="text-lg font-semibold">
						Payment {activeIndex + 1} of {invoices.length}
					</h3>
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" onClick={() => handleNavigate(Math.max(0, activeIndex - 1))} disabled={activeIndex === 0}>
							<ChevronLeft className="w-4 h-4" />
						</Button>
						<span className="text-sm text-gray-500">
							{activeIndex + 1} of {invoices.length}
						</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => handleNavigate(Math.min(invoices.length - 1, activeIndex + 1))}
							disabled={activeIndex === invoices.length - 1}
						>
							<ChevronRight className="w-4 h-4" />
						</Button>
					</div>
				</div>
			)}

			{/* Invoice Details */}
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-base flex items-center gap-2">
							{currentInvoice.type === 'merchant' ? <CreditCard className="w-4 h-4" /> : <Users className="w-4 h-4" />}
							{currentInvoice.recipientName}
						</CardTitle>
						<Badge variant={currentState.paymentComplete ? 'secondary' : 'outline'}>
							{currentState.paymentComplete ? 'Paid' : 'Pending'}
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex justify-between">
						<span className="text-sm text-gray-600">Amount:</span>
						<span className="font-semibold">{currentInvoice.amount.toLocaleString()} sats</span>
					</div>
					<div className="flex justify-between">
						<span className="text-sm text-gray-600">Description:</span>
						<span className="text-sm">{currentInvoice.description}</span>
					</div>
				</CardContent>
			</Card>

			{/* Error Display */}
			{currentState.errorMessage && (
				<div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg">
					<AlertTriangle className="w-4 h-4" />
					<span className="text-sm">{currentState.errorMessage}</span>
				</div>
			)}

			{/* Payment Complete State */}
			{currentState.paymentComplete && (
				<div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg">
					<CheckCircle className="w-4 h-4" />
					<span className="text-sm">Payment completed successfully!</span>
				</div>
			)}

			{/* Awaiting Payment State */}
			{currentState.awaitingPayment && !currentState.paymentComplete && (
				<div className="flex items-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg">
					<RefreshCw className="w-4 h-4 animate-spin" />
					<span className="text-sm">Awaiting payment confirmation...</span>
				</div>
			)}

			{/* Payment Interface */}
			{!currentState.paymentComplete && (
				<>
					{/* Generate Invoice Button */}
					{!currentState.invoice && currentInvoice.lightningAddress && (
						<Button onClick={() => generateInvoiceFromAddress(currentInvoice.id)} disabled={currentState.loading} className="w-full">
							{currentState.loading ? (
								<>
									<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
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
					{currentState.invoice && (
						<Tabs defaultValue="qr" className="w-full">
							<TabsList
								className={`grid w-full ${(() => {
									const tabCount = 1 + (hasWebLN ? 1 : 0) + (hasNWC && nwcEnabled ? 1 : 0)
									if (tabCount === 1) return 'grid-cols-1'
									if (tabCount === 2) return 'grid-cols-2'
									return 'grid-cols-3'
								})()}`}
							>
								<TabsTrigger value="qr">QR Code</TabsTrigger>
								{hasWebLN && <TabsTrigger value="webln">WebLN</TabsTrigger>}
								{hasNWC && nwcEnabled && <TabsTrigger value="nwc">NWC</TabsTrigger>}
							</TabsList>

							<TabsContent value="qr" className="space-y-4">
								<div className="flex flex-col items-center space-y-4">
									<QRCode value={currentState.invoice} size={256} />

									<div className="flex gap-2 w-full">
										<Button
											variant="outline"
											onClick={() => {
												copyToClipboard(currentState.invoice!, currentInvoice.id)
												startAwaitingPayment(currentInvoice.id)
											}}
											className="flex-1"
										>
											{copiedInvoices.has(currentInvoice.id) ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
											{copiedInvoices.has(currentInvoice.id) ? 'Copied!' : 'Copy'}
										</Button>

										<Button variant="outline" onClick={() => openLightningWallet(currentState.invoice!)} className="flex-1">
											<ExternalLink className="w-4 h-4 mr-2" />
											Open Wallet
										</Button>
									</div>

									{!currentState.awaitingPayment && !currentState.paymentComplete && (
										<Button variant="secondary" onClick={() => startAwaitingPayment(currentInvoice.id)} className="w-full">
											<RefreshCw className="w-4 h-4 mr-2" />
											I've made the payment
										</Button>
									)}
								</div>
							</TabsContent>

							{hasWebLN && (
								<TabsContent value="webln">
									<Button onClick={() => handleWebLNPayment(currentInvoice.id)} disabled={currentState.paymentPending} className="w-full">
										{currentState.paymentPending ? (
											<>
												<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
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

							{hasNWC && nwcEnabled && (
								<TabsContent value="nwc">
									<Button onClick={() => handleNwcPayment(currentInvoice.id)} disabled={currentState.nwcLoading} className="w-full">
										{currentState.nwcLoading ? (
											<>
												<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
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

					{/* Refresh Invoice Button */}
					{currentState.invoice && currentInvoice.lightningAddress && (
						<Button
							variant="outline"
							onClick={() => generateInvoiceFromAddress(currentInvoice.id)}
							disabled={currentState.loading}
							className="w-full"
						>
							{currentState.loading ? (
								<>
									<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
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
				</>
			)}

			{/* Invoice Progress */}
			{invoices.length > 1 && (
				<div className="space-y-2">
					<div className="flex justify-between text-sm">
						<span>Payment Progress</span>
						<span>
							{invoices.filter((inv) => invoiceStates[inv.id]?.paymentComplete).length} of {invoices.length} completed
						</span>
					</div>
					<Progress
						value={(invoices.filter((inv) => invoiceStates[inv.id]?.paymentComplete).length / invoices.length) * 100}
						className="w-full"
					/>
				</div>
			)}
		</div>
	)
}
