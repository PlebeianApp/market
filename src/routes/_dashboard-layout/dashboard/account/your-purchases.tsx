import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Your Purchases</h1>
			<p>Your Purchases</p>
		</div>
	)
}
