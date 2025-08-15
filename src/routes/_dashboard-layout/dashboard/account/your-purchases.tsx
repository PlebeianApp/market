import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { purchaseColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ndkActions } from '@/lib/stores/ndk'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { getOrderStatus, useOrdersByBuyer } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	useDashboardTitle('Your Purchases')
    const { user } = useStore(authStore)
	const [statusFilter, setStatusFilter] = useState<string>('any')
    const { data: purchases, isLoading } = useOrdersByBuyer(user?.pubkey || '')

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
			/>
		</div>
	)
}
