import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationActions } from '@/lib/stores/notifications'
import { useOrdersBySeller } from '@/queries/orders'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import { filterAndSortOrderListings } from '@sdk/commerce/orders'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	useDashboardTitle('Sales')
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const [orderBy, setOrderBy] = useState<string>('newest')
	const { data: sales, isLoading } = useOrdersBySeller(currentUser?.pubkey || '', { includePrivateOrderDetails: true })

	// Mark all orders as seen when the page is viewed
	useEffect(() => {
		notificationActions.markOrdersSeen()
	}, [])

	const filteredSales = useMemo(() => filterAndSortOrderListings(sales ?? [], statusFilter, orderBy), [sales, statusFilter, orderBy])

	return (
		<div className="h-full">
			<OrderDataTable
				heading={<h1 className="text-2xl font-bold">Sales</h1>}
				data={filteredSales}
				columns={salesColumns}
				isLoading={isLoading}
				filterColumn="orderId"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
				showSearch={false}
				showOrderBy={true}
				onOrderByChange={setOrderBy}
				orderBy={orderBy}
				emptyMessage="You haven't sold anything yet."
			/>
		</div>
	)
}
