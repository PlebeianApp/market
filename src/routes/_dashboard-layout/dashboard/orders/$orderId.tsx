import { createFileRoute } from '@tanstack/react-router'
import { OrderDetailComponent } from '@/components/orders/OrderDetailComponent'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useOrderById } from '@/queries/orders'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_dashboard-layout/dashboard/orders/$orderId')({
	component: OrderDetailRouteComponent,
})

function OrderDetailRouteComponent() {
	const { orderId } = Route.useParams()
	useDashboardTitle('Order Details')

	const { data: order, isLoading, error } = useOrderById(orderId)

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="space-y-6">
					<Card>
						<CardContent className="p-8">
							<div className="space-y-4">
								<Skeleton className="h-8 w-48" />
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-3/4" />
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="container mx-auto px-4 py-8">
				<Card>
					<CardContent className="p-8 text-center">
						<p className="text-red-500">Error loading order: {error.message}</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (!order) {
		return (
			<div className="container mx-auto px-4 py-8">
				<Card>
					<CardContent className="p-8 text-center">
						<p className="text-gray-500">Order not found</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	return <OrderDetailComponent order={order} />
}
