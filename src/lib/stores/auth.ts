import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkActions, ndkStore } from './ndk'
import { cartActions } from './cart'
import { fetchProductsByPubkey } from '@/queries/products'
import { hasAcceptedTerms, TERMS_ACCEPTED_KEY } from '@/components/dialogs/TermsConditionsDialog'
import { uiActions } from './ui'
import { getPublicKey, nip19 } from 'nostr-tools'
import { decrypt, encrypt } from 'nostr-tools/nip49'
import { hexToBytes } from 'nostr-tools/utils'

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
	expectedUserPubkey?: string
}

function getAuthStorage(): Storage | undefined {
	try {
		if (typeof window !== 'undefined' && window.localStorage) {
			return window.localStorage
		}

		if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
			const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
			if (storage) {
				return storage
			}
		}
	} catch {
		// Storage can be unavailable in non-browser and privacy-restricted contexts.
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
const NIP46_USER_PUBKEY_RECOVERY_TIMEOUT_MS = 2000

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

function cacheResolvedNip46User(signer: NDKNip46Signer, user: NDKUser): void {
	// NDKNip46Signer does not expose a public setter for the user it normally
	// caches during blockUntilReady(). Recovery has already verified the same
	// user with get_public_key, so populate that cache on the native signer
	// instead of proxying its public identity and relay-facing behavior.
	;(signer as unknown as { _user?: NDKUser })._user = user
}

function isHexPubkey(value: string): boolean {
	return /^[a-f0-9]{64}$/i.test(value)
}

async function recoverNip46UserPubkey(
	signer: NDKNip46Signer,
	expectedUserPubkey: string | undefined,
	timeoutMs: number,
): Promise<string | null> {
	const configuredUserPubkey = signer.userPubkey
	const expectedPubkeys = new Set([expectedUserPubkey, configuredUserPubkey].filter((value): value is string => Boolean(value)))
	const knownResponseEvents = new Set(getNip46ResponseEventNames(signer))
	const recoveryTimeoutMs = Math.max(1, Math.min(timeoutMs, NIP46_USER_PUBKEY_RECOVERY_TIMEOUT_MS))
	const timeoutError = new Error('NIP-46 get_public_key recovery timed out')
	let timeout: ReturnType<typeof setTimeout> | undefined

	// NDK's getPublicKey() returns userPubkey without making an RPC request when
	// it is already populated from a bunker URL. Clear that unverified value so
	// recovery always resolves the account identity from the remote signer.
	signer.userPubkey = undefined

	try {
		const userPubkey = await Promise.race([
			signer.getPublicKey(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(timeoutError), recoveryTimeoutMs)
			}),
		])

		if (!isHexPubkey(userPubkey)) {
			throw new Error('NIP-46 get_public_key returned an invalid pubkey')
		}

		if (expectedPubkeys.size > 0 && !expectedPubkeys.has(userPubkey)) {
			throw new Error('NIP-46 get_public_key did not match the expected user')
		}

		signer.userPubkey = userPubkey
		return userPubkey
	} catch (error) {
		signer.userPubkey = configuredUserPubkey
		console.warn('[NIP46] get_public_key recovery failed', error)
		return null
	} finally {
		if (timeout) clearTimeout(timeout)
		cancelNip46HandshakeListeners(signer, knownResponseEvents)
	}
}

export async function completeNip46LoginHandshake(
	signer: NDKNip46Signer,
	expectedUserPubkey?: string,
	timeoutMs = 8000,
	ndk?: ReturnType<typeof ndkActions.getNDK>,
): Promise<Nip46LoginResult | null> {
	const resolvedNdk = ndk ?? ndkActions.getNDK()
	if (!resolvedNdk) {
		throw new Error('NDK not initialized for NIP-46 user resolution')
	}

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
			if (expectedUserPubkey && user.pubkey !== expectedUserPubkey) {
				console.warn('[NIP46] resolved user pubkey did not match the expected user')
				return null
			}
			return { user, signer }
		}
	} catch (error) {
		if (error !== timeoutError) {
			console.warn('[NIP46] handshake failed before resolving the user pubkey', error)
			return null
		}

		console.warn('[NIP46] handshake timed out; resolving the user pubkey with get_public_key', error)
	} finally {
		if (timeout) clearTimeout(timeout)
		cancelNip46HandshakeListeners(signer, knownResponseEvents)
	}

	const userPubkey = await recoverNip46UserPubkey(signer, expectedUserPubkey, timeoutMs)
	if (!userPubkey) {
		return null
	}

	const user = resolvedNdk.getUser({ pubkey: userPubkey })
	cacheResolvedNip46User(signer, user)
	return { user, signer }
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
			const storage = getAuthStorage()
			if (!storage) return

			// Check for migration (unencrypted private key) first
			if (authActions.getNeedsMigration()) {
				authStore.setState((state) => ({
					...state,
					needsMigration: true,
				}))

				return
			}

			// Only trigger auth check if auto-login is enabled

			const autoLogin = storage.getItem(NOSTR_AUTO_LOGIN)
			if (autoLogin !== 'true') return

			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			// Signer / Bunker URL

			const privateKeySigner = storage.getItem(NOSTR_LOCAL_SIGNER_KEY)
			const bunkerUrl = storage.getItem(NOSTR_CONNECT_KEY)

			if (privateKeySigner && bunkerUrl) {
				await authActions.loginWithNip46(bunkerUrl, new NDKPrivateKeySigner(privateKeySigner), {
					expectedUserPubkey: storage.getItem(NOSTR_USER_PUBKEY) ?? undefined,
				})
				authActions.checkAndShowTermsDialog()
				return
			}

			// Private key decryption

			const privateKey = storage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)

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
			const storage = getAuthStorage()
			if (!storage) throw new Error('Browser storage is unavailable')

			const encryptedPrivateKey = storage.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
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
			const storage = getAuthStorage()
			if (!storage) throw new Error('Browser storage is unavailable')

			// Normalize the private key
			const normalizedKey = privateKey.startsWith('nsec1') ? privateKey : nip19.nsecEncode(hexToBytes(privateKey))

			const { data: secretKeyBytes } = nip19.decode(normalizedKey) as { data: Uint8Array }
			const pubkey = getPublicKey(secretKeyBytes)

			// Use nostr-tools encrypt function
			const encryptedKey = encrypt(secretKeyBytes, password, logN, 1)

			// Replace encrypted key with format: "pubkey:ncryptsec..."
			storage.setItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY, `${pubkey}:${encryptedKey}`)

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

		const wasLoggedOut = getAuthStorage()?.getItem(NOSTR_AUTO_LOGIN) !== 'true'

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

		const wasLoggedOut = getAuthStorage()?.getItem(NOSTR_AUTO_LOGIN) !== 'true'

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

		const wasLoggedOut = getAuthStorage()?.getItem(NOSTR_AUTO_LOGIN) !== 'true'

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

			const loginResult = await completeNip46LoginHandshake(signer, options?.expectedUserPubkey, options?.timeoutMs, ndk)

			if (!loginResult?.user.pubkey) {
				throw new Error('Failed to resolve the NIP-46 user pubkey for login')
			}
			const { user, signer: authenticatedSigner } = loginResult

			await ndkActions.setSigner(authenticatedSigner)
			authStore.setState((state) => ({ ...state, bootstrapError: null }))
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
		if (ndkStore.state.ndk) {
			ndkActions.removeSigner()
		}
		const storage = getAuthStorage()
		storage?.removeItem(NOSTR_LOCAL_SIGNER_KEY)
		storage?.removeItem(NOSTR_CONNECT_KEY)
		storage?.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		storage?.removeItem(NOSTR_AUTO_LOGIN)
		storage?.removeItem(NOSTR_USER_PUBKEY)
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
		const authData = getAuthStorage()?.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)

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
			const authData = getAuthStorage()?.getItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
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
