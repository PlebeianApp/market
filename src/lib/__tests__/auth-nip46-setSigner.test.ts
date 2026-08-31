/**
 * Test B: Verify that isAuthenticated stays false when ndkActions.setSigner()
 * rejects during loginWithNip46. Before the fix, setSigner was fire-and-forget
 * (.then() without await), so isAuthenticated was set to true before the signer
 * was actually configured on the NDK instance.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const actualUserPubkey = 'b'.repeat(64)

// Mutable mock controllers so each test can configure the behaviour.
let setSignerImpl: (signer: unknown) => Promise<void> = async () => {}

// Mock @nostr-dev-kit/ndk to avoid real relay connections
mock.module('@nostr-dev-kit/ndk', () => {
	class MockNDKUser {
		pubkey: string
		constructor(opts: { pubkey: string }) {
			this.pubkey = opts.pubkey
		}
	}

	class MockNDKPrivateKeySigner {
		privateKey: string
		constructor(privateKey: string) {
			this.privateKey = privateKey
		}
	}

	class MockNDKNip46Signer {
		ndk: unknown
		bunkerUrl: string
		localSigner: unknown
		userPubkey: string | undefined
		_user: { pubkey: string } | undefined
		rpc: {
			eventNames: () => string[]
			removeAllListeners: () => void
		}
		on() {}
		constructor(ndk: unknown, bunkerUrl: string, localSigner: unknown) {
			this.ndk = ndk
			this.bunkerUrl = bunkerUrl
			this.localSigner = localSigner
			this.userPubkey = actualUserPubkey
			this._user = { pubkey: actualUserPubkey }
			this.rpc = {
				eventNames: () => [],
				removeAllListeners: () => {},
			}
		}
		async blockUntilReady() {
			return { pubkey: this.userPubkey! }
		}
		async getPublicKey() {
			return this.userPubkey!
		}
		get pubkey() {
			return this.userPubkey!
		}
		get userSync() {
			return this._user
		}
		async user() {
			return this._user
		}
	}

	return {
		NDKNip07Signer: MockNDKNip46Signer,
		NDKNip46Signer: MockNDKNip46Signer,
		NDKPrivateKeySigner: MockNDKPrivateKeySigner,
		NDKUser: MockNDKUser,
	}
})

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		getNDK: () => ({
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}),
		setSigner: (signer: unknown) => setSignerImpl(signer),
		removeSigner: mock(() => {}),
	},
	ndkStore: {
		state: {
			ndk: {},
		},
	},
}))

mock.module('@/lib/stores/cart', () => ({
	cartActions: {
		reconcileRemoteCartForUser: mock(() => {}),
		clear: mock(() => {}),
	},
}))

mock.module('@/lib/stores/ui', () => ({
	uiActions: {
		openDialog: mock(() => {}),
	},
}))

mock.module('@/components/dialogs/TermsConditionsDialog', () => ({
	hasAcceptedTerms: () => true,
	TERMS_ACCEPTED_KEY: 'terms_accepted',
}))

mock.module('sonner', () => ({
	toast: {
		error: mock(() => {}),
	},
}))

// Import after mocks are registered
const { authStore, authActions } = await import('../stores/auth')

function createLocalStorageStub() {
	const store = new Map<string, string>()
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
	}
}

describe('loginWithNip46 setSigner ordering', () => {
	beforeEach(() => {
		const storage = createLocalStorageStub()
		Object.defineProperty(globalThis, 'localStorage', {
			value: storage,
			configurable: true,
		})
		// Reset auth store to initial state
		authStore.setState(() => ({
			user: null,
			isAuthenticated: false,
			needsDecryptionPassword: false,
			isAuthenticating: false,
			needsMigration: false,
		}))
		setSignerImpl = async () => {}
	})

	afterEach(() => {
		setSignerImpl = async () => {}
	})

	test('isAuthenticated stays false when setSigner rejects', async () => {
		// Make setSigner reject to simulate signer setup failure
		setSignerImpl = async () => {
			throw new Error('setSigner failed: NDK relay bootstrap error')
		}

		// loginWithNip46 should reject because setSigner failed, and
		// isAuthenticated should NOT be set to true.
		await expect(
			authActions.loginWithNip46('bunker://remote-pubkey?relay=wss://relay.test&secret=abc123', { privateKey: 'a'.repeat(64) } as any, {
				timeoutMs: 100,
			}),
		).rejects.toThrow()

		// FIX #2: isAuthenticated must remain false when setSigner rejects.
		// Before the fix, setSigner was fire-and-forget (.then() without await),
		// so isAuthenticated was set to true before the signer was actually
		// configured — the user appeared logged in but all signing operations
		// would fail.
		expect(authStore.state.isAuthenticated).toBe(false)
	})
})
