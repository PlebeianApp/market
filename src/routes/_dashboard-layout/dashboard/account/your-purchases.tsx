import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { purchaseColumns } from '@/components/orders/orderColumns'
import { ndkActions } from '@/lib/stores/ndk'
import { getBuyerPubkey, useOrders } from '@/queries/orders'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const [statusFilter, setStatusFilter] = useState<string>('any')
	// Fetch all orders
	const { data: orders, isLoading } = useOrders()
	
	// Filter orders to only include purchases (where current user is the buyer)
	const purchases = useMemo(() => {
		if (!orders || !currentUser) return []
		
		return orders.filter(order => {
			const buyerPubkey = getBuyerPubkey(order.order)
			return buyerPubkey === currentUser.pubkey
		})
	}, [orders, currentUser])

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Your Purchases</h1>
			
			<OrderDataTable 
				data={purchases}
				columns={purchaseColumns}
				isLoading={isLoading}
				filterColumn="status"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
			/>
		</div>
	)
}
