import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PaymentInvoiceStatus } from '@sdk/commerce/checkout'
import { Button } from '../../primitives/button'
import { Progress } from '../../primitives/progress'

export interface PaymentContentViewProps {
	invoiceCount: number
	completedCount: number
	activeIndex: number
	showNavigation: boolean
	onNavigate: (index: number) => void
	current: { status: PaymentInvoiceStatus; recipientName: string; amount: number }
	isCurrentCompleted: boolean
	/** Optional wallet picker shown above the processor. */
	walletSelector?: ReactNode
	processor: ReactNode
}

function completedLabel(status: PaymentInvoiceStatus): string {
	if (status === 'paid') return '✓ Payment Complete'
	if (status === 'skipped') return '⏭️ Payment Skipped'
	return '⏰ Invoice Expired'
}

export function PaymentContentView({
	invoiceCount,
	completedCount,
	activeIndex,
	showNavigation,
	onNavigate,
	current,
	isCurrentCompleted,
	walletSelector,
	processor,
}: PaymentContentViewProps) {
	const hasNext = activeIndex < invoiceCount - 1

	return (
		<div className="space-y-6 lg:px-6 lg:pb-6">
			{invoiceCount > 1 && (
				<div className="space-y-2">
					<div className="flex justify-between text-sm">
						<span>Payment Progress</span>
						<span>
							{completedCount} of {invoiceCount} completed
						</span>
					</div>
					<Progress value={(completedCount / invoiceCount) * 100} className="w-full" />
				</div>
			)}

			{showNavigation && invoiceCount > 1 && (
				<div className="flex items-center justify-between">
					<h3 className="text-lg font-semibold">
						Payment {activeIndex + 1} of {invoiceCount}
					</h3>
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" onClick={() => onNavigate(activeIndex - 1)} disabled={activeIndex === 0}>
							<ChevronLeft className="w-4 h-4" />
						</Button>
						<span className="text-sm text-gray-500">
							{activeIndex + 1} / {invoiceCount}
						</span>
						<Button variant="ghost" size="sm" onClick={() => onNavigate(activeIndex + 1)} disabled={!hasNext}>
							<ChevronRight className="w-4 h-4" />
						</Button>
					</div>
				</div>
			)}

			{isCurrentCompleted ? (
				<div className="text-center py-8">
					<div className="text-green-600 font-medium mb-2">{completedLabel(current.status)}</div>
					<p className="text-sm text-gray-600 mb-4">
						{current.recipientName} - {current.amount} sats
					</p>
					{hasNext && (
						<Button onClick={() => onNavigate(activeIndex + 1)} variant="outline">
							Next Payment <ChevronRight className="w-4 h-4 ml-1" />
						</Button>
					)}
				</div>
			) : (
				<>
					{walletSelector && <div className="mb-4">{walletSelector}</div>}
					{processor}
				</>
			)}
		</div>
	)
}
