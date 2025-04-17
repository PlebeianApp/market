import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/network')({
	component: NetworkComponent,
})

function NetworkComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Network</h1>
			<p>Manage your product collections here</p>
		</div>
	)
}
