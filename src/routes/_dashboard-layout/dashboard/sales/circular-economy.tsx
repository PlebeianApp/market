import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/circular-economy')({
	component: CircularEconomyComponent,
})
function CircularEconomyComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Circular Economy</h1>
			<p>Circular Economy</p>
		</div>
	)
}
