import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { fetchOrdersByBuyer, fetchOrdersBySeller, getOrderStatus, useOrdersBySeller } from '@/queries/orders'
import { orderKeys } from '@/queries/queryKeyFactory'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	useDashboardTitle('Sales')
	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey || ''
	const queryClient = useQueryClient()
	const [statusFilter, setStatusFilter] = useState<string>('any')
	const { data: sales, isLoading, refetch } = useOrdersBySeller(userPubkey)

	// Prefetch purchases query to populate cache (same data as dashboard)
	useEffect(() => {
		if (!userPubkey) return

		queryClient.prefetchQuery({
			queryKey: orderKeys.byBuyer(userPubkey),
			queryFn: () => fetchOrdersByBuyer(userPubkey, queryClient),
			staleTime: 30000,
		})
	}, [userPubkey, queryClient])

	// Refetch only on initial mount or when cache is empty (not on navigation back)
	useEffect(() => {
		if (!userPubkey) return

		// Check if we already have cached data
		const cachedData = queryClient.getQueryData(orderKeys.bySeller(userPubkey))
		if (cachedData) {
			// We have cached data, don't refetch (preserves cache when navigating back)
			return
		}

		// Only refetch if cache is empty (initial load or cache expired)
		const refetchOrders = async () => {
			// Ensure NDK is connected first
			const ndk = ndkActions.getNDK()
			if (ndk) {
				const ndkState = ndkStore.state
				if (!ndkState.isConnected) {
					await ndkActions.connect()
				}
			}

			// Use queryClient to refetch which works even if query is temporarily disabled
			await queryClient.refetchQueries({ queryKey: orderKeys.bySeller(userPubkey) })
		}

		const timer = setTimeout(() => {
			refetchOrders()
		}, 100)

		return () => clearTimeout(timer)
	}, [userPubkey, queryClient])

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
		<div className="h-full">
			<OrderDataTable
				heading={<h1 className="text-2xl font-bold">Sales</h1>}
				data={filteredSales}
				columns={salesColumns}
				isLoading={isLoading}
				filterColumn="orderId"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
				showSearch={false}
			/>
		</div>
	)
}
