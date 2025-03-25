import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkActions } from './ndk'
import { decrypt } from 'nostr-tools/nip04'

type NDKSigner = NDKPrivateKeySigner | NDKNip07Signer | NDKNip46Signer

export const NOSTR_CONNECT_KEY = 'nostr_connect_url'
export const NOSTR_LOCAL_SIGNER_KEY = 'nostr_local_signer_key'

interface AuthState {
	user: NDKUser | null
	isAuthenticated: boolean
	isAuthenticating: boolean
}

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	isAuthenticating: false,
}

export const authStore = new Store<AuthState>(initialState)

export const authActions = {
	getAuthFromLocalStorageAndLogin: async () => {
		const privateKey = localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)
		const bunkerUrl = localStorage.getItem(NOSTR_CONNECT_KEY)

		console.log('getAuthFromLocalStorageAndLogin')

		const encryptedPrivateKey = localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)

		if (privateKey && bunkerUrl) {
			await authActions.loginWithNip46(bunkerUrl, privateKey)
		} else if (encryptedPrivateKey) {
			const decryptedPrivateKey = 'derp'
			await authActions.loginWithPrivateKey(decryptedPrivateKey)
		} else {
			try {
				await authActions.loginWithExtension()
			} catch (error) {
				console.error('Error logging in with extension:', error)
			}
		}
	},

	loginWithPrivateKey: async (privateKey: string) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		authStore.setState((state) => ({ ...state, isAuthenticating: true }))

		try {
			const signer = new NDKPrivateKeySigner(privateKey)
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)

			const user = await signer.user()
			const publicKey = user.pubkey

			authStore.setState((state) => ({
				...state,
				user,
				signer,
				signerType: 'privateKey',
				publicKey,
				privateKey,
				isAuthenticated: true,
			}))

			return user
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithExtension: async () => {
		console.log('loginWithExtension')
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		authStore.setState((state) => ({ ...state, isAuthenticating: true }))

		console.log('loginWithExtension 2')

		try {
			const signer = new NDKNip07Signer()
			ndkActions.setSigner(signer)

			const user = await signer.user()

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithNip46: async (bunkerUrl: string, localSigner: NDKNip46Signer) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		localStorage.setItem(NOSTR_LOCAL_SIGNER_KEY, localSigner.bunkerPubkey || '')
		localStorage.setItem(NOSTR_CONNECT_KEY, bunkerUrl)

		authStore.setState((state) => ({ ...state, isAuthenticating: true }))

		try {
			const signer = new NDKNip46Signer(ndk, bunkerUrl, localSigner)
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)
			const user = await signer.user()

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			return user
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	logout: () => {
		const ndk = ndkActions.getNDK()
		if (!ndk) return
		ndkActions.removeSigner()
		authStore.setState(() => initialState)
	},
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
