import { createFileRoute } from '@tanstack/react-router'
import { getOrderStatus, getSellerPubkey, useOrders } from '@/queries/orders'
import { ndkActions } from '@/lib/stores/ndk'
import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	const { data: orders, isLoading } = useOrders()
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser

	// Filter orders where the current user is the seller
	const sellerOrders = useMemo(() => {
		if (!orders || !currentUser) return []
		
		const userOrders = orders.filter(order => {
			const sellerPubkey = getSellerPubkey(order.order)
			return sellerPubkey === currentUser.pubkey
		})
		
		if (statusFilter === 'any') {
			return userOrders
		}
		
		return userOrders.filter(order => {
			const status = getOrderStatus(order).toLowerCase()
			return status === statusFilter.toLowerCase()
		})
	}, [orders, statusFilter, currentUser])

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Sales</h1>
			
			<OrderDataTable 
				data={sellerOrders}
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
