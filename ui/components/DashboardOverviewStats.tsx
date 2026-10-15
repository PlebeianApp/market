import { getProductVisibility, type ProductReadEvent } from '@sdk/commerce/discovery'
import { getOrderRecipientPubkey, type OrderReadEvent } from '@sdk/commerce/orders'

export interface DashboardOverviewOrder {
	order: OrderReadEvent & { pubkey?: string }
}

export interface DashboardOverviewStatsProps {
	products: readonly ProductReadEvent[]
	orders: readonly DashboardOverviewOrder[]
	userPubkey: string
	conversationCount: number
	isLoading: boolean
}

const metrics = [
	{ key: 'listings', label: 'Active Listings', detail: 'total products', icon: '📦' },
	{ key: 'sales', label: 'Sales', detail: 'Orders received', icon: '💰' },
	{ key: 'purchases', label: 'Purchases', detail: 'Orders placed', icon: '🛍️' },
	{ key: 'messages', label: 'Messages', detail: 'Conversations', icon: '✉️' },
] as const

/** SDK-backed dashboard counts; fetching, identity, and loading state come from the route. */
export function DashboardOverviewStats({ products, orders, userPubkey, conversationCount, isLoading }: DashboardOverviewStatsProps) {
	const activeListings = products.filter((product) => getProductVisibility(product)?.[1] !== 'hidden').length
	const buyerOrders = orders.filter((order) => order.order.pubkey === userPubkey).length
	const sellerOrders = orders.filter((order) => getOrderRecipientPubkey(order.order) === userPubkey).length
	const values = {
		listings: activeListings,
		sales: sellerOrders,
		purchases: buyerOrders,
		messages: conversationCount,
	}

	return (
		<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-label="Dashboard overview statistics">
			{metrics.map((metric) => (
				<article key={metric.key} className="rounded-lg border bg-card text-card-foreground shadow-sm">
					<div className="flex items-center justify-between p-6 pb-2">
						<h2 className="text-sm font-medium">{metric.label}</h2>
						<span className="text-2xl" aria-hidden="true">
							{metric.icon}
						</span>
					</div>
					<div className="p-6 pt-2">
						{isLoading ? (
							<div className="h-8 w-20 animate-pulse rounded bg-muted" aria-label={`Loading ${metric.label}`} />
						) : (
							<>
								<div className="text-2xl font-bold">{values[metric.key]}</div>
								<p className="text-xs text-muted-foreground">
									{metric.key === 'listings' ? `${products.length} ${metric.detail}` : metric.detail}
								</p>
							</>
						)}
					</div>
				</article>
			))}
		</section>
	)
}
