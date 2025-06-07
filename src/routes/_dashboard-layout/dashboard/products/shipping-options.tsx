import { createFileRoute } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/shipping-options')({
	component: ShippingOptionsComponent,
})

function ShippingOptionsComponent() {
	useDashboardTitle('Shipping Options')
	return (
		<div className="space-y-6">
			<p>Shipping Options</p>
		</div>
	)
}
