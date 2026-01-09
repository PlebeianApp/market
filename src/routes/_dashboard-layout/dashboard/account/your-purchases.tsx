import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { purchaseColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationActions } from '@/lib/stores/notifications'
import { getOrderStatus, useOrdersByBuyer } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/your-purchases')({
	component: YourPurchasesComponent,
})

function YourPurchasesComponent() {
	useDashboardTitle('Your Purchases')
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const [orderBy, setOrderBy] = useState<string>('newest')
	const { data: purchases, isLoading } = useOrdersByBuyer(currentUser?.pubkey || '')

	// Mark all purchase updates as seen when the page is viewed
	useEffect(() => {
		notificationActions.markPurchasesSeen()
	}, [])

	// Filter and sort orders
	const filteredPurchases = useMemo(() => {
		if (!purchases) return []

		// Filter by status
		let filtered = purchases
		if (statusFilter !== 'any') {
			filtered = purchases.filter((order) => {
				const status = getOrderStatus(order).toLowerCase()
				return status === statusFilter.toLowerCase()
			})
		}

		// Sort by order
		const sorted = [...filtered].sort((a, b) => {
			let timeA: number
			let timeB: number

			if (orderBy === 'recently-updated' || orderBy === 'least-updated') {
				// For "recently updated", find the most recent timestamp among all related events
				const getLatestTimestamp = (order: typeof a) => {
					const timestamps = [
						order.order.created_at || 0,
						order.latestStatus?.created_at || 0,
						order.latestShipping?.created_at || 0,
						order.latestPaymentRequest?.created_at || 0,
						order.latestPaymentReceipt?.created_at || 0,
						order.latestMessage?.created_at || 0,
					]
					return Math.max(...timestamps)
				}
				timeA = getLatestTimestamp(a)
				timeB = getLatestTimestamp(b)
			} else {
				// For "newest/oldest", use order creation time
				timeA = a.order.created_at || 0
				timeB = b.order.created_at || 0
			}

			// Sort based on selected order
			if (orderBy === 'oldest' || orderBy === 'least-updated') {
				return timeA - timeB
			} else {
				return timeB - timeA
			}
		})

		return sorted
	}, [purchases, statusFilter, orderBy])

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
				showOrderBy={true}
				onOrderByChange={setOrderBy}
				orderBy={orderBy}
				emptyMessage="You haven't purchased anything yet."
			/>
		</div>
	)
}
