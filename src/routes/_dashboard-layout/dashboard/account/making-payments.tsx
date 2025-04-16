import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/making-payments')({
	component: MakingPaymentsComponent,
})

function MakingPaymentsComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Making Payments</h1>
			<p>Making Payments</p>
		</div>
	)
}
