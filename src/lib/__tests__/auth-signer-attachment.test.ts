/**
 * Signer-attachment transactionality tests (review 5191403562 A).
 *
 * `applesauceIo.sign()` authorizes from `getSignerCapability()` — NOT from
 * auth-store state. So any login lane that registers the capability before
 * its fallible work (readiness, identity resolution, persistence) can leave a
 * USABLE signer behind on a failed login: `isAuthenticated` flips back to
 * false, but the registry still hands out a signing capability.
 *
 * Contract asserted here for every failure path: auth state false, registry
 * empty, NDK signer absent, NIP-46 teardown completed, and
 * `applesauceIo.sign()` rejects.
 *
 * The heavy store/UI/query deps are stubbed (the real auth.ts control flow
 * runs); `connectBunkerSigner` is mocked so a NIP-46 bundle can be handed to
 * the lane without a relay.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const USER_PUBKEY = 'aa'.repeat(32)

const mockNdkActions = {
	getNDK: mock(() => ({ getUser: () => ({ pubkey: USER_PUBKEY }) })),
	setSigner: mock((_signer?: unknown) => {}),
	// Mirrors the real store: `removeSigner()` is `setSigner(undefined)`.
	removeSigner: mock(() => {
		mockNdkActions.setSigner(undefined)
	}),
	runSignerOnboarding: mock(() => {}),
	clearSignerOnboarding: mock(() => {}),
}
const mockCartActions = {
	reconcileRemoteCartForUser: mock(() => {}),
	clear: mock(() => {}),
}
mock.module('@/lib/nostr/ndk-store-seam', () => ({ ndkActions: mockNdkActions }))
mock.module('@/lib/stores/cart', () => ({ cartActions: mockCartActions }))
mock.module('@/queries/products', () => ({ fetchProductsByPubkey: mock(() => Promise.resolve([])) }))
mock.module('@/components/dialogs/TermsConditionsDialog', () => ({
	hasAcceptedTerms: mock(() => true),
	TERMS_ACCEPTED_KEY: 'terms_accepted',
}))
mock.module('@/lib/stores/ui', () => ({ uiActions: { openDialog: mock(() => {}) } }))

// The NIP-46 lane's signer bundle — its teardown spy is the assertion surface
// for "NIP-46 transport torn down exactly once on failure".
const bunkerTeardown = mock(() => {})
mock.module('@/lib/nostr/nostr-connect-signer', () => ({
	connectBunkerSigner: mock(() =>
		Promise.resolve({
			signer: { getNbunksec: () => 'nbunksec1fresh', logout: bunkerTeardown },
			capability: {
				getPublicKey: mock(() => Promise.resolve(USER_PUBKEY)),
				signEvent: mock(() => Promise.reject(new Error('not used'))),
			},
			clientKeyHex: 'dd'.repeat(32),
		}),
	),
}))

import { authActions, authStore, NOSTR_AUTO_LOGIN, NOSTR_LOCAL_SIGNER_KEY, NOSTR_CONNECT_KEY } from '@/lib/stores/auth'
import { applesauceIo } from '@/lib/nostr/io-applesauce'
import { getSignerCapability, setSignerCapability, setSignerTeardown } from '@/lib/nostr/signer-registry'
import { VAULT_STORAGE_KEY } from '@/lib/nostr/session-vault'

const BUNKER_URL = `bunker://${'cc'.repeat(32)}?relay=wss://relay.example.com&secret=hunter2`

const realLocalStorage = globalThis.localStorage
const realWindow = (globalThis as { window?: unknown }).window
const memoryStorage = new Map<string, string>()

/** localStorage double; optionally refuses to write the vault envelope. */
let failVaultWrite = false

beforeEach(() => {
	failVaultWrite = false
	authStore.setState(() => ({
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
		needsMigration: false,
		needsSessionUnlock: false,
	}))
	memoryStorage.clear()
	mockNdkActions.setSigner.mockClear()
	mockNdkActions.setSigner.mockImplementation(() => {})
	mockNdkActions.removeSigner.mockClear()
	mockNdkActions.runSignerOnboarding.mockClear()
	mockCartActions.reconcileRemoteCartForUser.mockClear()
	bunkerTeardown.mockClear()
	setSignerCapability(undefined)
	setSignerTeardown(undefined)
	globalThis.localStorage = {
		getItem: (key: string) => memoryStorage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (failVaultWrite && key === VAULT_STORAGE_KEY) throw new Error('disk full')
			memoryStorage.set(key, value)
		},
		removeItem: (key: string) => {
			memoryStorage.delete(key)
		},
		clear: () => {
			memoryStorage.clear()
		},
	} as unknown as Storage
	memoryStorage.set(NOSTR_AUTO_LOGIN, 'true')
})

afterEach(() => {
	globalThis.localStorage = realLocalStorage
	globalThis.window = realWindow as never
})

/** The most recent value handed to the NDK store's setSigner (undefined = detached). */
function lastSetSignerValue(): unknown {
	const calls = mockNdkActions.setSigner.mock.calls
	return calls.length === 0 ? undefined : calls[calls.length - 1][0]
}

/** The invariant every failed attach must leave behind. */
async function expectNothingAttached(): Promise<void> {
	expect(authStore.state.isAuthenticated).toBe(false)
	expect(authStore.state.isAuthenticating).toBe(false)
	expect(getSignerCapability()).toBeUndefined()
	// NDK signer absent: the detach chokepoint ran (removeSigner ->
	// setSigner(undefined)), so the store holds no signer either.
	expect(lastSetSignerValue()).toBeUndefined()
	await expect(applesauceIo.sign({ kind: 1, content: 'x', tags: [], created_at: 1 })).rejects.toThrow(/no signer capability attached/)
}

describe('failed login leaves no usable signer behind (review 5191403562 A)', () => {
	test('nsec lane: failure at the NDK-signer attach rolls the capability back', async () => {
		mockNdkActions.setSigner.mockImplementationOnce(() => {
			throw new Error('ndk signer attach failed')
		})

		await expect(authActions.loginWithPrivateKey('ee'.repeat(32))).rejects.toThrow('ndk signer attach failed')

		await expectNothingAttached()
	})

	test('extension lane: failure while resolving the extension identity leaves nothing attached', async () => {
		globalThis.window = {
			nostr: {
				getPublicKey: () => Promise.reject(new Error('extension locked')),
				signEvent: () => Promise.reject(new Error('extension locked')),
			},
		} as never

		await expect(authActions.loginWithExtension()).rejects.toThrow()

		await expectNothingAttached()
		// Never reached the attach step: the capability must not have been
		// registered before the identity was known.
		expect(mockNdkActions.setSigner.mock.calls.filter((args) => args[0] !== undefined)).toHaveLength(0)
	})

	test('NIP-46 lane: a vault-write failure after connect rolls back signer + transport', async () => {
		failVaultWrite = true

		await expect(
			authActions.loginWithNip46(BUNKER_URL, undefined, { sessionPassphrase: 'device-pass', vaultIterations: 1_000 }),
		).rejects.toThrow('disk full')

		await expectNothingAttached()
		// Persistence runs BEFORE the attach, so no signer was ever handed to
		// the NDK store...
		expect(mockNdkActions.setSigner.mock.calls.filter((args) => args[0] !== undefined)).toHaveLength(0)
		// ...and the live NIP-46 transport is torn down exactly once.
		expect(bunkerTeardown).toHaveBeenCalledTimes(1)
	})
})

describe('happy paths still attach exactly once', () => {
	test('nsec lane attaches the capability + NDK signer once on success', async () => {
		await authActions.loginWithPrivateKey('ee'.repeat(32))

		expect(authStore.state.isAuthenticated).toBe(true)
		expect(getSignerCapability()).toBeDefined()
		expect(mockNdkActions.setSigner).toHaveBeenCalledTimes(1)
		expect(mockNdkActions.runSignerOnboarding).toHaveBeenCalledTimes(1)
	})

	test('NIP-46 lane persists the vault, then attaches once', async () => {
		await authActions.loginWithNip46(BUNKER_URL, undefined, { sessionPassphrase: 'device-pass', vaultIterations: 1_000 })

		expect(authStore.state.isAuthenticated).toBe(true)
		expect(memoryStorage.has(VAULT_STORAGE_KEY)).toBe(true)
		expect(memoryStorage.has(NOSTR_LOCAL_SIGNER_KEY)).toBe(false)
		expect(memoryStorage.has(NOSTR_CONNECT_KEY)).toBe(false)
		expect(getSignerCapability()).toBeDefined()
		expect(mockNdkActions.setSigner).toHaveBeenCalledTimes(1)
	})
})
