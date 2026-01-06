import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions } from './stores/auth'
import { walletActions } from './stores/wallet'
import { defaultRelaysUrls } from './constants'

// Initialize NDK and create a queryClient - connection happens in background
export function createQueryClient(): QueryClient {
	ndkActions.initialize(defaultRelaysUrls)
	// Connect in background - don't block app startup
	ndkActions.connect().catch((err) => {
		console.warn('Background NDK connection issue:', err)
	})
	// Perform auth and wallet initialization without blocking app startup
	void authActions.getAuthFromLocalStorageAndLogin()
	void walletActions.initialize()
	console.log('NDK and stores initialized successfully')
	// Create and return a new QueryClient immediately
	return new QueryClient()
}
