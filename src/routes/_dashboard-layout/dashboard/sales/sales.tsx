import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ndkActions } from '@/lib/stores/ndk'
import { getOrderStatus, useOrdersBySeller } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	useDashboardTitle('')
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

		return sales.filter((order) => {
			const status = getOrderStatus(order).toLowerCase()
			return status === statusFilter.toLowerCase()
		})
	}, [sales, statusFilter])

	return (
		<div className="space-y-6">
			{/* Title and Filter Row */}
			<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
				<h1 className="text-[1.6rem] font-bold">Sales</h1>
				<div className="w-full lg:w-64">
					<Select defaultValue="any" value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Any Status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="any">Any Status</SelectItem>
							<SelectItem value="pending">Pending</SelectItem>
							<SelectItem value="confirmed">Confirmed</SelectItem>
							<SelectItem value="processing">Processing</SelectItem>
							<SelectItem value="completed">Completed</SelectItem>
							<SelectItem value="cancelled">Cancelled</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<OrderDataTable
				data={filteredSales}
				columns={salesColumns}
				isLoading={isLoading}
				filterColumn="orderId"
				showStatusFilter={false}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
			/>
		</div>
	)
}
