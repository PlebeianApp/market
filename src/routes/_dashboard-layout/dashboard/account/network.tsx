import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/network')({
	component: NetworkComponent,
})

function NetworkComponent() {
	useDashboardTitle('Network')
	return (
		<div className="space-y-6">
			<p>Manage your product collections here</p>
		</div>
	)
}
