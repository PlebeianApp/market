import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './stores/ndk'
import { authActions } from './stores/auth'
import { defaulRelaysUrls } from './constants'

// Initialize NDK and create a queryClient only after initialization
export async function createQueryClient(relayUrl?: string): Promise<QueryClient> {
  if (relayUrl) {
    console.log(`Initializing NDK with relay: ${relayUrl}`)
    ndkActions.initialize([relayUrl, ...defaulRelaysUrls])
    await ndkActions.connect()
    await authActions.getAuthFromLocalStorageAndLogin()
    console.log('NDK initialized successfully')
  }
  
  // Create and return a new QueryClient only after NDK is initialized
  return new QueryClient()
}
