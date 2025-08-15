import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ndkActions } from '@/lib/stores/ndk'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { getOrderStatus, useOrdersBySeller } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	useDashboardTitle('Sales')
    const { user } = useStore(authStore)
	const [statusFilter, setStatusFilter] = useState<string>('any')
    const { data: sales, isLoading } = useOrdersBySeller(user?.pubkey || '')

	// Filter orders by status if needed
	const filteredSales = useMemo(() => {
		if (!sales) return []

		if (statusFilter === 'any') {
			return sales
		}

		return sales.filter((order) => {
			const status = getOrderStatus(order).toLowerCase()
			return status === statusFilter.toLowerCase()
		})
	}, [sales, statusFilter])

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
			/>
		</div>
	)
}
