import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkActions } from './ndk'
import { cartActions } from './cart'
import { fetchProductsByPubkey } from '@/queries/products'
import { hasAcceptedTerms, TERMS_ACCEPTED_KEY } from '@/components/dialogs/TermsConditionsDialog'
import { uiActions } from './ui'
import { getPublicKey, nip19 } from 'nostr-tools'
import { decrypt, encrypt } from 'nostr-tools/nip49'
import { hexToBytes } from 'nostr-tools/utils'
import { toast } from 'sonner'

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
	needsMigration: boolean
	bootstrapError: string | null
}

interface Nip46LoginOptions {
	onAuthUrl?: (url: string) => void
	timeoutMs?: number
	remotePubkey?: string
}

function getAuthStorage(): Storage | undefined {
	if (typeof window !== 'undefined' && window.localStorage) {
		return window.localStorage
	}

	if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
		const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
		if (storage) {
			return storage
		}
	}

	return undefined
}

export function persistAuthenticatedLoginState(
	user: Pick<NDKUser, 'pubkey'> | null | undefined,
	privateKey?: string,
	connectionUrl?: string,
): void {
	const storage = getAuthStorage()
	if (!storage) {
		return
	}

	if (user?.pubkey) {
		storage.setItem(NOSTR_USER_PUBKEY, user.pubkey)
	}

	// Auto-login was historically enabled after a successful login. Preserve an
	// explicit opt-out, while restoring that default for a first-time login.
	if (storage.getItem(NOSTR_AUTO_LOGIN) === null) {
		storage.setItem(NOSTR_AUTO_LOGIN, 'true')
	}

	if (privateKey) {
		storage.setItem(NOSTR_LOCAL_SIGNER_KEY, privateKey)
	}

	if (connectionUrl) {
		storage.setItem(NOSTR_CONNECT_KEY, connectionUrl)
	}
}

interface Nip46LoginResult {
	user: NDKUser
	signer: NDKNip46Signer
}

const NIP46_RESPONSE_EVENT_PREFIX = 'response-'

function getNip46ResponseEventNames(signer: NDKNip46Signer): string[] {
	return signer.rpc
		.eventNames()
		.filter((eventName): eventName is string => typeof eventName === 'string' && eventName.startsWith(NIP46_RESPONSE_EVENT_PREFIX))
}

function cancelNip46HandshakeListeners(signer: NDKNip46Signer, knownResponseEvents: ReadonlySet<string>): void {
	for (const eventName of getNip46ResponseEventNames(signer)) {
		if (!knownResponseEvents.has(eventName)) {
			signer.rpc.removeAllListeners(eventName)
		}
	}
}

function createNip46FallbackSigner(signer: NDKNip46Signer, user: NDKUser): NDKNip46Signer {
	return new Proxy(signer, {
		get(target, property) {
			if (property === 'user') return async () => user
			if (property === 'userSync') return user
			if (property === 'pubkey') return user.pubkey

			const value = Reflect.get(target, property, target)
			return typeof value === 'function' ? value.bind(target) : value
		},
	})
}

export async function completeNip46LoginHandshake(
	signer: NDKNip46Signer,
	fallbackPubkey?: string,
	timeoutMs = 8000,
	ndk?: ReturnType<typeof ndkActions.getNDK>,
): Promise<Nip46LoginResult | null> {
	const resolvedNdk = ndk ?? ndkActions.getNDK()
	if (!resolvedNdk) {
		throw new Error('NDK not initialized for NIP-46 fallback')
	}

	const bunkerPubkey = (signer as unknown as { bunkerPubkey?: string }).bunkerPubkey
	const candidatePubkeys = Array.from(
		new Set([fallbackPubkey, signer.userPubkey, bunkerPubkey].filter((value): value is string => Boolean(value))),
	)
	let timeout: ReturnType<typeof setTimeout> | undefined
	const timeoutError = new Error('NIP-46 handshake timed out')
	const knownResponseEvents = new Set(getNip46ResponseEventNames(signer))

	try {
		const user = await Promise.race<NDKUser | null>([
			signer.blockUntilReady(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(timeoutError), timeoutMs)
			}),
		])

		if (user?.pubkey) {
			return { user, signer }
		}
	} catch (error) {
		if (error === timeoutError) {
			cancelNip46HandshakeListeners(signer, knownResponseEvents)
		}
		console.warn('[NIP46] full handshake did not complete, using fallback pubkey', error)
	} finally {
		if (timeout) clearTimeout(timeout)
	}

	for (const pubkey of candidatePubkeys) {
		try {
			signer.userPubkey = pubkey
			const user = resolvedNdk.getUser({ pubkey })
			return { user, signer: createNip46FallbackSigner(signer, user) }
		} catch (error) {
			console.warn('[NIP46] fallback pubkey failed', pubkey, error)
		}
	}

	return null
}

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	needsDecryptionPassword: false,
	isAuthenticating: false,
	needsMigration: false,
	bootstrapError: null,
}

export const authStore = new Store<AuthState>(initialState)

export const authActions = {
	getAuthFromLocalStorageAndLogin: async () => {
		try {
			// Check for migration (unencrypted private key) first
			if (authActions.getNeedsMigration()) {
				authStore.setState((state) => ({
					...state,
					needsMigration: true,
				}))

				return
			}

			// Only trigger auth check if auto-login is enabled

			const autoLogin = localStorage.getItem(NOSTR_AUTO_LOGIN)
			if (autoLogin !== 'true') return

			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Signer / Bunker URL

			const privateKeySigner = localStorage.getItem(NOSTR_LOCAL_SIGNER_KEY)
			const bunkerUrl = localStorage.getItem(NOSTR_CONNECT_KEY)

			if (privateKeySigner && bunkerUrl) {
				await authActions.loginWithNip46(bunkerUrl, new NDKPrivateKeySigner(privateKeySigner), {
					remotePubkey: localStorage.getItem(NOSTR_USER_PUBKEY) ?? undefined,
				})
				authActions.checkAndShowTermsDialog()
				return
			}

			// Private key decryption

			const privateKey = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)

			if (privateKey) {
				authStore.setState((state) => ({ ...state, needsDecryptionPassword: true }))
				return
			}

			// Else, login with extension

			await authActions.loginWithExtension()
			authActions.checkAndShowTermsDialog()
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

			// Extract the ncryptsec part (format: "pubkey:ncryptsec...")
			const [, encryptedKey] = encryptedPrivateKey.split(':')

			// Use nostr-tools decrypt function
			const decryptedBytes = decrypt(encryptedKey, password)

			// Convert Uint8Array to hex string
			const privateKeyHex = Array.from(decryptedBytes)
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('')

			// Login with the decrypted key
			await authActions.loginWithPrivateKey(privateKeyHex)
			authStore.setState((state) => ({ ...state, needsDecryptionPassword: false }))
			authActions.checkAndShowTermsDialog()
		} catch (error) {
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	encryptAndSavePrivateKey: async (privateKey: string, password: string, logN: number = 18) => {
		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Normalize the private key
			const normalizedKey = privateKey.startsWith('nsec1') ? privateKey : nip19.nsecEncode(hexToBytes(privateKey))

			const { data: secretKeyBytes } = nip19.decode(normalizedKey) as { data: Uint8Array }
			const pubkey = getPublicKey(secretKeyBytes)

			// Use nostr-tools encrypt function
			const encryptedKey = encrypt(secretKeyBytes, password, logN, 1)

			// Replace encrypted key with format: "pubkey:ncryptsec..."
			localStorage.setItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, `${pubkey}:${encryptedKey}`)

			return true
		} catch (error) {
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	checkAndShowTermsDialog: () => {
		if (!hasAcceptedTerms()) {
			uiActions.openDialog('terms')
		}
	},

	loginWithPrivateKey: async (privateKey: string) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

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

			void cartActions.reconcileRemoteCartForUser(user.pubkey, signer, ndk, wasLoggedOut)

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

		// Check if extensions are available before attempting login
		const availableExtensions = authActions.getAvailableNostrExtensions()
		if (availableExtensions.length === 0) {
			throw new Error('No Nostr extension detected. Please install a Nostr browser extension (e.g., Alby, nos2x) before logging in.')
		}

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			const signer = new NDKNip07Signer()
			await signer.blockUntilReady()
			ndkActions.setSigner(signer)

			const user = await signer.user()

			if (!user || !user.pubkey) {
				throw new Error('Failed to authenticate with Nostr extension. Please make sure your extension is unlocked and try again.')
			}

			persistAuthenticatedLoginState(user)

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			void cartActions.reconcileRemoteCartForUser(user.pubkey, signer, ndk, wasLoggedOut)

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

	loginWithNip46: async (bunkerUrl: string, localSigner: NDKPrivateKeySigner, options?: Nip46LoginOptions) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true, bootstrapError: null }))
			const signer = new NDKNip46Signer(ndk, bunkerUrl, localSigner)

			if (options?.onAuthUrl) {
				signer.on('authUrl', (url) => {
					if (typeof url === 'string' && url.length > 0) {
						options.onAuthUrl?.(url)
					}
				})
			}

			const loginResult = await completeNip46LoginHandshake(signer, options?.remotePubkey, options?.timeoutMs, ndk)

			if (!loginResult?.user.pubkey) {
				throw new Error('Failed to resolve the remote signer pubkey for login')
			}
			const { user, signer: authenticatedSigner } = loginResult

			// The handshake above establishes the signer. Relay and wallet bootstrap
			// can continue in the background; surface failures without logging out.
			void ndkActions.setSigner(authenticatedSigner).then(
				() => {
					authStore.setState((state) => ({ ...state, bootstrapError: null }))
				},
				(error) => {
					const message = error instanceof Error ? error.message : 'Wallet and relay setup could not finish'
					console.error('[NIP46] post-login signer setup failed', error)
					authStore.setState((state) => ({ ...state, bootstrapError: message }))
					toast.error('Signed in, but wallet and relay setup could not finish. You can continue using the marketplace.')
				},
			)
			persistAuthenticatedLoginState(user, localSigner.privateKey || '', bunkerUrl)

			authStore.setState((state) => ({
				...state,
				user,
				isAuthenticated: true,
			}))

			void cartActions.reconcileRemoteCartForUser(user.pubkey, authenticatedSigner, ndk, wasLoggedOut)

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
		// Clear cart when user logs out
		cartActions.clear({ publishRemote: false, reason: 'logout' })
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

	getNeedsMigration: (): boolean => {
		const authData = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)

		if (authData) {
			const privateKey = authData.split(':').at(1)

			// Validate if private key has been stored in raw format ("nsec...")
			try {
				if (privateKey?.startsWith('nsec') && nip19.decode(privateKey).type === 'nsec') {
					return true
				}
			} catch {
				// Silence decode errors since migration is not possible.
			}
		}

		return false
	},

	migrateToEncryptedKey: async (password: string) => {
		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Get the unencrypted private key
			const authData = localStorage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
			const privateKey = authData?.split(':').at(1)

			if (!privateKey) {
				throw new Error('No private key found to migrate')
			}

			authActions.encryptAndSavePrivateKey(privateKey, password)

			// Update auth state
			authStore.setState((state) => ({
				...state,
				needsMigration: false,
				needsDecryptionPassword: false,
			}))

			// Continue with login using the unencrypted key (it will be wiped after)
			await authActions.loginWithPrivateKey(privateKey)
		} catch (error) {
			console.error('Migration failed:', error)
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},
}

export const useAuth = () => {
	return {
		...authStore.state,
		...authActions,
	}
}
