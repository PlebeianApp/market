import { createFileRoute } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/making-payments')({
	component: MakingPaymentsComponent,
})

function MakingPaymentsComponent() {
	useDashboardTitle('Making Payments')
	const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
	return (
		<div className="space-y-6">
			{!isMobile && <h1 className="text-2xl font-bold">Making Payments</h1>}
			<p>Making Payments</p>
		</div>
	)
}
