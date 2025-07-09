import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { purchaseColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ndkActions } from '@/lib/stores/ndk'
import { getOrderStatus, useOrdersByBuyer } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	useDashboardTitle('Your Purchases')
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
			{/* Mobile/Tablet header and filter */}
			<div className="lg:hidden p-4 space-y-4">
				<div>
					<h1 className="text-2xl font-bold">Your Purchases</h1>
					<p className="text-muted-foreground mt-1">View and manage your purchase history</p>
				</div>
				
				<div className="space-y-2">
					<label className="text-sm font-medium text-muted-foreground">Filter by status:</label>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
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
				heading={
					<div>
						<h1 className="text-2xl font-bold">Your Purchases</h1>
						<p className="text-muted-foreground mt-1">View and manage your purchase history</p>
					</div>
				}
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
