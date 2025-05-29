import { createFileRoute } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/messages')({
	component: MessagesComponent,
})

function MessagesComponent() {
	useDashboardTitle('Messages')
	const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
	return (
		<div className="space-y-6">
			{!isMobile && <h1 className="text-[1.6rem] font-bold">Messages</h1>}
			<p>Messages</p>
		</div>
	)
}
