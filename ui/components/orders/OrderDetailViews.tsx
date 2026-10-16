import { CheckCircle, Copy, CreditCard, LockKeyhole, Package, RefreshCw, Truck, Users, Zap } from 'lucide-react'
import { format } from 'date-fns'
import type { PaymentInvoiceData } from '@sdk/commerce/checkout'
import { parseOrderAddress, type InvoiceWithSource, type PrivateOrderDetailRow } from '@sdk/commerce/orders/orderDetail'
import { Badge } from '../../primitives/badge'
import { Button } from '../../primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../primitives/card'
import { UiLink } from '../../provider/UiProvider'
import { cn } from '../../utils/cn'

export function getInvoiceStatusColor(status: string): string {
	switch (status) {
		case 'paid':
			return 'bg-green-100 text-green-800 border-green-300'
		case 'pending':
			return 'bg-yellow-100 text-yellow-800 border-yellow-300'
		case 'processing':
			return 'bg-blue-100 text-blue-800 border-blue-300'
		case 'expired':
			return 'bg-red-100 text-red-800 border-red-300'
		default:
			return 'bg-gray-100 text-gray-800 border-gray-300'
	}
}

export function PaymentSummaryView({ enrichedInvoices }: { enrichedInvoices: readonly InvoiceWithSource[] }) {
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

export interface TrackingInfoViewProps {
	trackingNumber?: string
	carrier?: string
	shippingStatus?: string
	onCopy: (value: string) => void
}

export function TrackingInfoView({ trackingNumber, carrier, shippingStatus, onCopy }: TrackingInfoViewProps) {
	if (!trackingNumber && !carrier) return null

	return (
		<div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
			<div className="flex items-start gap-3">
				<Package className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<p className="font-semibold text-purple-900 mb-2">Tracking Information</p>
					<div className="space-y-2">
						{trackingNumber && (
							<div className="flex items-center justify-between gap-2">
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Tracking URL</p>
									<p className="text-purple-900 font-mono text-sm break-all">{trackingNumber}</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="h-8 px-2 text-purple-700 hover:text-purple-900 hover:bg-purple-100 flex-shrink-0"
									onClick={() => onCopy(trackingNumber)}
								>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						)}
						{carrier && (
							<div>
								<p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Carrier</p>
								<p className="text-purple-900">{carrier}</p>
							</div>
						)}
						{shippingStatus && (
							<div>
								<p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Status</p>
								<p className="text-purple-900 capitalize">{shippingStatus}</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

function AddressField({ label, value, emphasis }: { label: string; value?: string; emphasis?: boolean }) {
	if (!value) return null
	return (
		<div>
			<p className="text-xs font-medium text-green-700 uppercase tracking-wide">{label}</p>
			<p className={emphasis ? 'text-green-900 font-medium' : 'text-green-900'}>{value}</p>
		</div>
	)
}

export function DeliveryAddressView({ shippingAddress }: { shippingAddress: string }) {
	const parsedAddress = parseOrderAddress(shippingAddress)

	return (
		<div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
			<div className="flex items-start gap-3">
				<Truck className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<p className="font-semibold text-green-900 mb-3">Delivery Address</p>
					{parsedAddress ? (
						<div className="space-y-2">
							<AddressField label="Name" value={parsedAddress.name} emphasis />
							{parsedAddress.street && (
								<div>
									<p className="text-xs font-medium text-green-700 uppercase tracking-wide">Street Address</p>
									<p className="text-green-900">{parsedAddress.street}</p>
									{parsedAddress.street2 && <p className="text-green-900">{parsedAddress.street2}</p>}
								</div>
							)}
							<div className="grid grid-cols-2 gap-3">
								<AddressField label="City" value={parsedAddress.city} />
								<AddressField label="State" value={parsedAddress.state} />
							</div>
							<div className="grid grid-cols-2 gap-3">
								<AddressField label="ZIP Code" value={parsedAddress.zip} />
								<AddressField label="Country" value={parsedAddress.country} />
							</div>
						</div>
					) : (
						<div className="text-green-800 space-y-0.5">
							{shippingAddress.split('\n').map((line, index) => (
								<p key={index} className="leading-relaxed">
									{line.trim()}
								</p>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export interface InvoiceCardViewProps {
	invoice: InvoiceWithSource
	index: number
	totalInvoices: number
	isBuyer: boolean
	isGenerating: boolean
	onPay: (invoice: PaymentInvoiceData) => void
	onGenerateNew: (invoice: PaymentInvoiceData) => void
	onCopy: (value: string) => void
	/** Current time in seconds; injectable for tests. */
	now?: number
}

function formatExpiryDisplay(timestamp?: number): string {
	if (!timestamp) return 'No expiry'
	const millis = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
	return format(millis, 'PPP p')
}

export function InvoiceCardView({
	invoice,
	index,
	totalInvoices,
	isBuyer,
	isGenerating,
	onPay,
	onGenerateNew,
	onCopy,
	now = Math.floor(Date.now() / 1000),
}: InvoiceCardViewProps) {
	const isPaid = invoice.status === 'paid'
	// Prefer a still-valid local copy of the invoice over the relay request.
	const validLocalCopy = invoice.localCopies.find(
		(copy) => copy.status !== 'paid' && copy.bolt11 && (!copy.expiresAt || copy.expiresAt > now),
	)
	const invoiceToUse = validLocalCopy || invoice
	const isExpired = !!invoiceToUse.expiresAt && invoiceToUse.expiresAt < now
	const hasBolt11 = !!invoiceToUse.bolt11
	const preimage = invoice.preimage || invoiceToUse.preimage

	return (
		<Card className={cn('p-4', isPaid ? 'bg-green-50' : 'bg-card')}>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3 min-w-0">
					{totalInvoices > 1 && (
						<div
							className={cn(
								'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
								isPaid ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600',
							)}
						>
							{index + 1}
						</div>
					)}
					{isPaid ? (
						<CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
					) : (
						<CreditCard className="w-5 h-5 text-gray-400 flex-shrink-0" />
					)}
					<div className="min-w-0">
						<h4 className="font-medium truncate">{invoice.type === 'merchant' ? 'Merchant Payment' : invoice.recipientName}</h4>
						<p className="text-sm text-muted-foreground">
							{invoice.amount.toLocaleString()} sats
							{invoiceToUse.expiresAt && (
								<span className={cn('ml-2', isExpired ? 'text-red-500' : 'text-gray-400')}>
									· {isExpired ? 'Expired' : 'Expires'} {formatExpiryDisplay(invoiceToUse.expiresAt)}
								</span>
							)}
						</p>
					</div>
				</div>
				<Badge
					className={cn('flex-shrink-0', getInvoiceStatusColor(isPaid ? 'paid' : isExpired ? 'expired' : 'pending'))}
					variant="outline"
				>
					{isPaid ? 'Paid' : isExpired ? 'Expired' : 'Pending'}
				</Badge>
			</div>

			{isBuyer && !isPaid && (
				<div className="mt-4 pt-4 border-t border-muted space-y-3">
					<div className="flex flex-wrap gap-2">
						{hasBolt11 && !isExpired && (
							<Button size="sm" className="flex-1 min-w-[140px]" onClick={() => onPay(invoiceToUse)}>
								<Zap className="w-4 h-4 mr-2" />
								Pay {invoice.amount.toLocaleString()} sats
							</Button>
						)}

						{(isExpired || !hasBolt11) && (
							<Button
								variant={hasBolt11 ? 'outline' : undefined}
								size="sm"
								className="flex-1 min-w-[140px]"
								onClick={() => onGenerateNew(invoice)}
								disabled={isGenerating}
							>
								<RefreshCw className={cn('w-4 h-4 mr-2', isGenerating && 'animate-spin')} />
								{isExpired ? 'Generate New Invoice' : 'Generate Invoice'}
							</Button>
						)}

						{hasBolt11 && (
							<Button variant="ghost" size="sm" onClick={() => onCopy(invoiceToUse.bolt11 || '')} title="Copy lightning invoice">
								<Copy className="w-4 h-4" />
							</Button>
						)}
					</div>

					{isExpired && hasBolt11 && <p className="text-xs text-amber-600">Invoice expired. Generate a new one to continue payment.</p>}
				</div>
			)}

			{isPaid && (
				<div className="mt-3 pt-3 border-t border-green-200 space-y-2">
					<div className="flex items-center gap-2 text-sm text-green-700">
						<CheckCircle className="w-4 h-4" />
						<span>Payment completed</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{invoiceToUse.bolt11 && (
							<Button
								variant="ghost"
								size="sm"
								className="text-gray-600 hover:text-gray-900 h-auto py-1"
								onClick={() => onCopy(invoiceToUse.bolt11 || '')}
							>
								<Copy className="w-3 h-3 mr-1" />
								Copy invoice
							</Button>
						)}
						{preimage && (
							<Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900 h-auto py-1" onClick={() => onCopy(preimage)}>
								<Copy className="w-3 h-3 mr-1" />
								Copy preimage
							</Button>
						)}
					</div>
				</div>
			)}
		</Card>
	)
}

export interface PrivateOrderDetailsViewProps {
	/** Null when the seller cannot decrypt the delivery details. */
	rows: readonly PrivateOrderDetailRow[] | null
	orderId?: string
	compact?: boolean
	className?: string
}

export function PrivateOrderDetailsView({ rows, orderId, compact = false, className }: PrivateOrderDetailsViewProps) {
	if (rows === null) {
		return (
			<Card className={cn('border-amber-200 bg-amber-50', className)}>
				<CardHeader className={cn(compact ? 'p-3 pb-2' : 'p-4 pb-2')}>
					<div className="flex items-center gap-2">
						<LockKeyhole className="h-4 w-4 text-amber-700" />
						<CardTitle className={compact ? 'text-sm' : 'text-base'}>Private delivery details</CardTitle>
					</div>
				</CardHeader>
				<CardContent className={cn('text-sm text-amber-900', compact ? 'p-3 pt-0' : 'p-4 pt-0')}>
					Encrypted delivery details are unavailable. Connect the seller signer that received this order.
				</CardContent>
			</Card>
		)
	}

	if (rows.length === 0) return null

	return (
		<Card className={cn('border-emerald-200 bg-emerald-50', className)}>
			<CardHeader className={cn(compact ? 'p-3 pb-2' : 'p-4 pb-2')}>
				<div className="flex items-center gap-2">
					<LockKeyhole className="h-4 w-4 text-emerald-700" />
					<div>
						<CardTitle className={compact ? 'text-sm' : 'text-base'}>Private encrypted seller delivery details</CardTitle>
						{compact && <p className="text-xs text-emerald-800">Order {orderId ? `${orderId.substring(0, 8)}...` : 'details'}</p>}
					</div>
				</div>
			</CardHeader>
			<CardContent className={cn(compact ? 'p-3 pt-0' : 'p-4 pt-0')}>
				<dl className={cn('grid gap-3', compact ? 'text-sm' : 'sm:grid-cols-2')}>
					{rows.map((row) => (
						<div key={row.label} className={row.label === 'Address' || row.label === 'Order notes' ? 'sm:col-span-2' : undefined}>
							<dt className="text-xs font-medium uppercase tracking-wide text-emerald-900">{row.label}</dt>
							<dd className="mt-1 whitespace-pre-line break-words text-sm text-emerald-950">{row.value}</dd>
						</div>
					))}
				</dl>
			</CardContent>
		</Card>
	)
}

export interface OrderCardViewProps {
	href: string
	orderEventId: string
	isBuyer: boolean
	status: string
	createdAt?: number
}

export function OrderCardView({ href, orderEventId, isBuyer, status, createdAt }: OrderCardViewProps) {
	return (
		<UiLink
			href={href}
			className="flex justify-between items-center hover:bg-accent p-4 border rounded-lg overflow-hidden transition-colors"
		>
			<div className="flex items-center gap-4 min-w-0">
				<div className="flex justify-center items-center bg-pink-400 rounded-full w-12 h-12 text-2xl shrink-0">{isBuyer ? '🛍️' : '💰'}</div>
				<div className="min-w-0">
					<div className="font-medium truncate">
						{isBuyer ? 'Purchase' : 'Sale'} #{orderEventId.slice(0, 8)}
					</div>
					<div className="text-muted-foreground text-sm">{new Date((createdAt || 0) * 1000).toLocaleDateString()}</div>
				</div>
			</div>
			<Badge variant={status.toLowerCase() === 'completed' ? 'default' : 'outline'} className="shrink-0">
				{status}
			</Badge>
		</UiLink>
	)
}
