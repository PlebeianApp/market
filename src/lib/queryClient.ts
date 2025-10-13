import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions, authStore, setGlobalQueryClient } from './stores/auth'
import { walletActions } from './stores/wallet'
import { defaultRelaysUrls } from './constants'

// Initialize NDK and create a queryClient only after initialization
export async function createQueryClient(): Promise<QueryClient> {
	try {
		ndkActions.initialize(defaultRelaysUrls)
		await ndkActions.connect()

		// Create QueryClient FIRST and set global reference BEFORE auth restoration
		const queryClient = new QueryClient()
		setGlobalQueryClient(queryClient)
		// Now restore authentication - this will use the global QueryClient for profile caching
		await authActions.getAuthFromLocalStorageAndLogin()
		await walletActions.initialize()
		console.log('NDK and stores initialized successfully')

		// If user is authenticated, prefetch their profile to populate the cache
		const authState = authStore.state
		if (authState.isAuthenticated && authState.user) {
			await authActions.preloadUserProfileWithQueryClient(authState.user, queryClient)
		}

		// Wait a bit to ensure auth state is fully settled
		await new Promise((resolve) => setTimeout(resolve, 100))

		return queryClient
	} catch (error) {
		console.error('Error initializing NDK and stores:', error)
		throw error
	}
}
