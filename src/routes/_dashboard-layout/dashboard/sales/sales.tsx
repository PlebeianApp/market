import { createFileRoute } from '@tanstack/react-router'
import { getOrderStatus, useOrdersBySeller } from '@/queries/orders'
import { ndkActions } from '@/lib/stores/ndk'
import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const { data: sales, isLoading } = useOrdersBySeller(currentUser?.pubkey || '')

	// Filter orders by status if needed
	const filteredSales = useMemo(() => {
		if (!sales) return []
		
		if (statusFilter === 'any') {
			return sales
		}
		
		return sales.filter(order => {
			const status = getOrderStatus(order).toLowerCase()
			return status === statusFilter.toLowerCase()
		})
	}, [sales, statusFilter])

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Sales</h1>
			
			<OrderDataTable 
				data={filteredSales}
				columns={salesColumns}
				isLoading={isLoading}
				filterColumn="orderId"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
			/>
		</div>
	)
}
