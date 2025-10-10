import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions, authStore } from './stores/auth'
import { walletActions } from './stores/wallet'
import { defaultRelaysUrls } from './constants'

// Initialize NDK and create a queryClient only after initialization
export async function createQueryClient(): Promise<QueryClient> {
	try {
		ndkActions.initialize(defaultRelaysUrls)
		await ndkActions.connect()
		await authActions.getAuthFromLocalStorageAndLogin()
		await walletActions.initialize()
		console.log('NDK and stores initialized successfully')
		
		// Create QueryClient
		const queryClient = new QueryClient()
		
		// If user is authenticated, prefetch their profile to populate the cache
		const authState = authStore.state
		if (authState.isAuthenticated && authState.user) {
			console.log('🔄 QueryClient: User is authenticated, prefetching profile for:', authState.user.pubkey)
			await authActions.preloadUserProfileWithQueryClient(authState.user, queryClient)
		}
		
		return queryClient
	} catch (error) {
		console.error('Error initializing NDK and stores:', error)
		throw error
	}
}
