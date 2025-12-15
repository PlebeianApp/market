import { CreditCard, Package, Users } from 'lucide-react'
import type { InvoiceWithSource } from '../useOrderInvoices'

interface PaymentSummaryProps {
	enrichedInvoices: InvoiceWithSource[]
}

export function PaymentSummary({ enrichedInvoices }: PaymentSummaryProps) {
	return (
		<div className="sm:mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
			<div className="flex items-center gap-2">
				<CreditCard className="w-4 h-4 text-green-600" />
				<div>
					<p className="text-gray-500">Merchant</p>
					<p className="font-semibold">{enrichedInvoices.filter((inv) => inv.description === 'Merchant Payment').length} invoice</p>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Users className="w-4 h-4 text-purple-600" />
				<div>
					<p className="text-gray-500">V4V Recipients</p>
					<p className="font-semibold">{enrichedInvoices.filter((inv) => inv.description === 'V4V Community Payment').length} invoices</p>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Package className="w-4 h-4 text-blue-600" />
				<div>
					<p className="text-gray-500">Total Amount</p>
					<p className="font-semibold">{enrichedInvoices.reduce((sum, inv) => sum + inv.amount, 0).toLocaleString()} sats</p>
				</div>
			</div>
		</div>
	)
}
