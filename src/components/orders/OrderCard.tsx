import { Badge } from '@/components/ui/badge'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { Link } from '@tanstack/react-router'

interface OrderCardProps {
	orderData: OrderWithRelatedEvents
	userPubkey: string
}

export function OrderCard({ orderData, userPubkey }: OrderCardProps) {
	// Buyer = author of order, Seller = recipient (#p tag)
	const isBuyer = orderData.order.pubkey === userPubkey
	const statusTag = orderData.latestStatus?.tags.find((t) => t[0] === 'status')
	const status = statusTag?.[1] || 'pending'

	// Determine badge variant based on status
	const getBadgeVariant = (status: string): 'primary' | 'outline' | 'secondary' => {
		switch (status.toLowerCase()) {
			case 'completed':
				return 'primary' // Dark background with light text
			case 'processing':
				return 'outline'
			case 'cancelled':
				return 'outline'
			case 'pending':
				return 'outline'
			default:
				return 'outline'
		}
	}

	return (
		<Link
			to="/dashboard/orders/$orderId"
			params={{ orderId: orderData.order.id }}
			className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
		>
			<div className="flex items-center gap-4">
				<div className="flex items-center justify-center w-12 h-12 rounded-full bg-pink-400 text-2xl">{isBuyer ? '🛍️' : '💰'}</div>
				<div>
					<div className="font-medium">
						{isBuyer ? 'Purchase' : 'Sale'} #{orderData.order.id.slice(0, 8)}
					</div>
					<div className="text-sm text-muted-foreground">{new Date((orderData.order.created_at || 0) * 1000).toLocaleDateString()}</div>
				</div>
			</div>
			<Badge variant={getBadgeVariant(status)}>{status}</Badge>
		</Link>
	)
}
