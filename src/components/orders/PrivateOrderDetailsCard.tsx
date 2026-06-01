import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PrivateOrderDeliveryDetails } from '@/lib/orders/privateOrderMessage'
import { cn } from '@/lib/utils'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { LockKeyhole } from 'lucide-react'
import { getOrderId, getSellerPubkey } from './orderDetailHelpers'

type PrivateOrderDetailsCardProps = {
	order: OrderWithRelatedEvents
	currentUserPubkey?: string
	compact?: boolean
	showUnavailable?: boolean
	className?: string
}

type DetailRow = {
	label: string
	value: string
}

export function canViewPrivateOrderDetails(order: OrderWithRelatedEvents, currentUserPubkey?: string): boolean {
	return Boolean(currentUserPubkey && getSellerPubkey(order.order) === currentUserPubkey)
}

export function getPrivateOrderDetailsRows(details: PrivateOrderDeliveryDetails): DetailRow[] {
	const rows: DetailRow[] = []
	const { delivery } = details

	if (delivery.email) rows.push({ label: 'Digital contact', value: delivery.email })
	if (delivery.name) rows.push({ label: 'Recipient', value: delivery.name })

	const addressLines = getAddressLines(delivery.address)
	if (addressLines.length > 0) {
		rows.push({ label: 'Address', value: addressLines.join('\n') })
	}

	if (delivery.phone) rows.push({ label: 'Phone', value: delivery.phone })
	if (details.orderNotes?.trim()) rows.push({ label: 'Order notes', value: details.orderNotes.trim() })

	return rows
}

export function PrivateOrderDetailsCard({
	order,
	currentUserPubkey,
	compact = false,
	showUnavailable = false,
	className,
}: PrivateOrderDetailsCardProps) {
	if (!canViewPrivateOrderDetails(order, currentUserPubkey)) return null

	const details = order.privateOrderDetails
	if (!details) {
		if (!showUnavailable) return null
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

	const rows = getPrivateOrderDetailsRows(details)
	if (rows.length === 0) return null

	const orderId = getOrderId(order.order)

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

function getAddressLines(address: PrivateOrderDeliveryDetails['delivery']['address']): string[] {
	if (!address) return []
	const cityLine = [address.city, address.zipPostcode].filter(Boolean).join(' ')
	return [address.firstLineOfAddress, address.additionalInformation, cityLine, address.country].filter((line): line is string =>
		Boolean(line?.trim()),
	)
}
