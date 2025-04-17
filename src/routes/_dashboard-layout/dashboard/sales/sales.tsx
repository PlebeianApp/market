import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Sales</h1>
			<p>Sales</p>
		</div>
	)
}
