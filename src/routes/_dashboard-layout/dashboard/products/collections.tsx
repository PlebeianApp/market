import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/collections')({
	component: CollectionsComponent,
})

function CollectionsComponent() {
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Collections</h1>
			<p>Manage your product collections here</p>
		</div>
	)
}
