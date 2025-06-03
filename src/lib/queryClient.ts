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
		await authActions.getAuthFromLocalStorageAndLogin()
		await walletActions.initialize()
		console.log('NDK and stores initialized successfully')
		// Create and return a new QueryClient only after initialization
		return new QueryClient()
	} catch (error) {
		console.error('Error initializing NDK and stores:', error)
		throw error
	}
}
