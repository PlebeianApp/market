import { createFileRoute } from '@tanstack/react-router'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/collections')({
	component: CollectionsComponent,
})

function CollectionsComponent() {
	useDashboardTitle('Collections')
	const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
	return (
		<div className="space-y-6">
			{!isMobile && <h1 className="text-[1.6rem] font-bold">Collections</h1>}
			<p>Manage your product collections here</p>
		</div>
	)
}
