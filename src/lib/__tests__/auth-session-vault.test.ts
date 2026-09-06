/**
 * Auth store session-vault integration tests (ADR-0008 B-3, fixes #996 H8).
 *
 * Covers the auth.ts wiring around `src/lib/nostr/session-vault.ts`:
 *  - boot legacy gate: the plaintext pair triggers `needsSessionUnlock` and
 *    NO silent plaintext re-login;
 *  - migrate-on-unlock: `unlockVaultedSession(pass)` wraps + deletes the
 *    legacy pair and rehydrates a `NostrConnectSigner` from nbunksec;
 *  - refuse-migration-logout: `discardVaultedSession()` deletes plaintext
 *    and clears auth state;
 *  - loginWithNip46 persists ONLY the encrypted vault (never the plaintext
 *    pair) when a session passphrase is supplied;
 *  - logout clears the vaulted session (lock-on-logout);
 *  - PasswordSigner ncryptsec adoption (gap 4): every capability call is
 *    gated on `unlocked` — a locked signer rejects fast instead of
 *    deadlocking on the library's never-resolved `requestUnlock` Deferred.
 *
 * The heavy store/UI/query deps are stubbed so this exercises the real
 * auth.ts control flow; `connectBunkerSigner` / `rehydrateNostrConnectSession`
 * are mocked (their invariants are covered by their own test files).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const USER_PUBKEY = 'aa'.repeat(32)

const mockNdkActions = {
	getNDK: mock(() => ({ getUser: () => ({ pubkey: USER_PUBKEY }) })),
	setSigner: mock(() => {}),
	removeSigner: mock(() => {}),
}
const mockCartActions = {
	reconcileRemoteCartForUser: mock(() => {}),
	clear: mock(() => {}),
}
mock.module('@/lib/stores/ndk', () => ({ ndkActions: mockNdkActions }))
mock.module('@/lib/stores/cart', () => ({ cartActions: mockCartActions }))
mock.module('@/queries/products', () => ({ fetchProductsByPubkey: mock(() => Promise.resolve([])) }))
mock.module('@/components/dialogs/TermsConditionsDialog', () => ({
	hasAcceptedTerms: mock(() => true),
	TERMS_ACCEPTED_KEY: 'terms_accepted',
}))
mock.module('@/lib/stores/ui', () => ({ uiActions: { openDialog: mock(() => {}) } }))

// Rehydrate double — records the nbunksec it was handed.
const rehydratedSessions: string[] = []
const mockRehydrate = mock((nbunksec: string) => {
	rehydratedSessions.push(nbunksec)
	return Promise.resolve(fakeConnectBundle('nbunksec1rehydrated'))
})
mock.module('@/lib/nostr/nostr-connect-session', () => ({ rehydrateNostrConnectSession: mockRehydrate }))

// Bunker-connect double — auth.loginWithNip46 consumes its bundle.
const mockConnectBunker = mock((_bunkerUrl: string, _options?: unknown) => Promise.resolve(fakeConnectBundle('nbunksec1fresh')))
mock.module('@/lib/nostr/nostr-connect-signer', () => ({ connectBunkerSigner: mockConnectBunker }))

import { authActions, authStore, NOSTR_AUTO_LOGIN, NOSTR_CONNECT_KEY, NOSTR_LOCAL_SIGNER_KEY } from '@/lib/stores/auth'
import { hasLegacyPlaintextSession, hasVaultedSession, unlockVault, VAULT_STORAGE_KEY } from '@/lib/nostr/session-vault'
import { runSignerTeardown, setSignerCapability, setSignerTeardown } from '@/lib/nostr/signer-registry'
import { createPasswordSignerSession, PasswordSignerLockedError } from '@/lib/nostr/password-signer-session'

const TEST_ITERATIONS = 1_000

const LEGACY_REMOTE_PUBKEY = 'cc'.repeat(32)
const LEGACY_CLIENT_KEY = 'dd'.repeat(32)
const LEGACY_RELAY = 'wss://relay.example.com'
const LEGACY_BUNKER_URL = `bunker://${LEGACY_REMOTE_PUBKEY}?relay=${LEGACY_RELAY}&secret=hunter2`
/** The bundle shape `connectBunkerSigner` / `rehydrateNostrConnectSession` return. */
function fakeConnectBundle(nbunksec: string) {
	return {
		signer: {
			getNbunksec: () => nbunksec,
			logout: mock(() => {}),
		},
		capability: {
			getPublicKey: mock(() => Promise.resolve(USER_PUBKEY)),
			signEvent: mock(() => Promise.reject(new Error('not used'))),
		},
		clientKeyHex: LEGACY_CLIENT_KEY,
	}
}

const realLocalStorage = globalThis.localStorage
const memoryStorage = new Map<string, string>()

beforeEach(() => {
	authStore.setState(() => ({
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
		needsMigration: false,
		needsSessionUnlock: false,
	}))
	memoryStorage.clear()
	rehydratedSessions.length = 0
	mockRehydrate.mockClear()
	mockConnectBunker.mockClear()
	mockNdkActions.setSigner.mockClear()
	mockNdkActions.removeSigner.mockClear()
	mockCartActions.clear.mockClear()
	setSignerCapability(undefined)
	setSignerTeardown(undefined)
	globalThis.localStorage = {
		getItem: (key: string) => memoryStorage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			memoryStorage.set(key, value)
		},
		removeItem: (key: string) => {
			memoryStorage.delete(key)
		},
		clear: () => {
			memoryStorage.clear()
		},
	} as unknown as Storage
})

afterEach(() => {
	globalThis.localStorage = realLocalStorage
	void runSignerTeardown()
})

async function seedVault(nbunksec: string, passphrase: string): Promise<void> {
	const { saveVaultedSession } = await import('@/lib/nostr/session-vault')
	await saveVaultedSession(nbunksec, passphrase, { iterations: TEST_ITERATIONS })
	memoryStorage.set(NOSTR_AUTO_LOGIN, 'true')
}

/** Build a real ncryptsec via PasswordSigner.fromPrivateKey (test key). */
async function makeNcryptsec(password: string): Promise<string> {
	const { PasswordSigner } = await import('applesauce-signers')
	const signer = await PasswordSigner.fromPrivateKey('ee'.repeat(32), password)
	if (!signer.ncryptsec) throw new Error('ncryptsec missing')
	return signer.ncryptsec
}

describe('boot: legacy plaintext gate (read ONCE)', () => {
	test('legacy pair → needsSessionUnlock, no silent plaintext login', async () => {
		memoryStorage.set(NOSTR_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		memoryStorage.set(NOSTR_CONNECT_KEY, LEGACY_BUNKER_URL)
		memoryStorage.set(NOSTR_AUTO_LOGIN, 'true')

		await authActions.getAuthFromLocalStorageAndLogin()

		expect(authStore.state.needsSessionUnlock).toBe(true)
		expect(authStore.state.isAuthenticated).toBe(false)
		// The plaintext pair survives ONLY until the user answers the prompt.
		expect(hasLegacyPlaintextSession()).toBe(true)
		expect(hasVaultedSession()).toBe(false)
		expect(rehydratedSessions).toHaveLength(0)
	})

	test('vaulted session + auto-login → unlock prompt state, vault intact', async () => {
		await seedVault('nbunksec1stored', 'pass')

		await authActions.getAuthFromLocalStorageAndLogin()

		expect(authStore.state.needsSessionUnlock).toBe(true)
		expect(hasVaultedSession()).toBe(true)
	})

	test('no session at all → no unlock prompt', async () => {
		await authActions.getAuthFromLocalStorageAndLogin()
		expect(authStore.state.needsSessionUnlock).toBe(false)
	})
})

describe('unlock: migrate + rehydrate', () => {
	test('migrate-on-unlock wraps legacy session, deletes plaintext, rehydrates signer', async () => {
		memoryStorage.set(NOSTR_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		memoryStorage.set(NOSTR_CONNECT_KEY, LEGACY_BUNKER_URL)

		await authActions.unlockVaultedSession('chosen-pass', { iterations: TEST_ITERATIONS })

		// Vault written + legacy plaintext gone.
		expect(hasVaultedSession()).toBe(true)
		expect(hasLegacyPlaintextSession()).toBe(false)
		// The signer rehydrated from the wrapped nbunksec.
		expect(rehydratedSessions).toHaveLength(1)
		const { decodeNbunksec } = await import('applesauce-signers/helpers')
		const info = decodeNbunksec(rehydratedSessions[0])
		expect(info.local_key).toBe(LEGACY_CLIENT_KEY)
		// Auth state is signed in.
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(authStore.state.needsSessionUnlock).toBe(false)
	})

	test('unlock of a vaulted session rehydrates without legacy keys', async () => {
		await seedVault('nbunksec1vaulted', 'pass')

		await authActions.unlockVaultedSession('pass', { iterations: TEST_ITERATIONS })

		expect(rehydratedSessions).toEqual(['nbunksec1vaulted'])
		expect(authStore.state.isAuthenticated).toBe(true)
	})

	test('wrong passphrase fails closed: no rehydrate, no migration, prompt stays', async () => {
		await seedVault('nbunksec1vaulted', 'right-pass')
		authStore.setState((state) => ({ ...state, needsSessionUnlock: true }))

		await expect(authActions.unlockVaultedSession('wrong', { iterations: TEST_ITERATIONS })).rejects.toThrow()

		expect(rehydratedSessions).toHaveLength(0)
		expect(hasVaultedSession()).toBe(true)
		expect(authStore.state.isAuthenticated).toBe(false)
		expect(authStore.state.needsSessionUnlock).toBe(true)
	})
})

describe('refuse-migration-logout', () => {
	test('discard deletes plaintext, writes no vault, logs out', () => {
		memoryStorage.set(NOSTR_LOCAL_SIGNER_KEY, LEGACY_CLIENT_KEY)
		memoryStorage.set(NOSTR_CONNECT_KEY, LEGACY_BUNKER_URL)
		memoryStorage.set(NOSTR_AUTO_LOGIN, 'true')
		authStore.setState((state) => ({ ...state, needsSessionUnlock: true }))

		authActions.discardVaultedSession()

		expect(hasLegacyPlaintextSession()).toBe(false)
		expect(hasVaultedSession()).toBe(false)
		expect(memoryStorage.has(NOSTR_AUTO_LOGIN)).toBe(false)
		expect(authStore.state.needsSessionUnlock).toBe(false)
		expect(authStore.state.isAuthenticated).toBe(false)
	})
})

describe('loginWithNip46 persistence', () => {
	test('with a session passphrase → vault only, never the plaintext pair', async () => {
		await authActions.loginWithNip46(LEGACY_BUNKER_URL, undefined, {
			sessionPassphrase: 'device-pass',
			vaultIterations: TEST_ITERATIONS,
		})

		expect(hasVaultedSession()).toBe(true)
		expect(memoryStorage.has(NOSTR_LOCAL_SIGNER_KEY)).toBe(false)
		expect(memoryStorage.has(NOSTR_CONNECT_KEY)).toBe(false)
		// The vault unwraps to the session's nbunksec.
		await expect(unlockVault(undefined, 'device-pass')).resolves.toBe('nbunksec1fresh')
	})

	test('without a passphrase → nothing persisted at all (in-memory session)', async () => {
		await authActions.loginWithNip46(LEGACY_BUNKER_URL, undefined)

		expect(hasVaultedSession()).toBe(false)
		expect(memoryStorage.has(NOSTR_LOCAL_SIGNER_KEY)).toBe(false)
		expect(memoryStorage.has(NOSTR_CONNECT_KEY)).toBe(false)
	})
})

describe('logout clears the vault (lock-on-logout)', () => {
	test('logout removes the vaulted session', async () => {
		await seedVault('nbunksec1stored', 'pass')

		authActions.logout()

		expect(hasVaultedSession()).toBe(false)
		expect(memoryStorage.has(VAULT_STORAGE_KEY)).toBe(false)
	})
})

describe('PasswordSigner locked-deadlock guard (gap 4)', () => {
	test('locked signer: capability calls reject fast with PasswordSignerLockedError', async () => {
		const session = await createPasswordSignerSession(await makeNcryptsec('ncrypt-pass'), 'ncrypt-pass')
		session.lock()

		await expect(session.capability.getPublicKey()).rejects.toThrow(PasswordSignerLockedError)
		await expect(session.capability.signEvent({ kind: 1, content: 'x', tags: [], created_at: 1 })).rejects.toThrow(
			PasswordSignerLockedError,
		)
	})

	test('unlocked signer: round-trip sign works through the capability', async () => {
		const session = await createPasswordSignerSession(await makeNcryptsec('ncrypt-pass'), 'ncrypt-pass')
		const pubkey = await session.capability.getPublicKey()
		const signed = await session.capability.signEvent({ kind: 1, content: 'hello', tags: [], created_at: 1 })
		expect(signed.pubkey).toBe(pubkey)
	})
})
