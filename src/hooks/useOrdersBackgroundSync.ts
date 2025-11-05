import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { orderKeys } from '@/queries/queryKeyFactory'

/**
 * Hook to prefetch and keep orders updated in the background
 * Runs on page load and periodically refreshes data
 */
export function useOrdersBackgroundSync() {
	const queryClient = useQueryClient()
	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey || ''
	const ndk = ndkActions.getNDK()
	const ndkState = useStore(ndkStore)
	const intervalRef = useRef<NodeJS.Timeout | null>(null)
	const isMountedRef = useRef(true)

	useEffect(() => {
		isMountedRef.current = true
		return () => {
			isMountedRef.current = false
		}
	}, [])

	useEffect(() => {
		if (!userPubkey || !ndk) return

		// Function to refresh orders (always updates, even if cache exists)
		const refreshOrders = async () => {
			// Don't refetch if component is unmounted
			if (!isMountedRef.current) return

			// Ensure NDK is connected
			if (!ndkState.isConnected) {
				try {
					await ndkActions.connect()
				} catch (error) {
					// Suppress NDK initialization errors
					if (error instanceof ReferenceError && error.message.includes("Cannot access 's' before initialization")) {
						console.warn('[NDK] Suppressed initialization error in background sync')
						return
					}
					console.warn('useOrdersBackgroundSync: Error connecting NDK:', error)
					return
				}
			}

			// Verify NDK is still ready before refetching
			if (!ndk.pool || !isMountedRef.current) {
				return
			}

			// Only refetch if data is stale (respects staleTime: 5 minutes)
			// This prevents unnecessary refetches when data is still fresh
			const buyerQueryState = queryClient.getQueryState(orderKeys.byBuyer(userPubkey))

			// Only refetch purchases (byBuyer) in background - sales are updated via live subscriptions
			// Check if buyer query is stale before refetching
			const shouldRefetchBuyer = !buyerQueryState || buyerQueryState.isStale

			try {
				const promises: Promise<unknown>[] = []

				// Only refetch buyer orders if stale
				if (shouldRefetchBuyer) {
					promises.push(
						queryClient.refetchQueries({
							queryKey: orderKeys.byBuyer(userPubkey),
						}),
					)
				}

				// Never refetch sales in background - they're updated via live subscriptions
				// Sales will only refetch on manual refresh or when explicitly requested

				await Promise.allSettled(promises)
			} catch (error) {
				// Suppress NDK initialization errors
				if (error instanceof ReferenceError && error.message.includes("Cannot access 's' before initialization")) {
					console.warn('[NDK] Suppressed initialization error in background sync refetch')
					return
				}
				console.warn('useOrdersBackgroundSync: Error refreshing orders:', error)
			}
		}

		// Initial fetch on mount
		refreshOrders()

		// Set up periodic refresh every 30 seconds to keep data updated
		intervalRef.current = setInterval(() => {
			if (isMountedRef.current) {
				refreshOrders()
			}
		}, 30000)

		// Cleanup interval on unmount
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current)
				intervalRef.current = null
			}
		}
	}, [userPubkey, ndk, queryClient, ndkState.isConnected])
}
