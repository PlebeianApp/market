import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { QRCode } from '@/components/ui/qr-code'
import type { InvoiceData, OrderInvoiceSet } from '@/lib/utils/orderUtils'
import { copyToClipboard } from '@/lib/utils'
import { formatDistance } from 'date-fns'
import { AlertTriangle, Check, Clock, Copy, RefreshCw, Users, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface OrderInvoiceTrackingProps {
	invoiceSet: OrderInvoiceSet
	onInvoiceStatusUpdate?: (invoiceId: string, status: InvoiceData['status']) => void
	onRefresh?: () => void
	onReattemptPayment?: (invoiceId: string, sellerPubkey: string, amountSats: number) => void
	showQRCodes?: boolean
}

export function OrderInvoiceTracking({
	invoiceSet,
	onInvoiceStatusUpdate,
	onRefresh,
	onReattemptPayment,
	showQRCodes = true,
}: OrderInvoiceTrackingProps) {
	const [copySuccess, setCopySuccess] = useState<string | null>(null)

	const merchantInvoices = invoiceSet.invoices.filter((inv) => inv.type === 'merchant')
	const v4vInvoices = invoiceSet.invoices.filter((inv) => inv.type === 'v4v')

	const paidInvoices = invoiceSet.invoices.filter((inv) => inv.status === 'paid')
	const pendingInvoices = invoiceSet.invoices.filter((inv) => inv.status === 'pending')
	const failedInvoices = invoiceSet.invoices.filter((inv) => inv.status === 'failed' || inv.status === 'expired')

	const completionPercentage = (paidInvoices.length / invoiceSet.invoices.length) * 100
	const amountPaid = paidInvoices.reduce((sum, inv) => sum + inv.amountSats, 0)

	const handleCopyInvoice = async (bolt11: string, invoiceId: string) => {
		await copyToClipboard(bolt11)
		setCopySuccess(invoiceId)
		toast.success('Invoice copied to clipboard')
		setTimeout(() => setCopySuccess(null), 2000)
	}

	const getStatusIcon = (status: InvoiceData['status']) => {
		switch (status) {
			case 'paid':
				return <Check className="w-4 h-4 text-green-600" />
			case 'pending':
				return <Clock className="w-4 h-4 text-yellow-600" />
			case 'expired':
			case 'failed':
				return <AlertTriangle className="w-4 h-4 text-red-600" />
			default:
				return <Clock className="w-4 h-4 text-gray-400" />
		}
	}

	const getStatusColor = (status: InvoiceData['status']) => {
		switch (status) {
			case 'paid':
				return 'bg-green-100 text-green-800'
			case 'pending':
				return 'bg-yellow-100 text-yellow-800'
			case 'expired':
			case 'failed':
				return 'bg-red-100 text-red-800'
			default:
				return 'bg-gray-100 text-gray-800'
		}
	}

	const formatTimeRemaining = (expiresAt?: number) => {
		if (!expiresAt) return null
		const now = Date.now()
		if (expiresAt <= now) return 'Expired'
		return `Expires ${formatDistance(expiresAt, now, { addSuffix: true })}`
	}

	return (
		<div className="space-y-6">
			{/* Overall Status */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<span>Payment Status</span>
						<div className="flex items-center gap-2">
							<Badge variant={invoiceSet.status === 'complete' ? 'primary' : 'secondary'}>{invoiceSet.status.toUpperCase()}</Badge>
							{onRefresh && (
								<Button variant="outline" size="sm" onClick={onRefresh}>
									<RefreshCw className="w-4 h-4" />
								</Button>
							)}
						</div>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<div className="flex justify-between text-sm">
							<span>Progress</span>
							<span>
								{paidInvoices.length} / {invoiceSet.invoices.length} invoices paid
							</span>
						</div>
						<Progress value={completionPercentage} className="h-2" />
					</div>

					<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
						<div>
							<div className="text-gray-600">Total Amount</div>
							<div className="font-semibold">{invoiceSet.totalAmount.toLocaleString()} sats</div>
						</div>
						<div>
							<div className="text-gray-600">Amount Paid</div>
							<div className="font-semibold text-green-600">{amountPaid.toLocaleString()} sats</div>
						</div>
						<div>
							<div className="text-gray-600">Remaining</div>
							<div className="font-semibold text-orange-600">{(invoiceSet.totalAmount - amountPaid).toLocaleString()} sats</div>
						</div>
						<div>
							<div className="text-gray-600">Status</div>
							<div className="flex items-center gap-1">
								{getStatusIcon(invoiceSet.status as any)}
								<span className="font-semibold capitalize">{invoiceSet.status}</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Merchant Invoices */}
			{merchantInvoices.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Zap className="w-5 h-5 text-yellow-600" />
							Merchant Payment
							<Badge variant="outline">{invoiceSet.merchantAmount.toLocaleString()} sats</Badge>
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{merchantInvoices.map((invoice) => (
							<div key={invoice.id} className="space-y-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										{getStatusIcon(invoice.status)}
										<span className="font-medium">Invoice {invoice.id.substring(0, 8)}...</span>
										<Badge className={getStatusColor(invoice.status)}>{invoice.status}</Badge>
									</div>
									<div className="text-sm text-gray-600">{invoice.amountSats.toLocaleString()} sats</div>
								</div>

								{invoice.bolt11 && showQRCodes && invoice.status === 'pending' && (
									<div className="flex flex-col md:flex-row gap-4">
										<div className="flex-shrink-0">
											<QRCode value={invoice.bolt11} size={150} title="Lightning Invoice" description="Scan to pay with Lightning" />
										</div>
										<div className="flex-1 space-y-2">
											<div className="text-sm text-gray-600">Lightning Invoice</div>
											<div className="bg-gray-50 p-2 rounded border text-xs font-mono break-all">{invoice.bolt11}</div>
											<div className="flex gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => handleCopyInvoice(invoice.bolt11!, invoice.id)}
													disabled={copySuccess === invoice.id}
												>
													{copySuccess === invoice.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
													{copySuccess === invoice.id ? 'Copied!' : 'Copy Invoice'}
												</Button>
											</div>
											{invoice.expiresAt && <div className="text-xs text-gray-500">{formatTimeRemaining(invoice.expiresAt)}</div>}
										</div>
									</div>
								)}

								{invoice.status === 'paid' && (
									<div className="bg-green-50 p-3 rounded border border-green-200">
										<div className="flex items-center gap-2 text-green-800">
											<Check className="w-4 h-4" />
											<span className="font-medium">Payment Confirmed</span>
										</div>
									</div>
								)}

								{(invoice.status === 'failed' || invoice.status === 'expired') && onReattemptPayment && (
									<div className="bg-red-50 p-3 rounded border border-red-200">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 text-red-800">
												<AlertTriangle className="w-4 h-4" />
												<span className="font-medium">Payment {invoice.status === 'expired' ? 'Expired' : 'Failed'}</span>
											</div>
											<Button
												variant="outline"
												size="sm"
												onClick={() => onReattemptPayment(invoice.id, invoice.sellerPubkey, invoice.amountSats)}
												className="text-red-700 border-red-300 hover:bg-red-100"
											>
												<RefreshCw className="w-4 h-4 mr-1" />
												Request New Invoice
											</Button>
										</div>
										<div className="text-sm text-red-700 mt-1">
											{invoice.status === 'expired'
												? 'This payment request has expired. Request a new invoice to continue.'
												: 'Payment failed. Request a new invoice to try again.'}
										</div>
									</div>
								)}
							</div>
						))}
					</CardContent>
				</Card>
			)}

			{/* V4V Invoices */}
			{v4vInvoices.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Users className="w-5 h-5 text-purple-600" />
							Value for Value Recipients
							<Badge variant="outline">{invoiceSet.v4vAmount.toLocaleString()} sats</Badge>
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{v4vInvoices.map((invoice) => (
							<div key={invoice.id} className="space-y-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										{getStatusIcon(invoice.status)}
										<span className="font-medium">V4V {invoice.id.substring(0, 8)}...</span>
										<Badge className={getStatusColor(invoice.status)}>{invoice.status}</Badge>
									</div>
									<div className="text-sm text-gray-600">{invoice.amountSats.toLocaleString()} sats</div>
								</div>

								{invoice.bolt11 && showQRCodes && invoice.status === 'pending' && (
									<div className="flex flex-col md:flex-row gap-4">
										<div className="flex-shrink-0">
											<QRCode value={invoice.bolt11} size={120} title="V4V Lightning Invoice" description="Value for Value payment" />
										</div>
										<div className="flex-1 space-y-2">
											<div className="text-sm text-gray-600">V4V Lightning Invoice</div>
											<div className="bg-gray-50 p-2 rounded border text-xs font-mono break-all">{invoice.bolt11}</div>
											<div className="flex gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => handleCopyInvoice(invoice.bolt11!, invoice.id)}
													disabled={copySuccess === invoice.id}
												>
													{copySuccess === invoice.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
													{copySuccess === invoice.id ? 'Copied!' : 'Copy'}
												</Button>
											</div>
											{invoice.expiresAt && <div className="text-xs text-gray-500">{formatTimeRemaining(invoice.expiresAt)}</div>}
										</div>
									</div>
								)}

								{(invoice.status === 'failed' || invoice.status === 'expired') && onReattemptPayment && (
									<div className="bg-red-50 p-3 rounded border border-red-200">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 text-red-800">
												<AlertTriangle className="w-4 h-4" />
												<span className="font-medium">V4V Payment {invoice.status === 'expired' ? 'Expired' : 'Failed'}</span>
											</div>
											<Button
												variant="outline"
												size="sm"
												onClick={() => onReattemptPayment(invoice.id, invoice.sellerPubkey, invoice.amountSats)}
												className="text-red-700 border-red-300 hover:bg-red-100"
											>
												<RefreshCw className="w-4 h-4 mr-1" />
												Request New Invoice
											</Button>
										</div>
										<div className="text-sm text-red-700 mt-1">
											{invoice.status === 'expired'
												? 'This V4V payment request has expired. Request a new invoice to continue.'
												: 'V4V payment failed. Request a new invoice to try again.'}
										</div>
									</div>
								)}
							</div>
						))}
					</CardContent>
				</Card>
			)}

			{/* Summary Actions */}
			{pendingInvoices.length > 0 && (
				<Card className="border-yellow-200 bg-yellow-50">
					<CardContent className="p-4">
						<div className="flex items-center gap-2 text-yellow-800">
							<Clock className="w-4 h-4" />
							<span className="font-medium">
								{pendingInvoices.length} invoice{pendingInvoices.length !== 1 ? 's' : ''} awaiting payment
							</span>
						</div>
						<div className="text-sm text-yellow-700 mt-1">Please complete all payments to finalize your order.</div>
					</CardContent>
				</Card>
			)}

			{failedInvoices.length > 0 && (
				<Card className="border-red-200 bg-red-50">
					<CardContent className="p-4">
						<div className="flex items-center gap-2 text-red-800">
							<AlertTriangle className="w-4 h-4" />
							<span className="font-medium">
								{failedInvoices.length} invoice{failedInvoices.length !== 1 ? 's' : ''} failed or expired
							</span>
						</div>
						<div className="text-sm text-red-700 mt-1">Contact support if you need assistance with failed payments.</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
