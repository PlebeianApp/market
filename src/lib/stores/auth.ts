import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKUser, NDKEvent } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkActions } from './ndk'
import { removeProfileFromLocalStorage } from '@/lib/utils/profileStorage'
import { cartActions } from './cart'
import { fetchProductsByPubkey } from '@/queries/products'

export const NOSTR_CONNECT_KEY = 'nostr_connect_url'
export const NOSTR_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'
export const NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY = 'nostr_local_encrypted_signer_key'
export const NOSTR_AUTO_LOGIN = 'nostr_auto_login'
export const NOSTR_USER_PUBKEY = 'nostr_user_pubkey'

interface AuthState {
	user: NDKUser | null
	isAuthenticated: boolean
	needsDecryptionPassword: boolean
	isAuthenticating: boolean
}

// Function to restore auth state from localStorage immediately
function loadInitialAuthState(): AuthState {
	const baseState: AuthState = {
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
	}

	if (typeof localStorage === 'undefined') return baseState

	try {
		const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)

		// Check if we need decryption password
		const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		if (autoLogin === 'true' && encryptedPrivateKey) {
			return {
				...baseState,
				needsDecryptionPassword: true,
			}
		}
	} catch (error) {
		console.error('Error loading initial auth state:', error)
	}

	return baseState
}

const initialState: AuthState = loadInitialAuthState()

export const authStore = new Store<AuthState>(initialState)

export const authActions = {
	// Restore authenticated state immediately after NDK is initialized
	restoreAuthenticatedState: () => {
		if (typeof localStorage === 'undefined') return

		try {
			const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)
			const userPubkey = localStorage.getItem(NOSTR_USER_PUBKEY)

			// If we have auto-login enabled and a stored pubkey, restore the authenticated state
			if (autoLogin === 'true' && userPubkey) {
				const ndk = ndkActions.getNDK()
				if (ndk) {
					const user = ndk.getUser({ pubkey: userPubkey })
					authStore.setState((state) => ({
						...state,
						user,
						isAuthenticated: true,
					}))
				}
			}
		} catch (error) {
			console.error('Error restoring authenticated state:', error)
		}
	},

	getAuthFromLocalStorageAndLogin: async () => {
		try {
			const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)
			if (autoLogin !== 'true') return

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
			await authActions.loginWithPrivateKey(key)
			authStore.setState((state) => ({ ...state, needsDecryptionPassword: false }))
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

			// Store user pubkey and enable auto-login for persistence
			localStorage.setItem(NOSTR_USER_PUBKEY, user.pubkey)
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			// Enable auto-login for persistence
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

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

	getAvailableNostrExtensions: (): string[] => {
		const extensions: string[] = []
		if (typeof window !== 'undefined') {
			if ((window as any).nostr) extensions.push('nostr')
			if ((window as any).nos2x) extensions.push('nos2x')
			if ((window as any).alby) extensions.push('alby')
		}
		return extensions
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

			// VHandle missing extension and failed signer
			if (!user || !user.pubkey) {
				const availableExtensions = authActions.getAvailableNostrExtensions()
				if (availableExtensions.length === 0) {
					throw new Error(
						'No Nostr extension detected. Please install a Nostr browser extension (e.g., Alby, nos2x, or Nostr) before logging in.',
					)
				}
				throw new Error('Failed to authenticate with Nostr extension. Please make sure your extension is unlocked and try again.')
			}

			// Store user pubkey and enable auto-login for persistence
			localStorage.setItem(NOSTR_USER_PUBKEY, user.pubkey)
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			// Enable auto-login for persistence
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			return user
		} catch (error) {
			// If we caught an error and don't have a user/pubkey, check if extension is missing
			if (error instanceof Error && !error.message.includes('No Nostr extension detected')) {
				const availableExtensions = authActions.getAvailableNostrExtensions()
				if (availableExtensions.length === 0) {
					authStore.setState((state) => ({
						...state,
						isAuthenticated: false,
					}))
					throw new Error(
						'No Nostr extension detected. Please install a Nostr browser extension (e.g., Alby, nos2x, or Nostr) before logging in.',
					)
				}
			}
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

			// Store user pubkey and enable auto-login for persistence
			localStorage.setItem(NOSTR_USER_PUBKEY, user.pubkey)
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			// Enable auto-login for persistence
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

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
		const state = authStore.state
		const ndk = ndkActions.getNDK()
		if (!ndk) return

		// Clean up profile data for the current user
		if (state.user?.pubkey) {
			removeProfileFromLocalStorage(state.user.pubkey)
		}

		ndkActions.removeSigner()
		localStorage.removeItem(NOSTR_LOCAL_SIGNER_KEY)
		localStorage.removeItem(NOSTR_CONNECT_KEY)
		localStorage.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		localStorage.removeItem(NOSTR_AUTO_LOGIN)
		localStorage.removeItem(NOSTR_USER_PUBKEY)
		// Clear cart when user logs out
		cartActions.clear()
		authStore.setState(() => ({
			user: null,
			isAuthenticated: false,
			needsDecryptionPassword: false,
			isAuthenticating: false,
		}))
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
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
