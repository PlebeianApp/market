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
	const getBadgeVariant = (status: string): 'default' | 'outline' | 'secondary' => {
		switch (status.toLowerCase()) {
			case 'completed':
				return 'default' // Dark background with light text
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
			className="flex justify-between items-center hover:bg-accent p-4 border rounded-lg overflow-hidden transition-colors"
		>
			<div className="flex items-center gap-4 min-w-0">
				<div className="flex justify-center items-center bg-pink-400 rounded-full w-12 h-12 text-2xl shrink-0">{isBuyer ? '🛍️' : '💰'}</div>
				<div className="min-w-0">
					<div className="font-medium truncate">
						{isBuyer ? 'Purchase' : 'Sale'} #{orderData.order.id.slice(0, 8)}
					</div>
					<div className="text-muted-foreground text-sm">{new Date((orderData.order.created_at || 0) * 1000).toLocaleDateString()}</div>
				</div>
			</div>
			<Badge variant={getBadgeVariant(status)} className="shrink-0">
				{status}
			</Badge>
		</Link>
	)
}
