import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { LightningPaymentProcessor, type LightningPaymentData, type PaymentResult } from '@/components/lightning/LightningPaymentProcessor'
import { ChevronLeft, ChevronRight, CreditCard, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

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

export function PaymentContent({
	invoices,
	currentIndex = 0,
	onPaymentComplete,
	onPaymentFailed,
	showNavigation = true,
	nwcEnabled = true,
	onNavigate,
}: PaymentContentProps) {
	const [activeIndex, setActiveIndex] = useState(currentIndex)
	const [invoiceStates, setInvoiceStates] = useState<Record<string, 'pending' | 'paid' | 'failed'>>({})

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

	const updateInvoiceState = (invoiceId: string, state: 'pending' | 'paid' | 'failed') => {
		setInvoiceStates((prev) => ({
			...prev,
			[invoiceId]: state,
		}))
	}

	const currentInvoice = invoices[activeIndex]

	const handleNavigate = (newIndex: number) => {
		setActiveIndex(newIndex)
		onNavigate?.(newIndex)
	}

	const handlePaymentComplete = (result: PaymentResult) => {
		updateInvoiceState(result.paymentHash || currentInvoice.id, 'paid')
		onPaymentComplete?.(result.paymentHash || currentInvoice.id, result.preimage || '')

		// Auto-advance to the next invoice
		setTimeout(() => {
			if (activeIndex < invoices.length - 1) {
				handleNavigate(activeIndex + 1)
			}
		}, 1500)
	}

	const handlePaymentFailed = (result: PaymentResult) => {
		updateInvoiceState(result.paymentHash || currentInvoice.id, 'failed')
		onPaymentFailed?.(result.paymentHash || currentInvoice.id, result.error || 'Payment failed')
	}

	if (!currentInvoice) {
		return null
	}

	// Convert invoice data to LightningPaymentData format
	const paymentData: LightningPaymentData = {
		amount: currentInvoice.amount,
		description: currentInvoice.description,
		bolt11: currentInvoice.bolt11 || undefined,
		isZap: currentInvoice.type === 'v4v',
		orderId: currentInvoice.orderId,
		invoiceId: currentInvoice.id,
	}

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
						<Badge variant={invoiceStates[currentInvoice.id] === 'paid' ? 'secondary' : 'outline'}>
							{invoiceStates[currentInvoice.id] === 'paid' ? 'Paid' : 'Pending'}
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

			{/* Lightning Payment Processor */}
			{invoiceStates[currentInvoice.id] !== 'paid' && (
				<LightningPaymentProcessor
					data={paymentData}
					onPaymentComplete={handlePaymentComplete}
					onPaymentFailed={handlePaymentFailed}
					showManualVerification={true}
				/>
			)}

			{/* Invoice Progress */}
			{invoices.length > 1 && (
				<div className="space-y-2">
					<div className="flex justify-between text-sm">
						<span>Payment Progress</span>
						<span>
							{Object.values(invoiceStates).filter((state) => state === 'paid').length} of {invoices.length} completed
						</span>
					</div>
					<Progress
						value={(Object.values(invoiceStates).filter((state) => state === 'paid').length / invoices.length) * 100}
						className="w-full"
					/>
				</div>
			)}
		</div>
	)
}
