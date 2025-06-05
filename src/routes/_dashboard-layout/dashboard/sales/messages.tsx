import { createFileRoute, useMatchRoute, Outlet } from '@tanstack/react-router'
import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { fullOrderColumns } from '@/components/orders/orderColumns'
import { ndkActions } from '@/lib/stores/ndk'
import { getOrderStatus, useOrders } from '@/queries/orders'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/messages')({
	component: MessagesComponent,
})

function MessagesComponent() {
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const matchRoute = useMatchRoute()
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const { data: orders, isLoading } = useOrders()

	// Check if we're on a child route (viewing an order detail)
	const isViewingOrder = matchRoute({
		to: '/dashboard/sales/messages/$orderId',
		fuzzy: true,
	})

	// Filter orders by status if needed
	const filteredOrders = useMemo(() => {
		if (!orders) return []

		if (statusFilter === 'any') {
			return orders
		}

		return orders.filter((order) => {
			const status = getOrderStatus(order).toLowerCase()
			return status === statusFilter.toLowerCase()
		})
	}, [orders, statusFilter])

	if (!currentUser) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to view your messages.</p>
			</div>
		)
	}

	// If we're viewing an order detail, render the child route
	if (isViewingOrder) {
		return <Outlet />
	}

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Order Messages</h1>
			<p className="text-gray-600">All your order communications in one place</p>

			<OrderDataTable
				data={filteredOrders}
				columns={fullOrderColumns}
				isLoading={isLoading}
				filterColumn="orderId"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
			/>
		</div>
	)
}
