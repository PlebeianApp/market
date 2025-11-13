import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKUser, NDKEvent } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkActions } from './ndk'
import { cartActions } from './cart'
import { fetchProductsByPubkey } from '@/queries/products'
import { saveAuthState, getAuthState, clearAuthState, type PersistedAuthState } from '@/lib/auth-persistence'

export const NOSTR_CONNECT_KEY = 'nostr_connect_url'
export const NOSTR_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'
export const NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY = 'nostr_local_encrypted_signer_key'
export const NOSTR_AUTO_LOGIN = 'nostr_auto_login'

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

export const authActions = {
	getAuthFromLocalStorageAndLogin: async () => {
		try {
			const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)
			if (autoLogin !== 'true') return

			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Try to restore from IndexedDB first
			const persistedState = await getAuthState()
			if (persistedState) {
				switch (persistedState.method) {
					case 'nip46':
						if (persistedState.bunkerUrl && persistedState.localSignerKey) {
							await authActions.loginWithNip46(
								persistedState.bunkerUrl,
								new NDKPrivateKeySigner(persistedState.localSignerKey),
								false, // Don't save again
							)
							return
						}
						break

					case 'encrypted-private-key':
						authStore.setState((state) => ({ ...state, needsDecryptionPassword: true }))
						return

					case 'extension':
						await authActions.loginWithExtension(false) // Don't save again
						return

					case 'private-key':
						// Private keys should be stored encrypted, this is a fallback
						console.warn('Unencrypted private key detected in persisted state')
						break
				}
			}

			// Fallback to localStorage (legacy support)
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

			// Try extension as final fallback
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

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			// Note: We don't save unencrypted private keys to IndexedDB
			// This method should only be used for encrypted key restoration
			// Check if this is coming from encrypted storage
			const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			if (encryptedPrivateKey && localStorage.getItem(NOSTR_AUTO_LOGIN) === 'true') {
				await saveAuthState({
					method: 'encrypted-private-key',
					pubkey: user.pubkey,
					timestamp: Date.now(),
					encryptedKey: encryptedPrivateKey,
				})
			}

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

	loginWithExtension: async (saveState = true) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKNip07Signer()
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)

			const user = await signer.user()

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			// Save auth state to IndexedDB
			if (saveState && localStorage.getItem(NOSTR_AUTO_LOGIN) === 'true') {
				await saveAuthState({
					method: 'extension',
					pubkey: user.pubkey,
					timestamp: Date.now(),
				})
			}

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

	loginWithNip46: async (bunkerUrl: string, localSigner: NDKPrivateKeySigner, saveState = true) => {
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

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			// Save auth state to IndexedDB
			if (saveState && localStorage.getItem(NOSTR_AUTO_LOGIN) === 'true') {
				await saveAuthState({
					method: 'nip46',
					pubkey: user.pubkey,
					timestamp: Date.now(),
					bunkerUrl,
					localSignerKey: localSigner.privateKey || undefined,
				})
			}

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

	logout: async () => {
		const ndk = ndkActions.getNDK()
		if (!ndk) return
		ndkActions.removeSigner()
		localStorage.removeItem(NOSTR_LOCAL_SIGNER_KEY)
		localStorage.removeItem(NOSTR_CONNECT_KEY)
		localStorage.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		// Disable auto-login when user explicitly logs out
		localStorage.setItem(NOSTR_AUTO_LOGIN, 'false')
		// Clear auth state from IndexedDB
		await clearAuthState()
		// Clear cart when user logs out
		cartActions.clear()
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
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
