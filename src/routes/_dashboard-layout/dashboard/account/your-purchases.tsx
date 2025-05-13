import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { purchaseColumns } from '@/components/orders/orderColumns'
import { ndkActions } from '@/lib/stores/ndk'
import { getOrderStatus, useOrdersByBuyer } from '@/queries/orders'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const { data: purchases, isLoading } = useOrdersByBuyer(currentUser?.pubkey || '')

	// Filter orders by status if needed
	const filteredPurchases = useMemo(() => {
		if (!purchases) return []

		if (statusFilter === 'any') {
			return purchases
		}

		return purchases.filter((order) => {
			const status = getOrderStatus(order).toLowerCase()
			return status === statusFilter.toLowerCase()
		})
	}, [purchases, statusFilter])

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Your Purchases</h1>

			<OrderDataTable
				data={filteredPurchases}
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
