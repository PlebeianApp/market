import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/shipping-options')({
	component: ShippingOptionsComponent,
})

function ShippingOptionsComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Shipping Options</h1>
			<p>Shipping Options</p>
		</div>
	)
}
