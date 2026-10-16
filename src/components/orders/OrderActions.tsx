import { ORDER_STATUS, SHIPPING_STATUS } from '@/lib/schemas/order'
import { useUpdateOrderStatusMutation } from '@/publish/orders'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { getOrderStatus } from '@/queries/orders'
import { getOrderManagementActions, getOrderRecipientPubkey } from '@sdk/commerce/orders'
import { useUpdateShippingStatusMutation } from '@/queries/shipping'
import { useState } from 'react'
import { toast } from 'sonner'
import { OrderActionsView } from '@ui/components/orders/OrderActionsView'
import { StockUpdateDialog } from './StockUpdateDialog'

interface OrderActionsProps {
	order: OrderWithRelatedEvents
	userPubkey: string
	className?: string
}

export function OrderActions({ order, userPubkey, className = '' }: OrderActionsProps) {
	const [isStockUpdateOpen, setIsStockUpdateOpen] = useState(false)
	const updateOrderStatus = useUpdateOrderStatusMutation()
	const updateShippingStatus = useUpdateShippingStatusMutation()

	const status = getOrderStatus(order)
	const isBuyer = userPubkey === order.order.pubkey
	const isSeller = userPubkey === getOrderRecipientPubkey(order.order)

	const hasBeenShipped = order.shippingUpdates.some((update) => update.tags.find((tag) => tag[0] === 'status')?.[1] === 'shipped')
	const actions = getOrderManagementActions({
		role: isBuyer ? 'buyer' : isSeller ? 'seller' : 'other',
		orderStatus: status,
		shippingStatus: hasBeenShipped ? 'shipped' : null,
	})

	const handleStatusUpdate = (newStatus: string, reason?: string) => {
		const orderEventId = order.order.id
		if (!orderEventId) {
			toast.error('Order ID not found')
			return
		}
		updateOrderStatus.mutate({ orderEventId, status: newStatus as any, reason })
	}

	const handleShipped = (trackingUrl: string) => {
		const orderEventId = order.order.id
		if (!orderEventId) {
			toast.error('Order ID not found')
			return
		}
		updateShippingStatus.mutate({
			orderEventId,
			status: SHIPPING_STATUS.SHIPPED,
			tracking: trackingUrl,
			reason: 'Order has been shipped',
		})
		setIsStockUpdateOpen(true)
	}

	if (!isBuyer && !isSeller) return null

	return (
		<OrderActionsView
			actions={actions}
			status={status}
			isUpdatingStatus={updateOrderStatus.isPending}
			isUpdatingShipping={updateShippingStatus.isPending}
			onConfirm={() => handleStatusUpdate(ORDER_STATUS.CONFIRMED)}
			onProcess={() => handleStatusUpdate(ORDER_STATUS.PROCESSING)}
			onReceive={() => handleStatusUpdate(ORDER_STATUS.COMPLETED)}
			onCancel={(reason) => handleStatusUpdate(ORDER_STATUS.CANCELLED, reason)}
			onShip={handleShipped}
			className={className}
		>
			<StockUpdateDialog open={isStockUpdateOpen} onOpenChange={setIsStockUpdateOpen} order={order} onComplete={() => {}} />
		</OrderActionsView>
	)
}
