import type { PaymentInvoiceData } from '@/lib/types/invoice'
import { copyToClipboard } from '@/lib/utils'
import { InvoiceCardView } from '@ui/components/orders/OrderDetailViews'
import type { InvoiceWithSource } from '../useOrderInvoices'

interface InvoiceCardProps {
	invoice: InvoiceWithSource
	index: number
	totalInvoices: number
	isBuyer: boolean
	isGenerating: boolean
	onPay: (invoice: PaymentInvoiceData) => void
	onGenerateNew: (invoice: PaymentInvoiceData) => void
}

export function InvoiceCard(props: InvoiceCardProps) {
	return <InvoiceCardView {...props} onCopy={(value) => copyToClipboard(value)} />
}
