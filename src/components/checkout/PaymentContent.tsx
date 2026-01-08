import {
	LightningPaymentProcessor,
	type LightningPaymentData,
	type LightningPaymentProcessorRef,
	type PaymentResult,
} from '@/components/lightning/LightningPaymentProcessor'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { WalletSelector } from '@/components/checkout/WalletSelector'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { toast } from 'sonner'

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
	nwcWalletUri?: string | null // NWC wallet URI to pass to payment processor
	onNavigate?: (index: number) => void
	availableWalletsBySeller?: Record<string, any[]> // PaymentDetail[]
	selectedWallets?: Record<string, string>
	onWalletChange?: (sellerPubkey: string, walletId: string) => void
	/**
	 * Mode controls how "skipped" status is treated:
	 * - 'checkout': skipped invoices show as completed (used during checkout flow)
	 * - 'order': skipped invoices can be re-attempted (used in order details)
	 */
	mode?: 'checkout' | 'order'
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
			nwcWalletUri,
			onNavigate,
			availableWalletsBySeller = {},
			selectedWallets = {},
			onWalletChange,
			mode = 'checkout',
		},
		ref,
	) => {
		const processorRef = useRef<LightningPaymentProcessorRef | null>(null)
		const bulkQueueRef = useRef<string[]>([])
		const isBulkPayingRef = useRef(false)
		const invoicesRef = useRef<PaymentInvoiceData[]>(invoices)

		// Clamp index to valid range
		const activeIndex = Math.min(Math.max(0, currentIndex), Math.max(0, invoices.length - 1))
		const currentInvoice = invoices[activeIndex]
		const currentInvoiceRef = useRef<PaymentInvoiceData | undefined>(currentInvoice)

		// Keep refs in sync to avoid stale closures in bulk flow
		useEffect(() => {
			invoicesRef.current = invoices
			currentInvoiceRef.current = currentInvoice
		}, [invoices, currentInvoice])

		// Count completed invoices from parent state (single source of truth)
		// In 'order' mode, only 'paid' counts as completed (skipped can be re-attempted)
		const isCompletedForProgress = (inv: PaymentInvoiceData) =>
			inv.status === 'paid' || inv.status === 'skipped' || inv.status === 'expired'

		const completedCount = useMemo(() => {
			if (mode === 'order') {
				return invoices.filter((inv) => inv.status === 'paid').length
			}
			return invoices.filter(isCompletedForProgress).length
		}, [invoices, mode])

		// Build payment data for current invoice only
		const currentPaymentData = useMemo((): LightningPaymentData | null => {
			if (!currentInvoice) return null

			// Use existing bolt11 if available
			const existingBolt11 = currentInvoice.bolt11 || undefined

			return {
				invoiceId: currentInvoice.id,
				amount: currentInvoice.amount,
				description: currentInvoice.description,
				recipientName: currentInvoice.recipientName,
				bolt11: existingBolt11,
				monitorZapReceipt: true,
			}
		}, [currentInvoice])

		const handleNavigate = useCallback(
			(newIndex: number) => {
				const clampedIndex = Math.min(Math.max(0, newIndex), invoices.length - 1)
				console.log(`🧭 Navigating to payment ${clampedIndex + 1}`)
				onNavigate?.(clampedIndex)
			},
			[invoices.length, onNavigate],
		)

		const triggerNextBulkPayment = useCallback(async () => {
			if (!isBulkPayingRef.current) return

			if (!nwcEnabled) {
				isBulkPayingRef.current = false
				toast.error('NWC not available for bulk payments')
				return
			}

			const invoicesSnapshot = invoicesRef.current
			const targetId = bulkQueueRef.current[0]
			const currentSnapshot = currentInvoiceRef.current

			if (!targetId) {
				isBulkPayingRef.current = false
				toast.success('All invoices paid')
				return
			}

			if (!currentSnapshot || currentSnapshot.id !== targetId) {
				const targetIndex = invoicesSnapshot.findIndex((inv) => inv.id === targetId)
				if (targetIndex === -1) {
					// Invoice disappeared; drop and continue
					bulkQueueRef.current.shift()
					triggerNextBulkPayment()
					return
				}
				onNavigate?.(Math.min(Math.max(0, targetIndex), invoicesSnapshot.length - 1))
				setTimeout(triggerNextBulkPayment, 200)
				return
			}

			if (!processorRef.current?.isReady()) {
				setTimeout(triggerNextBulkPayment, 250)
				return
			}

			try {
				await processorRef.current.triggerNwcPayment()
			} catch (error) {
				console.error('NWC payment failed during bulk run:', error)
				isBulkPayingRef.current = false
				bulkQueueRef.current = []
				toast.error('Bulk payment stopped')
			}
		}, [nwcEnabled, onNavigate])

		// Use the invoice ID from the result to ensure we're marking the correct invoice
		const handlePaymentComplete = useCallback(
			(result: PaymentResult) => {
				const invoiceId = result.invoiceId || currentInvoice?.id
				if (!invoiceId) {
					console.error('❌ No invoice ID available for payment complete')
					return
				}
				console.log(`✅ Payment complete for invoice: ${invoiceId}`)
				onPaymentComplete?.(invoiceId, result.preimage || '')

				if (isBulkPayingRef.current) {
					bulkQueueRef.current = bulkQueueRef.current.filter((id) => id !== invoiceId)
					setTimeout(triggerNextBulkPayment, 250)
				}
			},
			[currentInvoice?.id, onPaymentComplete, triggerNextBulkPayment],
		)

		const handlePaymentFailed = useCallback(
			(result: PaymentResult) => {
				const invoiceId = result.invoiceId || currentInvoice?.id
				if (!invoiceId) {
					console.error('❌ No invoice ID available for payment failed')
					return
				}
				console.log(`❌ Payment failed for invoice: ${invoiceId}: ${result.error}`)
				onPaymentFailed?.(invoiceId, result.error || 'Payment failed')

				if (isBulkPayingRef.current) {
					isBulkPayingRef.current = false
					bulkQueueRef.current = []
				}
			},
			[currentInvoice?.id, onPaymentFailed],
		)

		const handleSkipPayment = useCallback(() => {
			if (!currentInvoice) {
				console.error('❌ No current invoice to skip')
				return
			}
			console.log(`⏭️ Skipping payment for invoice: ${currentInvoice.id}`)
			onSkipPayment?.(currentInvoice.id)
			if (isBulkPayingRef.current) {
				bulkQueueRef.current = bulkQueueRef.current.filter((id) => id !== currentInvoice.id)
				setTimeout(triggerNextBulkPayment, 200)
			}
		}, [currentInvoice, onSkipPayment, triggerNextBulkPayment])

		// Pay all with NWC - navigates through pending invoices and processes them sequentially
		const payAllWithNwc = useCallback(async () => {
			if (!nwcEnabled) {
				toast.error('NWC not available for bulk payments')
				return
			}

			if (isBulkPayingRef.current) {
				toast.info('Bulk payment already in progress')
				return
			}

			const payableInvoiceIds = invoices.filter((inv) => inv.status === 'pending' || inv.status === 'failed').map((inv) => inv.id)
			if (payableInvoiceIds.length === 0) {
				toast.info('No pending invoices to pay')
				return
			}

			toast.info(`Starting payment for ${payableInvoiceIds.length} invoices...`)
			bulkQueueRef.current = payableInvoiceIds
			isBulkPayingRef.current = true
			triggerNextBulkPayment()
		}, [invoices, nwcEnabled, triggerNextBulkPayment])

		useImperativeHandle(ref, () => ({ payAllWithNwc }), [payAllWithNwc])

		// Early return if no invoice
		if (!currentInvoice || !currentPaymentData) {
			return <div className="text-sm text-muted-foreground p-4">No invoice to display</div>
		}

		// Check if current invoice is already completed
		// In 'order' mode, only 'paid' is considered completed (skipped can be re-attempted)
		const isCurrentCompleted = mode === 'order' ? currentInvoice.status === 'paid' : isCompletedForProgress(currentInvoice)

		// Get wallet info for current invoice
		const sellerPubkey = currentInvoice.recipientPubkey
		const availableWallets = availableWalletsBySeller[sellerPubkey] || []
		const selectedWalletId = selectedWallets[sellerPubkey] || null
		const isMerchantInvoice = currentInvoice.type === 'merchant'

		return (
			<div className="space-y-6 lg:px-6 lg:pb-6">
				{/* Progress bar */}
				{invoices.length > 1 && (
					<div className="space-y-2">
						<div className="flex justify-between text-sm">
							<span>Payment Progress</span>
							<span>
								{completedCount} of {invoices.length} completed
							</span>
						</div>
						<Progress value={(completedCount / invoices.length) * 100} className="w-full" />
					</div>
				)}

				{/* Navigation header */}
				{showNavigation && invoices.length > 1 && (
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-semibold">
							Payment {activeIndex + 1} of {invoices.length}
						</h3>
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="sm" onClick={() => handleNavigate(activeIndex - 1)} disabled={activeIndex === 0}>
								<ChevronLeft className="w-4 h-4" />
							</Button>
							<span className="text-sm text-gray-500">
								{activeIndex + 1} / {invoices.length}
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => handleNavigate(activeIndex + 1)}
								disabled={activeIndex === invoices.length - 1}
							>
								<ChevronRight className="w-4 h-4" />
							</Button>
						</div>
					</div>
				)}

				{/* Show completed message if current invoice is done */}
				{isCurrentCompleted ? (
					<div className="text-center py-8">
						<div className="text-green-600 font-medium mb-2">
							{currentInvoice.status === 'paid'
								? '✓ Payment Complete'
								: currentInvoice.status === 'skipped'
									? '⏭️ Payment Skipped'
									: '⏰ Invoice Expired'}
						</div>
						<p className="text-sm text-gray-600 mb-4">
							{currentInvoice.recipientName} - {currentInvoice.amount} sats
						</p>
						{activeIndex < invoices.length - 1 && (
							<Button onClick={() => handleNavigate(activeIndex + 1)} variant="outline">
								Next Payment <ChevronRight className="w-4 h-4 ml-1" />
							</Button>
						)}
					</div>
				) : (
					<>
						{/* Wallet selector for merchant invoices */}
						{isMerchantInvoice && availableWallets.length > 0 && onWalletChange && (
							<div className="mb-4">
								<WalletSelector
									wallets={availableWallets.map((w) => ({ ...w, displayName: w.paymentDetail }))}
									selectedWalletId={selectedWalletId}
									onSelect={(walletId) => onWalletChange(sellerPubkey, walletId)}
									sellerName={currentInvoice.recipientName}
								/>
							</div>
						)}

						{/* Single payment processor - key forces remount on invoice change */}
						<LightningPaymentProcessor
							key={`processor-${currentInvoice.id}-${activeIndex}`}
							ref={processorRef}
							data={currentPaymentData}
							onPaymentComplete={handlePaymentComplete}
							onPaymentFailed={handlePaymentFailed}
							onSkipPayment={handleSkipPayment}
							className="shadow-none border-0"
							showManualVerification={true}
							active={true}
							showNavigation={false}
							skippable={true}
							nwcWalletUri={nwcWalletUri}
						/>
					</>
				)}
			</div>
		)
	},
)

PaymentContent.displayName = 'PaymentContent'
