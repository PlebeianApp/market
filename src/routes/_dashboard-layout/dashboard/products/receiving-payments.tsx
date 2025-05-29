import { createFileRoute } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/receiving-payments')({
	component: ReceivingPaymentsComponent,
})

function ReceivingPaymentsComponent() {
	useDashboardTitle('Receive Payments')
	const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
	return (
		<div className="space-y-6">
			{!isMobile && <h1 className="text-[1.6rem] font-bold">Receive Payments</h1>}
			<p>Manage your payment receiving options here</p>
		</div>
	)
}
