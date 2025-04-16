import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/')({
	component: DashboardInnerComponent,
})

function DashboardInnerComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Dashboard</h1>
			<p>Dashboard</p>
		</div>
	)
}
