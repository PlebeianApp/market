import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { purchaseColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationActions } from '@/lib/stores/notifications'
import { useOrdersByBuyer } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { filterAndSortOrderListings } from '@sdk/commerce/orders'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	useDashboardTitle('Your Purchases')
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const [orderBy, setOrderBy] = useState<string>('newest')
	const { data: purchases, isLoading } = useOrdersByBuyer(currentUser?.pubkey || '')

	// Mark all purchase updates as seen when the page is viewed
	useEffect(() => {
		notificationActions.markPurchasesSeen()
	}, [])

	const filteredPurchases = useMemo(
		() => filterAndSortOrderListings(purchases ?? [], statusFilter, orderBy),
		[purchases, statusFilter, orderBy],
	)

	return (
		<div className="h-full">
			<OrderDataTable
				heading={<h1 className="text-2xl font-bold">Your Purchases</h1>}
				data={filteredPurchases}
				columns={purchaseColumns}
				isLoading={isLoading}
				filterColumn="status"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
				showSearch={false}
				showOrderBy={true}
				onOrderByChange={setOrderBy}
				orderBy={orderBy}
				emptyMessage="You haven't purchased anything yet."
			/>
		</div>
	)
}
