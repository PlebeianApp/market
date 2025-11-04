import { OrderDataTable } from '@/components/orders/OrderDataTable'
import { salesColumns } from '@/components/orders/orderColumns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import { safeDecryptEvent } from '@/lib/utils/decrypt'
import { fetchOrdersByBuyer, fetchOrdersBySeller, getOrderStatus, useOrdersBySeller } from '@/queries/orders'
import { orderKeys } from '@/queries/queryKeyFactory'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrderWithRelatedEvents } from '@/queries/orders'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/sales')({
	component: SalesComponent,
})

function SalesComponent() {
	useDashboardTitle('Sales')
	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey || ''
	const queryClient = useQueryClient()
	const [statusFilter, setStatusFilter] = useState<string>('any')

	// Use the query hook - it automatically subscribes to cache updates and re-renders when data changes
	const { data: sales, isLoading, isFetching, refetch } = useOrdersBySeller(userPubkey)

	// Track if we're currently refetching on mount
	const [isRefetching, setIsRefetching] = useState(false)
	// Track if we've already attempted to refetch to prevent infinite loops
	const hasRefetchedRef = useRef(false)

	// Prefetch purchases query only if cache is empty (same data as dashboard)
	useEffect(() => {
		if (!userPubkey) return

		const cachedData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(userPubkey))

		// Only prefetch if cache is empty
		if (!cachedData || cachedData.length === 0) {
			queryClient.prefetchQuery({
				queryKey: orderKeys.byBuyer(userPubkey),
				queryFn: () => fetchOrdersByBuyer(userPubkey, queryClient),
				staleTime: 5 * 60 * 1000, // 5 minutes
			})
		}
	}, [userPubkey]) // Remove queryClient from deps to prevent re-runs

	// Note: We don't need a cache subscription - useQuery already subscribes to cache updates
	// Adding one here was causing infinite loops

	// Set up live subscription to monitor order status updates (similar to useOrderById)
	// This ensures status updates are received in real-time and cache is updated
	useEffect(() => {
		if (!userPubkey) return

		let retryCount = 0
		const maxRetries = 5

		const setupSubscriptions = () => {
			const ndk = ndkActions.getNDK()
			if (!ndk) {
				if (retryCount < maxRetries) {
					retryCount++
					setTimeout(setupSubscriptions, 200)
				}
				return
			}

			// Wait for NDK pool to be ready
			if (!ndk.pool) {
				if (retryCount < maxRetries) {
					retryCount++
					setTimeout(setupSubscriptions, 200)
				}
				return
			}

			// Set up subscription to monitor order-related events for sales orders
			// This mirrors the logic in useOrderById to ensure status updates are received
			const relatedEventsFilters = [
				{
					kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
					authors: [userPubkey],
				},
				{
					kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
					'#p': [userPubkey],
				},
			]

			const subscriptions = relatedEventsFilters.map((filter) => ndk.subscribe(filter, { closeOnEose: false }))

			const signer = ndkActions.getSigner()

			// Update list cache directly (same logic as useOrderById)
			const updateListCache = (key: string[], orderId: string, newEvent: NDKEvent) => {
				const listData = queryClient.getQueryData<OrderWithRelatedEvents[]>(key)
				if (!listData) return

				let eventAdded = false
				const updatedList = listData.map((orderData) => {
					const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
					if (orderTag?.[1] !== orderId) return orderData

					const updated = { ...orderData }
					if (newEvent.kind === ORDER_PROCESS_KIND) {
						const typeTag = newEvent.tags.find((tag) => tag[0] === 'type')
						if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE) {
							const existing = updated.statusUpdates.find((e) => e.id === newEvent.id)
							if (!existing) {
								updated.statusUpdates = [...updated.statusUpdates, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
								updated.latestStatus = updated.statusUpdates[0]
								eventAdded = true
							}
						} else if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE) {
							const existing = updated.shippingUpdates.find((e) => e.id === newEvent.id)
							if (!existing) {
								updated.shippingUpdates = [...updated.shippingUpdates, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
								updated.latestShipping = updated.shippingUpdates[0]
								eventAdded = true
							}
						}
					} else if (newEvent.kind === PAYMENT_RECEIPT_KIND) {
						const existing = updated.paymentReceipts.find((e) => e.id === newEvent.id)
						if (!existing) {
							updated.paymentReceipts = [...updated.paymentReceipts, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
							updated.latestPaymentReceipt = updated.paymentReceipts[0]
							eventAdded = true
						}
					}
					return updated
				})

				// Only update cache if we actually added an event
				if (eventAdded) {
					// Create new array reference to ensure React detects change
					// setQueryData will automatically notify all observers (useQuery hooks)
					queryClient.setQueryData(key, [...updatedList])
				}
			}

			// Handle new events and update cache
			// Set up event handlers BEFORE starting subscriptions to ensure handlers are registered
			for (const subscription of subscriptions) {
				subscription.on('event', async (newEvent: NDKEvent) => {
					let orderTag = newEvent.tags.find((tag) => tag[0] === 'order')

					// Try to decrypt if needed
					if (!orderTag && signer && newEvent.content) {
						try {
							const contentLooksEncrypted = !newEvent.content.trim().startsWith('{') && !newEvent.content.trim().startsWith('[')
							if (contentLooksEncrypted) {
								await safeDecryptEvent(newEvent, signer)
								orderTag = newEvent.tags.find((tag) => tag[0] === 'order')
							}
						} catch {
							return
						}
					}

					if (!orderTag || !orderTag[1]) return

					const orderId = orderTag[1]

					// Update both sales and purchases caches (same as useOrderById)
					// This ensures status updates appear everywhere
					updateListCache(orderKeys.bySeller(userPubkey), orderId, newEvent)
					updateListCache(orderKeys.byBuyer(userPubkey), orderId, newEvent)
				})
			}

			// Subscriptions will auto-start when handlers are attached
			// No need to manually call start() - this avoids initialization race conditions

			// Clean up subscriptions when unmounting
			// Don't manually stop - let NDK handle cleanup naturally
			// Manually stopping causes NDK internal errors
			return () => {
				// Subscriptions will be cleaned up by NDK when component unmounts
			}
		}

		// Start setting up subscriptions
		setupSubscriptions()
	}, [userPubkey]) // Remove queryClient from deps - access it via closure

	// Only refetch on mount if cache is empty - otherwise use cached data
	// This prevents unnecessary fetches and decryption after first load
	useEffect(() => {
		if (!userPubkey) return
		// Prevent multiple refetches - check flag first
		if (hasRefetchedRef.current) return

		const cachedData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(userPubkey))

		// Only refetch if cache is empty and we haven't refetched yet
		if (!cachedData || cachedData.length === 0) {
			// Set flag immediately to prevent re-runs
			hasRefetchedRef.current = true

			const refetchOrders = async () => {
				setIsRefetching(true)
				try {
					// Ensure NDK is connected first
					const ndk = ndkActions.getNDK()
					if (ndk) {
						const ndkState = ndkStore.state
						if (!ndkState.isConnected) {
							await ndkActions.connect()
						}
					}

					// Refetch to ensure we have the latest data including status updates
					// fetchOrdersBySeller will wait for status updates synchronously before returning
					await queryClient.refetchQueries({ queryKey: orderKeys.bySeller(userPubkey) })
				} finally {
					setIsRefetching(false)
				}
			}

			// Small delay to ensure component is mounted and hooks are ready
			const timer = setTimeout(() => {
				refetchOrders()
			}, 100)

			return () => clearTimeout(timer)
		}
	}, [userPubkey]) // Remove queryClient from deps - it's stable but causes re-runs

	// Reset refetch flag when userPubkey changes
	useEffect(() => {
		hasRefetchedRef.current = false
	}, [userPubkey])

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
				isLoading={isLoading || isFetching || isRefetching}
				filterColumn="orderId"
				showStatusFilter={true}
				onStatusFilterChange={setStatusFilter}
				statusFilter={statusFilter}
				showSearch={false}
			/>
		</div>
	)
}
