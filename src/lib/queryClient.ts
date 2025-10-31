import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions } from './stores/auth'
import { walletActions } from './stores/wallet'
import { defaultRelaysUrls } from './constants'
import { persistOrdersToIndexedDB } from './persistence'

// Initialize NDK and create a queryClient only after initialization
export async function createQueryClient(): Promise<QueryClient> {
	try {
		ndkActions.initialize(defaultRelaysUrls)
		await ndkActions.connect()

		// Restore authenticated state immediately after NDK initialization
		authActions.restoreAuthenticatedState()

		// Perform auth and wallet initialization without blocking app startup
		void authActions.getAuthFromLocalStorageAndLogin()
		void walletActions.initialize()
		
		// Create QueryClient
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					// Increase gcTime for orders to allow persistence to work better
					gcTime: 30 * 60 * 1000, // 30 minutes
				},
			},
		})
		
		// Set up IndexedDB persistence for orders (purchases and sales)
		// This runs asynchronously and doesn't block app initialization
		if (typeof window !== 'undefined' && 'indexedDB' in window) {
			persistOrdersToIndexedDB(queryClient).catch(() => {
				// Silently fail - persistence is best effort
			})
		}
		
		return queryClient
	} catch (error) {
		throw error
	}
}
