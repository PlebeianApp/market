import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKUser, NDKEvent } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { QueryClient } from '@tanstack/react-query'
import { ndkActions } from './ndk'
import { fetchProductsByPubkey } from '@/queries/products'
import { fetchProfileByIdentifier, profileQueryOptions } from '@/queries/profiles'
import { profileKeys } from '@/queries/queryKeyFactory'
import { nip19 } from 'nostr-tools'

export const NOSTR_CONNECT_KEY = 'nostr_connect_url'
export const NOSTR_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'
export const NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY = 'nostr_local_encrypted_signer_key'
export const NOSTR_AUTO_LOGIN = 'nostr_auto_login'

// Global QueryClient reference for immediate profile caching
let globalQueryClient: QueryClient | null = null

interface AuthState {
	user: NDKUser | null
	isAuthenticated: boolean
	needsDecryptionPassword: boolean
	isAuthenticating: boolean
}

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	needsDecryptionPassword: false,
	isAuthenticating: false,
}

export const authStore = new Store<AuthState>(initialState)

// Function to set the global QueryClient reference
export const setGlobalQueryClient = (queryClient: QueryClient) => {
	globalQueryClient = queryClient
}

export const authActions = {
	getAuthFromLocalStorageAndLogin: async () => {
		try {
			const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)

			if (autoLogin !== 'true') {
				return
			}

			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			const privateKey = localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)
			const bunkerUrl = localStorage.getItem(NOSTR_CONNECT_KEY)

			if (privateKey && bunkerUrl) {
				await authActions.loginWithNip46(bunkerUrl, new NDKPrivateKeySigner(privateKey))
				return
			}

			const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)

			if (encryptedPrivateKey) {
				authStore.setState((state) => ({ ...state, needsDecryptionPassword: true }))
				return
			}

			await authActions.loginWithExtension()
		} catch (error) {
			console.error('Authentication failed:', error)
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	decryptAndLogin: async (password: string) => {
		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			if (!encryptedPrivateKey) {
				throw new Error('No encrypted key found')
			}

			const [, key] = encryptedPrivateKey.split(':')
			const user = await authActions.loginWithPrivateKey(key)
			authStore.setState((state) => ({ ...state, needsDecryptionPassword: false }))

			// Profile preloading is already handled in loginWithPrivateKey
			return user
		} catch (error) {
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithPrivateKey: async (privateKey: string) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKPrivateKeySigner(privateKey)
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)

			const user = await signer.user()

			// Preload user profile BEFORE updating auth state to ensure data is available immediately
			await authActions.preloadUserProfile(user)

			// Set auto-login flag to enable persistence across page refreshes
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithExtension: async () => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKNip07Signer()
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)

			const user = await signer.user()

			// Preload user profile BEFORE updating auth state to ensure data is available immediately
			await authActions.preloadUserProfile(user)

			// Set auto-login flag to enable persistence across page refreshes
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithNip46: async (bunkerUrl: string, localSigner: NDKPrivateKeySigner) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		localStorage.setItem(NOSTR_LOCAL_SIGNER_KEY, localSigner.privateKey || '')
		localStorage.setItem(NOSTR_CONNECT_KEY, bunkerUrl)

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKNip46Signer(ndk, bunkerUrl, localSigner)
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)
			const user = await signer.user()

			// Preload user profile BEFORE updating auth state to ensure data is available immediately
			await authActions.preloadUserProfile(user)

			// Set auto-login flag to enable persistence across page refreshes
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} catch (error) {
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	logout: () => {
		const ndk = ndkActions.getNDK()
		if (!ndk) return
		ndkActions.removeSigner()
		localStorage.removeItem(NOSTR_LOCAL_SIGNER_KEY)
		localStorage.removeItem(NOSTR_CONNECT_KEY)
		localStorage.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		localStorage.removeItem(NOSTR_AUTO_LOGIN)
		authStore.setState(() => initialState)
	},

	userHasProducts: async (): Promise<boolean> => {
		const state = authStore.state
		if (!state.user) return false

		try {
			const products = await fetchProductsByPubkey(state.user.pubkey)
			return products.length > 0
		} catch (error) {
			console.error('Failed to check user products:', error)
			return false
		}
	},

	preloadUserProfile: async (user: NDKUser): Promise<void> => {
		try {
			// Fetch profile data using the same function as the dashboard
			const result = await fetchProfileByIdentifier(user.pubkey)
			if (result?.profile) {
				// If QueryClient is available, populate the cache immediately
				if (globalQueryClient) {
					const queryKey = profileKeys.details(user.pubkey)
					globalQueryClient.setQueryData(queryKey, result)

					// Also prefetch the profile to ensure it's available in all components
					try {
						await globalQueryClient.prefetchQuery({
							queryKey: profileKeys.details(user.pubkey),
							queryFn: () => fetchProfileByIdentifier(user.pubkey),
						})
					} catch (prefetchError) {
						// Don't throw - prefetch failure shouldn't break login
					}
				}
			}
		} catch (error) {
			console.error('Failed to preload user profile:', user.pubkey, error)
			// Don't throw - profile preload failure shouldn't break login
			// The user can still log in successfully without profile data
		}
	},

	preloadUserProfileWithQueryClient: async (user: NDKUser, queryClient: any): Promise<void> => {
		try {
			// Fetch profile data using the same function as the dashboard
			const result = await fetchProfileByIdentifier(user.pubkey)
			if (result?.profile) {
				// Populate the cache with the fetched profile data
				const queryKey = profileKeys.details(user.pubkey)
				queryClient.setQueryData(queryKey, result)
			}
		} catch (error) {
			console.error('Failed to preload user profile:', user.pubkey, error)
		}
	},
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
