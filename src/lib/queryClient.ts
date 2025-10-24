import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions } from './stores/auth'
import { walletActions } from './stores/wallet'
import { defaultRelaysUrls } from './constants'

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
		console.log('NDK and stores initialized successfully')
		// Create and return a new QueryClient only after initialization
		return new QueryClient()
	} catch (error) {
		console.error('Error initializing NDK and stores:', error)
		throw error
	}
}
