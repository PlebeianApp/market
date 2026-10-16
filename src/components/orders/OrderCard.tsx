import type { OrderWithRelatedEvents } from '@/queries/orders'
import { OrderCardView } from '@ui/components/orders/OrderDetailViews'

interface OrderCardProps {
	orderData: OrderWithRelatedEvents
	userPubkey: string
}

export function OrderCard({ orderData, userPubkey }: OrderCardProps) {
	// Buyer authored the order; the seller is the `p` recipient.
	const status = orderData.latestStatus?.tags.find((t) => t[0] === 'status')?.[1] || 'pending'

	return (
		<OrderCardView
			href={`/dashboard/orders/${orderData.order.id}`}
			orderEventId={orderData.order.id}
			isBuyer={orderData.order.pubkey === userPubkey}
			status={status}
			createdAt={orderData.order.created_at}
		/>
	)
}
