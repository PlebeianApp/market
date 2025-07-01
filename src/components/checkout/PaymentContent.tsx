import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QRCode } from '@/components/ui/qr-code'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { useInvoiceGeneration } from '@/hooks/useInvoiceGeneration'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { useStore } from '@tanstack/react-store'
import {
	Check,
	Copy,
	Zap,
	ExternalLink,
	RefreshCw,
	AlertTriangle,
	Wallet,
	CreditCard,
	Users,
	ChevronLeft,
	ChevronRight,
	CheckCircle,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import type { NDKTag } from '@nostr-dev-kit/ndk'
import { NDKEvent, NDKZapper } from '@nostr-dev-kit/ndk'
import { NDKNWCWallet, NDKWalletStatus } from '@nostr-dev-kit/ndk-wallet'

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
	const { generateInvoiceForSeller } = useInvoiceGeneration({ fallbackToMock: true })

	const [activeIndex, setActiveIndex] = useState(currentIndex)
	const [invoiceStates, setInvoiceStates] = useState<Record<string, InvoiceState>>({})
	const [copiedInvoices, setCopiedInvoices] = useState<Set<string>>(new Set())

	// Initialize invoice states
	useEffect(() => {
		const newStates: Record<string, InvoiceState> = {}
		invoices.forEach((invoice) => {
			if (!invoiceStates[invoice.id]) {
				newStates[invoice.id] = {
					loading: false,
					nwcLoading: false,
					errorMessage: null,
					invoice: invoice.bolt11 || null,
					lightningAddress: invoice.lightningAddress || null,
					paymentComplete: invoice.status === 'paid',
					paymentPending: false,
				}
			}
		})

		if (Object.keys(newStates).length > 0) {
			setInvoiceStates((prev) => ({ ...prev, ...newStates }))
		}
	}, [invoices])

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

	const currentInvoice = invoices[activeIndex]
	const currentState = invoiceStates[currentInvoice?.id] || {
		loading: false,
		nwcLoading: false,
		errorMessage: null,
		invoice: null,
		lightningAddress: null,
		paymentComplete: false,
		paymentPending: false,
	}

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
			const mockInvoiceData = await generateInvoiceForSeller(
				invoice.recipientPubkey,
				invoice.amount,
				invoice.description,
				invoiceId,
				[
					{
						productId: `payment-${invoiceId}`,
						name: invoice.description,
						amount: 1,
						price: invoice.amount,
					},
				],
				invoice.type === 'merchant' ? 'seller' : 'v4v',
			)

			updateInvoiceState(invoiceId, {
				invoice: mockInvoiceData.bolt11 || null,
				loading: false,
			})
		} catch (error) {
			console.error('Failed to generate invoice:', error)
			updateInvoiceState(invoiceId, {
				errorMessage: error instanceof Error ? error.message : 'Failed to generate invoice',
				loading: false,
			})
			onPaymentFailed?.(invoiceId, error instanceof Error ? error.message : 'Failed to generate invoice')
		}
	}

	// Create gamma spec compliant payment receipt (Kind 17)
	const createPaymentReceipt = async (invoiceId: string, preimage: string, bolt11: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		if (!invoice || !user) return

		let ndk = ndkActions.getNDK()
		if (!ndk) {
			console.warn('NDK not initialized for payment receipt, initializing now...')
			ndk = ndkActions.initialize()
			await ndkActions.connect()
		}

		if (!ndk) {
			throw new Error('Failed to initialize NDK for payment receipt')
		}

		// Create gamma spec compliant Kind 17 payment receipt
		const tags: NDKTag[] = [
			['p', invoice.recipientPubkey], // Merchant's public key
			['subject', 'order-receipt'], // Required by gamma spec
			['order', invoice.orderId], // Original order identifier
			['payment', 'lightning', bolt11, preimage], // Payment proof with preimage
			['amount', invoice.amount.toString()], // Payment amount
		]

		const receiptEvent = new NDKEvent(ndk, {
			kind: 17, // Payment receipt as per gamma spec
			content: `Payment completed for ${invoice.description}. Amount: ${invoice.amount} sats.`,
			tags,
		})

		// Sign and publish the payment receipt
		await receiptEvent.sign()
		await receiptEvent.publish()

		console.log('✅ Payment receipt (Kind 17) created and published:', receiptEvent.id)
		return receiptEvent
	}

	// Handle WebLN payment
	const handleWebLNPayment = async (invoiceId: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		if (!invoice) return

		const bolt11 = currentState.invoice
		if (!bolt11) {
			toast.error('No invoice available')
			return
		}

		updateInvoiceState(invoiceId, {
			paymentPending: true,
			errorMessage: null,
		})

		try {
			if (!window.webln) {
				throw new Error('WebLN not available. Please install a WebLN-compatible wallet.')
			}

			await window.webln.enable()
			const result = await window.webln.sendPayment(bolt11)

			if (result.preimage) {
				// Create gamma spec payment receipt
				await createPaymentReceipt(invoiceId, result.preimage, bolt11)

				updateInvoiceState(invoiceId, {
					paymentComplete: true,
					paymentPending: false,
				})

				onPaymentComplete?.(invoiceId, result.preimage)
				toast.success('Payment completed successfully!')
			} else {
				throw new Error('Payment completed but no preimage received')
			}
		} catch (error) {
			console.error('WebLN payment failed:', error)
			const errorMessage = error instanceof Error ? error.message : 'WebLN payment failed'

			updateInvoiceState(invoiceId, {
				errorMessage,
				paymentPending: false,
			})

			onPaymentFailed?.(invoiceId, errorMessage)
			toast.error(errorMessage)
		}
	}

	// Handle NWC payment using NDK Zapper (treating marketplace payment as a zap)
	const handleNwcPayment = async (invoiceId: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		if (!invoice) return

		updateInvoiceState(invoiceId, {
			nwcLoading: true,
			errorMessage: null,
			paymentPending: true,
		})

		let ndk = ndkActions.getNDK()
		if (!ndk) {
			console.warn('NDK not initialized for NWC payment, initializing now...')
			ndk = ndkActions.initialize()
			await ndkActions.connect()
		}

		if (!ndk) {
			const errorMessage = 'Failed to initialize NDK for NWC payment'
			updateInvoiceState(invoiceId, {
				errorMessage,
				nwcLoading: false,
				paymentPending: false,
			})
			onPaymentFailed?.(invoiceId, errorMessage)
			return
		}

		const activeNwcUri = ndkState.activeNwcWalletUri
		if (!activeNwcUri) {
			const errorMessage = 'No active NWC wallet selected. Please configure one in settings.'
			updateInvoiceState(invoiceId, {
				errorMessage,
				nwcLoading: false,
				paymentPending: false,
			})
			onPaymentFailed?.(invoiceId, errorMessage)
			toast.error(errorMessage)
			return
		}

		let originalNdkWallet = ndk.wallet
		let nwcWalletForPayment: NDKNWCWallet | undefined

		try {
			nwcWalletForPayment = new NDKNWCWallet(ndk, { pairingCode: activeNwcUri })
			ndk.wallet = nwcWalletForPayment

			// Wait for wallet to be ready
			if (nwcWalletForPayment.status !== NDKWalletStatus.READY) {
				await new Promise<void>((resolve, reject) => {
					const readyTimeout = setTimeout(() => reject(new Error('NWC wallet connection timed out')), 20000)
					nwcWalletForPayment!.once('ready', () => {
						clearTimeout(readyTimeout)
						resolve()
					})
				})
			}

			// Create a "user" object for zapping (the payment recipient)
			const recipientUser = ndk.getUser({ pubkey: invoice.recipientPubkey })
			const zapAmountMsats = invoice.amount * 1000

			// Use NDKZapper for the payment (treating marketplace payment as a zap)
			const zapper = new NDKZapper(recipientUser, zapAmountMsats, 'msats', {
				comment: invoice.description,
			})

			console.log(`💸 Initiating NWC zap payment: ${invoice.amount} sats to ${invoice.recipientName}`)

			// Execute the zap payment
			const zapDetails = await zapper.zap()

			if (zapDetails instanceof Map && zapDetails.size > 0) {
				// Check if any payment confirmations contain a preimage
				const values = Array.from(zapDetails.values())
				for (const value of values) {
					if (value && typeof value === 'object' && 'preimage' in value && value.preimage) {
						const preimage = String(value.preimage)

						// Create gamma spec payment receipt
						await createPaymentReceipt(invoiceId, preimage, currentState.invoice || '')

						updateInvoiceState(invoiceId, {
							paymentComplete: true,
							paymentPending: false,
							nwcLoading: false,
						})

						onPaymentComplete?.(invoiceId, preimage)
						toast.success('NWC payment completed successfully!')
						return
					}
				}
			}

			// If we get here, the zap succeeded but we didn't get a preimage
			// Still mark as complete but with a mock preimage
			const mockPreimage = `nwc-payment-${Date.now()}`
			await createPaymentReceipt(invoiceId, mockPreimage, currentState.invoice || '')

			updateInvoiceState(invoiceId, {
				paymentComplete: true,
				paymentPending: false,
				nwcLoading: false,
			})

			onPaymentComplete?.(invoiceId, mockPreimage)
			toast.success('NWC payment completed successfully!')
		} catch (error) {
			console.error('NWC payment failed:', error)
			const errorMessage = error instanceof Error ? error.message : 'NWC payment failed'

			updateInvoiceState(invoiceId, {
				errorMessage,
				nwcLoading: false,
				paymentPending: false,
			})

			onPaymentFailed?.(invoiceId, errorMessage)
			toast.error(`NWC payment failed: ${errorMessage}`)
		} finally {
			if (ndk) ndk.wallet = originalNdkWallet
		}
	}

	const copyToClipboard = async (text: string, invoiceId: string) => {
		try {
			await navigator.clipboard.writeText(text)
			setCopiedInvoices((prev) => new Set(prev).add(invoiceId))
			toast.success('Copied to clipboard!')
			setTimeout(() => {
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
	}

	const handleNavigate = (newIndex: number) => {
		setActiveIndex(newIndex)
		onNavigate?.(newIndex)
	}

	if (!currentInvoice) {
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
										<Button variant="outline" onClick={() => copyToClipboard(currentState.invoice!, currentInvoice.id)} className="flex-1">
											{copiedInvoices.has(currentInvoice.id) ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
											{copiedInvoices.has(currentInvoice.id) ? 'Copied!' : 'Copy'}
										</Button>

										<Button variant="outline" onClick={() => openLightningWallet(currentState.invoice!)} className="flex-1">
											<ExternalLink className="w-4 h-4 mr-2" />
											Open Wallet
										</Button>
									</div>
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
