import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/messages')({
	component: MessagesComponent,
})

function MessagesComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Messages</h1>
			<p>Messages</p>
		</div>
	)
}
