import {
	LightningPaymentProcessor,
	type LightningPaymentData,
	type LightningPaymentProcessorRef,
	type PaymentResult,
} from '@/components/lightning/LightningPaymentProcessor'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { WalletSelector } from '@/components/checkout/WalletSelector'
import { ndkStore } from '@/lib/stores/ndk'
import { NDKUser } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

export interface PaymentInvoiceData {
	id: string
	orderId: string
	bolt11?: string | null
	amount: number
	description: string
	recipientName: string
	status: 'pending' | 'paid' | 'expired' | 'skipped'
	expiresAt?: number
	createdAt: number
	lightningAddress?: string | null
	recipientPubkey: string
	type: 'merchant' | 'v4v'
}

export interface PaymentContentRef {
	payAllWithNwc: () => Promise<void>
}

interface PaymentContentProps {
	invoices: PaymentInvoiceData[]
	currentIndex?: number
	onPaymentComplete?: (invoiceId: string, preimage: string) => void
	onPaymentFailed?: (invoiceId: string, error: string) => void
	onSkipPayment?: (invoiceId: string) => void
	showNavigation?: boolean
	nwcEnabled?: boolean
	onNavigate?: (index: number) => void
	availableWalletsBySeller?: Record<string, any[]> // PaymentDetail[]
	selectedWallets?: Record<string, string>
	onWalletChange?: (sellerPubkey: string, walletId: string) => void
}

export const PaymentContent = forwardRef<PaymentContentRef, PaymentContentProps>(
	(
		{
			invoices,
			currentIndex = 0,
			onPaymentComplete,
			onPaymentFailed,
			onSkipPayment,
			showNavigation = true,
			nwcEnabled = true,
			onNavigate,
			availableWalletsBySeller = {},
			selectedWallets = {},
			onWalletChange,
		},
		ref,
	) => {
		const [activeIndex, setActiveIndex] = useState(currentIndex)
		const [invoiceStates, setInvoiceStates] = useState<Record<string, 'pending' | 'paid' | 'failed' | 'skipped'>>({})
		const ndkState = useStore(ndkStore)

		// Refs to control all payment processors
		const processorRefs = useRef<Record<string, LightningPaymentProcessorRef | null>>({})

		// Initialize invoice states
		useEffect(() => {
			const newStates: Record<string, 'pending' | 'paid' | 'failed'> = {}
			invoices.forEach((invoice) => {
				newStates[invoice.id] = invoice.status === 'paid' ? 'paid' : 'pending'
			})
			setInvoiceStates(newStates)
		}, [invoices])

		// Update active index when currentIndex prop changes
		useEffect(() => {
			setActiveIndex(currentIndex)
		}, [currentIndex])

		// Clamp activeIndex whenever invoices length changes
		useEffect(() => {
			if (activeIndex >= invoices.length) {
				setActiveIndex(Math.max(0, invoices.length - 1))
			}
		}, [invoices.length, activeIndex])

		const updateInvoiceState = (invoiceId: string, state: 'pending' | 'paid' | 'failed' | 'skipped') => {
			setInvoiceStates((prev) => ({
				...prev,
				[invoiceId]: state,
			}))
		}

		const currentInvoice = invoices[activeIndex]

		const handleNavigate = (newIndex: number) => {
			console.log(`🧭 Navigating from payment ${activeIndex + 1} to ${newIndex + 1}`)
			setActiveIndex(newIndex)
			onNavigate?.(newIndex)
		}

		const handlePaymentComplete = useCallback(
			(result: PaymentResult) => {
				updateInvoiceState(result.paymentHash || currentInvoice.id, 'paid')
				onPaymentComplete?.(result.paymentHash || currentInvoice.id, result.preimage || '')

				// Auto-advance to the next invoice
				setTimeout(() => {
					setActiveIndex((prev) => {
						const next = prev + 1
						if (next < invoices.length) {
							onNavigate?.(next)
							return next
						}
						return prev
					})
				}, 1500)
			},
			[currentInvoice, onPaymentComplete, onNavigate, invoices.length],
		)

		const handlePaymentFailed = useCallback(
			(result: PaymentResult) => {
				updateInvoiceState(result.paymentHash || currentInvoice.id, 'failed')
				onPaymentFailed?.(result.paymentHash || currentInvoice.id, result.error || 'Payment failed')
			},
			[currentInvoice, onPaymentFailed],
		)

		const handleSkipPayment = useCallback(() => {
			const invoiceId = currentInvoice.id
			console.log(`⏭️ Skipping payment for invoice:`, invoiceId)

			// Mark as skipped
			updateInvoiceState(invoiceId, 'skipped')
			onSkipPayment?.(invoiceId)

			// Auto-advance to the next invoice after a short delay
			setTimeout(() => {
				setActiveIndex((prev) => {
					const next = prev + 1
					if (next < invoices.length) {
						onNavigate?.(next)
						return next
					}
					// If this was the last invoice, parent component will handle completion
					return prev
				})
			}, 500)
		}, [currentInvoice, onSkipPayment, onNavigate, invoices.length])

		// Memoize payment data for all invoices
		const allPaymentData = useMemo(() => {
			console.log('🔄 Memoizing payment data for', invoices.length, 'invoices')
			return invoices.map((invoice) => {
				// V4V payments should always be zaps
				// Merchant payments use regular bolt11 invoices
				const isZap = invoice.type === 'v4v'

				let recipient: NDKUser | undefined
				if (isZap && ndkState.ndk) {
					recipient = ndkState.ndk.getUser({ pubkey: invoice.recipientPubkey })
				}

				console.log(`📋 Processing invoice ${invoice.id}:`, {
					type: invoice.type,
					isZap,
					recipientName: invoice.recipientName,
					amount: invoice.amount,
					hasRecipient: !!recipient,
				})

				return {
					invoiceId: invoice.id,
					data: {
						amount: invoice.amount,
						description: invoice.description,
						recipientName: invoice.recipientName,
						// For zaps, let NDKZapper generate the invoice
						// For merchant payments, use the pre-generated bolt11
						bolt11: isZap ? undefined : invoice.bolt11 || undefined,
						isZap,
						recipient: isZap ? recipient : undefined,
						orderId: invoice.orderId,
						invoiceId: invoice.id,
					} as LightningPaymentData,
				}
			})
		}, [invoices, ndkState.ndk])

		// Use useCallback to prevent setState during render
		const payAllWithNwc = useCallback(async () => {
			const pendingInvoices = invoices.filter((inv) => invoiceStates[inv.id] === 'pending')
			if (pendingInvoices.length === 0) {
				toast.info('No pending invoices to pay')
				return
			}

			toast.info(`Starting bulk payment for ${pendingInvoices.length} invoices...`)

			for (let i = 0; i < pendingInvoices.length; i++) {
				const invoice = pendingInvoices[i]
				const processorRef = processorRefs.current[invoice.id]

				if (!processorRef?.isReady()) {
					console.warn(`Payment processor not ready for ${invoice.recipientName}`)
					continue
				}

				try {
					await processorRef.triggerNwcPayment()
					toast.success(`Payment ${i + 1}/${pendingInvoices.length} completed: ${invoice.recipientName}`)

					// Small delay between payments to avoid overwhelming the wallet
					if (i < pendingInvoices.length - 1) {
						await new Promise((resolve) => setTimeout(resolve, 1000))
					}
				} catch (error) {
					console.error(`Bulk payment failed for invoice ${invoice.id}:`, error)
					toast.error(`Payment failed for ${invoice.recipientName}`)
					break // Stop on first failure
				}
			}
		}, [invoices, invoiceStates])

		// Expose pay all function via ref
		useImperativeHandle(
			ref,
			() => ({
				payAllWithNwc,
			}),
			[payAllWithNwc],
		)

		// Early return after all hooks are called
		if (!currentInvoice) {
			return <div className="text-sm text-muted-foreground">No invoice selected</div>
		}

		return (
			<div className="lg:space-y-6 lg:px-6 lg:pb-6">
				{/* Invoice Progress - Moved to top */}
				{invoices.length > 1 && (
					<div className="space-y-2 mb-4">
						<div className="flex justify-between text-sm">
							<span>Payment Progress</span>
							<span>
								{Object.values(invoiceStates).filter((state) => state === 'paid' || state === 'skipped').length} of {invoices.length}{' '}
								completed
							</span>
						</div>
						<Progress
							value={
								(Object.values(invoiceStates).filter((state) => state === 'paid' || state === 'skipped').length / invoices.length) * 100
							}
							className="w-full"
						/>
					</div>
				)}

				{/* Navigation Header */}
				{showNavigation && invoices.length > 1 && (
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-semibold">
							Payment {activeIndex + 1} of {invoices.length}
						</h3>
						<div className="flex items-center gap-6">
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

				{/* Render ALL Lightning Payment Processors (hidden except for current) */}
				{allPaymentData.map(({ invoiceId, data }, index) => {
					const invoice = invoices[index]
					const sellerPubkey = invoice?.recipientPubkey
					const availableWallets = sellerPubkey ? availableWalletsBySeller[sellerPubkey] || [] : []
					const selectedWalletId = sellerPubkey ? selectedWallets[sellerPubkey] : null
					const isMerchantInvoice = invoice?.type === 'merchant'

					return (
						<div
							key={invoiceId}
							style={{
								display:
									index === activeIndex && invoiceStates[invoiceId] !== 'paid' && invoiceStates[invoiceId] !== 'skipped' ? 'block' : 'none',
							}}
						>
							{/* Wallet Selector for merchant invoices with multiple wallets */}
							{isMerchantInvoice && availableWallets.length > 0 && onWalletChange && (
								<div className="mb-4">
									<WalletSelector
										wallets={availableWallets.map((w) => ({ ...w, displayName: w.paymentDetail }))}
										selectedWalletId={selectedWalletId}
										onSelect={(walletId) => {
											if (sellerPubkey) {
												onWalletChange(sellerPubkey, walletId)
											}
										}}
										sellerName={invoice?.recipientName}
									/>
								</div>
							)}

							<LightningPaymentProcessor
								ref={(el) => {
									processorRefs.current[invoiceId] = el
								}}
								data={data}
								onPaymentComplete={handlePaymentComplete}
								onPaymentFailed={handlePaymentFailed}
								onSkipPayment={handleSkipPayment}
								className="shadow-none border-0"
								showManualVerification={true}
								active={index === activeIndex} // Only the current processor is active
								showNavigation={invoices.length > 1}
								currentIndex={activeIndex}
								totalInvoices={invoices.length}
								onNavigate={handleNavigate}
								skippable={true}
							/>
						</div>
					)
				})}
			</div>
		)
	},
)
