import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions } from './stores/auth'
import { walletActions } from './stores/wallet'
import { defaultRelaysUrls } from './constants'

// Initialize NDK and create a queryClient only after initialization
export async function createQueryClient(): Promise<QueryClient> {
	try {
		console.log('Starting NDK initialization...')
		ndkActions.initialize(defaultRelaysUrls)
		console.log('NDK initialized, connecting...')

		// Add timeout to prevent infinite hang
		const connectionPromise = ndkActions.connect()
		const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('NDK connection timeout')), 5000))

		try {
			await Promise.race([connectionPromise, timeoutPromise])
			console.log('NDK connected successfully')
		} catch (error) {
			console.warn('NDK connection failed or timed out, continuing anyway:', error)
		}

		console.log('Initializing auth...')
		try {
			await authActions.getAuthFromLocalStorageAndLogin()
			console.log('Auth initialized')
		} catch (error) {
			console.warn('Auth initialization failed, continuing anyway:', error)
		}

		console.log('Initializing wallet...')
		try {
			await walletActions.initialize()
			console.log('Wallet initialized')
		} catch (error) {
			console.warn('Wallet initialization failed, continuing anyway:', error)
		}

		console.log('NDK and stores initialized successfully')
		// Create and return a new QueryClient only after initialization
		return new QueryClient()
	} catch (error) {
		console.error('Error initializing NDK and stores:', error)
		// Return a QueryClient anyway to prevent complete failure
		return new QueryClient()
	}
}
