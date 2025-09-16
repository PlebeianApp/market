import { createFileRoute } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/')({
	component: DashboardInnerComponent,
})

function DashboardInnerComponent() {
	useDashboardTitle('Dashboard')
	return <div className="space-y-6"></div>
}
