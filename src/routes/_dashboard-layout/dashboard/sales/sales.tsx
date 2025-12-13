import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationActions } from '@/lib/stores/notifications'
import { getBuyerPubkey, getOrderStatus, useOrdersBySeller } from '@/queries/orders'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	useDashboardTitle('Sales')
	const ndk = ndkActions.getNDK()
	const currentUser = ndk?.activeUser
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const [orderBy, setOrderBy] = useState<string>('newest')
	const { data: sales, isLoading } = useOrdersBySeller(currentUser?.pubkey || '')

	// Mark all orders as seen when the page is viewed
	useEffect(() => {
		notificationActions.markOrdersSeen()
	}, [])

	// Filter and sort orders
	const filteredSales = useMemo(() => {
		if (!sales) return []

		// Filter by status
		let filtered = sales
		if (statusFilter !== 'any') {
			filtered = sales.filter((order) => {
				const status = getOrderStatus(order).toLowerCase()
				return status === statusFilter.toLowerCase()
			})
		}

		// Sort by order
		const sorted = [...filtered].sort((a, b) => {
			// Sort by username (buyer pubkey for sales)
			if (orderBy === 'username-asc' || orderBy === 'username-desc') {
				const pubkeyA = getBuyerPubkey(a.order) || ''
				const pubkeyB = getBuyerPubkey(b.order) || ''
				const comparison = pubkeyA.localeCompare(pubkeyB)
				return orderBy === 'username-asc' ? comparison : -comparison
			}

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
	}, [sales, statusFilter, orderBy])

	return (
		<div className="h-full">
			<OrderDataTable
				heading={<h1 className="text-2xl font-bold shrink-0 whitespace-nowrap h-8">Sales</h1>}
				data={filteredSales}
				columns={salesColumns}
				isLoading={isLoading}
				filterColumn="orderId"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
				showSearch={false}
				showOrderBy={true}
				onOrderByChange={setOrderBy}
				orderBy={orderBy}
				emptyMessage="You haven't sold anything yet."
				viewType="sales"
			/>
		</div>
	)
}
