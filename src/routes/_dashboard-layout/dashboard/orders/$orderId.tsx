import { createFileRoute } from '@tanstack/react-router'
import { OrderDetailComponent } from '@/components/orders/OrderDetailComponent'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/orders/$orderId')({
	component: OrderDetailRouteComponent,
})

function OrderDetailRouteComponent() {
	const { orderId } = Route.useParams()
	useDashboardTitle('Order Details')
	return <OrderDetailComponent orderId={orderId} />
}
