import { Store } from '@tanstack/store'
import { ndkActions } from '@/lib/nostr/ndk-store-seam'
import type { NDKUser } from '@/lib/nostr/ndk-events'
import { cartActions } from './cart'
import { fetchProductsByPubkey } from '@/queries/products'
import { hasAcceptedTerms, TERMS_ACCEPTED_KEY } from '@/components/dialogs/TermsConditionsDialog'
import { uiActions } from './ui'
import { getPublicKey, nip19 } from 'nostr-tools'
import { encrypt } from 'nostr-tools/nip49'
import { hexToBytes } from 'nostr-tools/utils'
import {
	createExtensionSigner,
	createPrivateKeySigner,
	runSignerTeardown,
	setSignerCapability,
	setSignerTeardown,
} from '@/lib/nostr/signer-registry'
import { connectBunkerSigner } from '@/lib/nostr/nostr-connect-signer'
import { createPasswordSignerSession } from '@/lib/nostr/password-signer-session'
import { rehydrateNostrConnectSession } from '@/lib/nostr/nostr-connect-session'
import {
	clearVaultedSession,
	hasLegacyPlaintextSession,
	hasVaultedSession,
	LEGACY_CONNECT_URL_KEY,
	LEGACY_LOCAL_SIGNER_KEY,
	migrateLegacySessionToVault,
	preferredSessionSource,
	saveVaultedSession,
	unlockVault,
	discardLegacySession,
} from '@/lib/nostr/session-vault'
import type { UnlockOptions, WrapOptions } from '@/lib/nostr/session-vault'
import { NdkSignerAdapter } from '@/lib/nostr/ndk-signer-adapter'
import type { SignerCapability } from '@/lib/nostr/signer-capability'

// Single source of truth for the legacy plaintext-pair literals is
// session-vault.ts (LEGACY_*_KEY) — these aliases keep the historical
// auth.ts names importable while preventing drift between the two
// definitions (Gate 2.5: duplicated constants silently break migration).
export const NOSTR_CONNECT_KEY = LEGACY_CONNECT_URL_KEY
export const NOSTR_LOCAL_SIGNER_KEY = LEGACY_LOCAL_SIGNER_KEY
export const NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY = 'nostr_local_encrypted_signer_key'
export const NOSTR_AUTO_LOGIN = 'nostr_auto_login'
export const NOSTR_USER_PUBKEY = 'nostr_user_pubkey'

interface AuthState {
	user: NDKUser | null
	isAuthenticated: boolean
	needsDecryptionPassword: boolean
	isAuthenticating: boolean
	needsMigration: boolean
	/** A vaulted/legacy NIP-46 session exists — the unlock prompt is showing. */
	needsSessionUnlock: boolean
}

interface Nip46LoginOptions {
	onAuthUrl?: (url: string) => void
	/**
	 * Session passphrase for encrypted-at-rest persistence (ADR-0008 B-3 /
	 * #996 H8). When supplied, the nbunksec session is wrapped
	 * PBKDF2+AES-GCM under `nostr_session_v1`. Without it the session is
	 * in-memory only — the plaintext pair is NEVER written again.
	 */
	sessionPassphrase?: string
	/** KDF cost override (tests only; default is the >= 600k floor). */
	vaultIterations?: number
}

const initialState: AuthState = {
	user: null,
	isAuthenticated: false,
	needsDecryptionPassword: false,
	isAuthenticating: false,
	needsMigration: false,
	needsSessionUnlock: false,
}

export const authStore = new Store<AuthState>(initialState)

/**
 * Attach a fully-ready signer session in ONE step (review 5191403562 A):
 * capability registry + NDK signer + auth identity together, and only after
 * every fallible step of the lane has succeeded.
 *
 * `applesauceIo.sign()` authorizes from `getSignerCapability()`, NOT from the
 * auth store, so registering the capability before readiness / identity
 * resolution / persistence would leave a USABLE signer behind when the login
 * then fails.
 */
function attachSignerSession(capability: SignerCapability, signer: NdkSignerAdapter, user: NDKUser, extraState?: Partial<AuthState>): void {
	setSignerCapability(capability)
	ndkActions.setSigner(signer)
	authStore.setState((state) => ({ ...state, user, isAuthenticated: true, ...extraState }))
}

/**
 * Detach everything a failed login may have registered (review 5191403562 A).
 * Called from every lane's catch path: clears the capability so
 * `applesauceIo.sign()` fails closed again, detaches the NDK signer through
 * the store's single detach chokepoint, and runs the signer teardown so a
 * half-open NIP-46 transport is closed exactly once.
 */
function rollbackSignerAttachment(): void {
	setSignerCapability(undefined)
	ndkActions.removeSigner()
	void runSignerTeardown()
}

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

			// Signer / Bunker URL — legacy plaintext pair (ADR-0008 invariant 4:
			// persisted-session migration policy). Read ONCE: surface the unlock
			// prompt; the user either completes the migrate-on-unlock (wrap +
			// delete) or is logged out. NEVER silently re-login with plaintext.

			if (hasLegacyPlaintextSession() || hasVaultedSession()) {
				authStore.setState((state) => ({ ...state, needsSessionUnlock: true }))
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

			// NIP-49 lane via PasswordSigner (ADR-0008 B-3/B-4): the ncryptsec is
			// decrypted inside the signer, which then holds the key in memory
			// behind the capability seam. TRANSITIONAL: decryptAndLogin still
			// derives the raw key hex below because loginWithPrivateKey expects
			// it — B-4 unifies session storage and removes this materialization.
			// `fromNcryptsec` throws on a wrong password ("failed to decrypt
			// key"), preserving the fail-closed UX.
			const session = await createPasswordSignerSession(encryptedKey, password)
			if (!session.signer.key) throw new Error('Failed to decrypt key')
			const privateKeyHex = Array.from(session.signer.key)
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
			// nsec lane: build the applesauce PrivateKeySigner behind the signer
			// registry + capability seam, then attach an NDKSigner adapter so the
			// ~70 `signer.user()` consumers (and the wallet NWC paths) keep working
			// unchanged (ADR-0008 strangler-fig). No NEW plaintext is persisted here
			// — the nsec key stays in-memory until Wave B-3 unifies session storage.
			//
			// Readiness + identity resolution happen BEFORE anything is attached
			// (review 5191403562 A): `applesauceIo.sign()` authorizes from the
			// capability registry, not from auth-store state.
			const capability = createPrivateKeySigner(privateKey)
			const signer = new NdkSignerAdapter(capability)
			await signer.blockUntilReady()
			const user = await signer.user()

			// Atomic attach: capability + NDK signer + auth identity together.
			attachSignerSession(capability, signer, user)

			// Kick off the post-signer onboarding pipeline (relay list,
			// NWC select, NIP-60 init) in the background — login can
			// resolve before these finish so the user isn't gated on a
			// slow relay-list fetch.
			void ndkActions.runSignerOnboarding(signer)

			void cartActions.reconcileRemoteCartForUser(user.pubkey, signer, ndk, wasLoggedOut)

			return user
		} catch (error) {
			rollbackSignerAttachment()
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
			// NIP-07 lane: build the applesauce ExtensionSigner behind the signer
			// registry + capability seam, then attach an NDKSigner adapter so the
			// ~70 `signer.user()` consumers (and the wallet NWC paths) keep working
			// unchanged (ADR-0008 strangler-fig). No key is held locally.
			//
			// Readiness + identity resolution + persistence happen BEFORE anything
			// is attached (review 5191403562 A).
			const capability = createExtensionSigner()
			const signer = new NdkSignerAdapter(capability)
			// blockUntilReady awaits getPublicKey — the extension-available check
			// (ExtensionSigner throws ExtensionMissingError when window.nostr is
			// absent, on top of the getAvailableNostrExtensions guard above).
			await signer.blockUntilReady()

			const user = await signer.user()

			if (!user || !user.pubkey) {
				throw new Error('Failed to authenticate with Nostr extension. Please make sure your extension is unlocked and try again.')
			}

			// Store user pubkey and enable auto-login for persistence
			localStorage.setItem(NOSTR_USER_PUBKEY, user.pubkey)
			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			// Atomic attach: capability + NDK signer + auth identity together.
			attachSignerSession(capability, signer, user)

			// Kick off the post-signer onboarding pipeline (relay list,
			// NWC select, NIP-60 init) in the background — login can
			// resolve before these finish so the user isn't gated on a
			// slow relay-list fetch.
			void ndkActions.runSignerOnboarding(signer)

			void cartActions.reconcileRemoteCartForUser(user.pubkey, signer, ndk, wasLoggedOut)

			return user
		} catch (error) {
			rollbackSignerAttachment()
			authStore.setState((state) => ({
				...state,
				isAuthenticated: false,
			}))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	loginWithNip46: async (bunkerUrl: string, clientKeyHex?: string, options?: Nip46LoginOptions) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))
			// NIP-46 bunker lane: build the applesauce NostrConnectSigner behind
			// the signer capability seam (ADR-0008 Wave A3b / B-2), then attach an
			// NDKSigner adapter so the ~70 `signer.user()` consumers (and the wallet
			// NWC paths) keep working unchanged. The app-side wrappers enforce the
			// ADR invariants the library does NOT provide (strict connect-secret
			// binding, RPC timeouts, authUrl → onAuth, pubkey-equality on sign).
			const bundle = await connectBunkerSigner(bunkerUrl, {
				clientKeyHex,
				onAuth: options?.onAuthUrl
					? (url) => {
							options.onAuthUrl?.(url)
							return Promise.resolve()
						}
					: undefined,
			})
			const adapter = new NdkSignerAdapter(bundle.capability)
			// Keep the live signer handle so any detach path (logout / removeSigner
			// / a failed login rollback) can tear it down. `NostrConnectSigner.logout()`
			// notifies the remote and close()s the repeat()/retry() REQ subscription —
			// without this, a re-login stacks a second kind-24133 subscription on the
			// shared pool. Registered as soon as the transport exists so a later
			// failure in this lane closes it (review 5191403562 A/C).
			setSignerTeardown(() => bundle.signer.logout())
			await adapter.blockUntilReady()
			const user = await adapter.user()

			// Session persistence (ADR-0008 B-3 / #996 H8): with a passphrase the
			// nbunksec session is wrapped PBKDF2+AES-GCM under nostr_session_v1;
			// without one the session stays in-memory. The legacy plaintext pair
			// is NEVER written again. Persistence runs BEFORE the attach
			// (review 5191403562 A): a vault-write failure must not leave a
			// usable signer attached.
			if (options?.sessionPassphrase) {
				const wrapOptions: WrapOptions | undefined = options.vaultIterations != null ? { iterations: options.vaultIterations } : undefined
				await saveVaultedSession(bundle.signer.getNbunksec(), options.sessionPassphrase, wrapOptions)
			}

			// Atomic attach: capability + NDK signer + auth identity together.
			attachSignerSession(bundle.capability, adapter, user)

			// Kick off the post-signer onboarding pipeline (relay list,
			// NWC select, NIP-60 init) in the background — login can
			// resolve before these finish so the user isn't gated on a
			// slow relay-list fetch.
			void ndkActions.runSignerOnboarding(adapter)

			void cartActions.reconcileRemoteCartForUser(user.pubkey, adapter, ndk, wasLoggedOut)

			return user
		} catch (error) {
			rollbackSignerAttachment()
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
		// Tear down the NIP-46 signer session (closes its REQ subscription) in
		// lockstep with the capability, so re-login does not stack subscriptions.
		void runSignerTeardown()
		// Clear the signer capability in lockstep with the NDK signer so the
		// io-applesauce `sign()` port fails closed again after logout.
		setSignerCapability(undefined)
		// Restore the CENTRALIZED per-user onboarding teardown (active NWC
		// wallet URI + NIP-60 wallet state) — without it user A's wallet
		// state bleeds into the unauthenticated session and the next login's
		// onboarding window. Runs before the NDK-availability guard below:
		// teardown must not depend on `ndk` still being initialized.
		ndkActions.clearSignerOnboarding()
		if (!ndk) return
		ndkActions.removeSigner()
		localStorage.removeItem(NOSTR_LOCAL_SIGNER_KEY)
		localStorage.removeItem(NOSTR_CONNECT_KEY)
		localStorage.removeItem(NOSTR_LOCAL_ENCRYPTED_SIGNER_KEY)
		localStorage.removeItem(NOSTR_AUTO_LOGIN)
		// Lock on logout (ADR-0008 B-3): the vaulted NIP-46 session is removed
		// with the rest of the persisted auth state.
		clearVaultedSession()
		// Clear cart when user logs out
		cartActions.clear({ publishRemote: false, reason: 'logout' })
		authStore.setState(() => initialState)
	},

	/**
	 * Unlock prompt completion (ADR-0008 B-3). With a legacy plaintext pair
	 * this migrates it into the encrypted vault (wrap + delete); otherwise it
	 * unwraps the stored vault. Either way the recovered nbunksec session is
	 * rehydrated into a live `NostrConnectSigner` and the user is signed in.
	 * Fails closed on a wrong passphrase (nothing migrated, prompt stays up).
	 */
	unlockVaultedSession: async (passphrase: string, options?: WrapOptions & Partial<UnlockOptions>) => {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const wasLoggedOut = localStorage.getItem(NOSTR_AUTO_LOGIN) !== 'true'

		try {
			authStore.setState((state) => ({ ...state, isAuthenticating: true }))

			let nbunksec: string
			// Precedence (review 5654374915 item 6): the vault wins whenever it
			// exists. A legacy plaintext pair can coexist with a newer vault
			// (loginWithNip46 never deletes it), and migrating the stale pair
			// would overwrite the fresh vault and silently restore the OLD
			// session.
			if (preferredSessionSource() === 'legacy') {
				// Read-ONCE migration: wrap the plaintext pair, then delete it.
				;({ nbunksec } = await migrateLegacySessionToVault(passphrase, options))
			} else {
				if (!hasVaultedSession()) throw new Error('No vaulted session to unlock')
				const { iterations: _wrapOnly, ...unlockOptions } = options ?? {}
				nbunksec = await unlockVault(undefined, passphrase, unlockOptions)
				// The vault opened, so it is the live session: purge the stale
				// plaintext bearer capability rather than retain it (ADR-0008
				// invariant 4 — never silently keep plaintext at rest).
				discardLegacySession()
			}

			// Restore path: derive → decrypt → fromNbunksec → NostrConnectSigner.
			const bundle = await rehydrateNostrConnectSession(nbunksec)
			const adapter = new NdkSignerAdapter(bundle.capability)
			setSignerTeardown(() => bundle.signer.logout())
			await adapter.blockUntilReady()
			const user = await adapter.user()

			// Atomic attach (review 5191403562 A): the unlock lane runs the
			// same all-or-nothing attach as the login lanes.
			attachSignerSession(bundle.capability, adapter, user, { needsSessionUnlock: false })

			localStorage.setItem(NOSTR_AUTO_LOGIN, 'true')

			// Kick off the post-signer onboarding pipeline (relay list,
			// NWC select, NIP-60 init) in the background — login can
			// resolve before these finish so the user isn't gated on a
			// slow relay-list fetch.
			void ndkActions.runSignerOnboarding(adapter)

			void cartActions.reconcileRemoteCartForUser(user.pubkey, adapter, ndk, wasLoggedOut)
			authActions.checkAndShowTermsDialog()

			return user
		} catch (error) {
			rollbackSignerAttachment()
			authStore.setState((state) => ({ ...state, isAuthenticated: false }))
			throw error
		} finally {
			authStore.setState((state) => ({ ...state, isAuthenticating: false }))
		}
	},

	/**
	 * Unlock prompt refusal (ADR-0008 invariant 4b): the user declined the
	 * migration, so the session is discarded — plaintext pair deleted, NO
	 * vault written, user logged out. An intentional, user-visible forced
	 * re-login; never silent plaintext retention.
	 */
	discardVaultedSession: () => {
		// Intentional forced re-login: delete the plaintext pair (migration
		// refused) AND any vault (the user wants out), plus the auto-login flag.
		// cartActions.clear is intentionally NOT called here, unlike logout():
		// no signer was ever attached on this path, so there is no user-scoped
		// cart state to reconcile — the asymmetry is deliberate.
		discardLegacySession()
		clearVaultedSession()
		localStorage.removeItem(NOSTR_AUTO_LOGIN)
		authStore.setState((state) => ({ ...state, needsSessionUnlock: false, isAuthenticated: false, user: null }))
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
