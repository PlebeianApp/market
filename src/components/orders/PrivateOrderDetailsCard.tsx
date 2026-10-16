import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getPrivateOrderDetailsRows } from '@sdk/commerce/orders/orderDetail'
import { PrivateOrderDetailsView } from '@ui/components/orders/OrderDetailViews'
import { getOrderId, getSellerPubkey } from './orderDetailHelpers'

export { getPrivateOrderDetailsRows } from '@sdk/commerce/orders/orderDetail'

type PrivateOrderDetailsCardProps = {
	order: OrderWithRelatedEvents
	currentUserPubkey?: string
	compact?: boolean
	showUnavailable?: boolean
	className?: string
}

export function canViewPrivateOrderDetails(order: OrderWithRelatedEvents, currentUserPubkey?: string): boolean {
	return Boolean(currentUserPubkey && getSellerPubkey(order.order) === currentUserPubkey)
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
	if (!details && !showUnavailable) return null

	return (
		<PrivateOrderDetailsView
			rows={details ? getPrivateOrderDetailsRows(details) : null}
			orderId={getOrderId(order.order)}
			compact={compact}
			className={className}
		/>
	)
}
