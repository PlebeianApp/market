import { createFileRoute } from '@tanstack/react-router'
import { OrderDetailComponent } from '@/components/orders/OrderDetailComponent'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/messages/$orderId')({
	component: OrderDetailRouteComponent,
})

function OrderDetailRouteComponent() {
	const { orderId } = Route.useParams()
	return <OrderDetailComponent orderId={orderId} />
}
