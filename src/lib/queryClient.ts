import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions } from './stores/auth'
import { defaultRelaysUrls } from './constants'

// Initialize NDK and create a queryClient only after initialization
export async function createQueryClient(): Promise<QueryClient> {
	try {
		ndkActions.initialize(defaultRelaysUrls)
		await ndkActions.connect()
		await authActions.getAuthFromLocalStorageAndLogin()
		console.log('NDK initialized successfully')
		// Create and return a new QueryClient only after NDK is initialized
		return new QueryClient()
	} catch (error) {
		console.error('Error initializing NDK:', error)
		throw error
	}
}
