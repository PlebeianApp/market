import type { PaymentInvoiceData } from '@/lib/types/invoice'
import { PaymentDialogView } from '@ui/components/checkout/PaymentViews'
import { PaymentContent } from './PaymentContent'

interface PaymentDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	invoices: PaymentInvoiceData[]
	currentIndex?: number
	onPaymentComplete?: (invoiceId: string, preimage: string) => void
	onPaymentFailed?: (invoiceId: string, error: string) => void
	title?: string
	showNavigation?: boolean
	nwcEnabled?: boolean
	nwcWalletUri?: string | null
	/** Mode controls how skipped invoices are treated */
	mode?: 'checkout' | 'order'
}

export function PaymentDialog({
	open,
	onOpenChange,
	invoices,
	currentIndex = 0,
	onPaymentComplete,
	onPaymentFailed,
	title = 'Complete Payment',
	showNavigation = true,
	nwcEnabled = true,
	nwcWalletUri,
	mode = 'order',
}: PaymentDialogProps) {
	if (!invoices.length) return null

	const currentInvoice = invoices[currentIndex] || invoices[0]

	return (
		<PaymentDialogView
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={`Complete payment for ${currentInvoice.description}.${invoices.length > 1 ? ` Payment ${currentIndex + 1} of ${invoices.length}.` : ''}`}
		>
			<PaymentContent
				invoices={invoices}
				currentIndex={currentIndex}
				onPaymentComplete={onPaymentComplete}
				onPaymentFailed={onPaymentFailed}
				showNavigation={showNavigation}
				nwcEnabled={nwcEnabled}
				nwcWalletUri={nwcWalletUri}
				mode={mode}
			/>
		</PaymentDialogView>
	)
}
