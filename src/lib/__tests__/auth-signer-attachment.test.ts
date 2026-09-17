import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const USER_PUBKEY = 'aa'.repeat(32)
const PRIOR_USER_PUBKEY = 'cc'.repeat(32)

let readinessError: Error | undefined
let userError: Error | undefined
let persistenceError: Error | undefined

interface Deferred<T = void> {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (error: unknown) => void
}

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

let adapterCount = 0
let readinessGates: Array<Promise<void> | undefined> = []
let readinessStarted: Array<Deferred | undefined> = []
let firstConnectGate: Promise<void> | undefined
let firstConnectStarted: Deferred | undefined
let connectCount = 0
let vaultSaveGate: Promise<void> | undefined
let vaultSaveStarted: Deferred | undefined
let afterVaultSave: (() => void) | undefined
let migrationGate: Promise<void> | undefined
let migrationStarted: Deferred | undefined

const localCapability = {
	getPublicKey: mock(async () => USER_PUBKEY),
	signEvent: mock(async () => {
		throw new Error('not used')
	}),
}

class FakeNdkSignerAdapter {
	private readonly index = adapterCount++
	constructor(readonly capability: unknown) {}
	async blockUntilReady() {
		readinessStarted[this.index]?.resolve()
		await readinessGates[this.index]
		if (readinessError) throw readinessError
	}
	async user() {
		if (userError) throw userError
		return { pubkey: USER_PUBKEY }
	}
}
mock.module('@/lib/nostr/ndk-signer-adapter', () => ({ NdkSignerAdapter: FakeNdkSignerAdapter }))

const mockCartActions = {
	reconcileRemoteCartForUser: mock(() => {}),
	clear: mock(() => {}),
}
mock.module('@/lib/stores/cart', () => ({ cartActions: mockCartActions }))
mock.module('@/queries/products', () => ({ fetchProductsByPubkey: mock(async () => []) }))
mock.module('@/components/dialogs/TermsConditionsDialog', () => ({
	hasAcceptedTerms: mock(() => true),
	TERMS_ACCEPTED_KEY: 'terms_accepted',
}))
mock.module('@/lib/stores/ui', () => ({ uiActions: { openDialog: mock(() => {}) } }))

const freshLogout = mock(async () => {})
const restoreLogout = mock(async () => {})
const makeBundle = (logout: typeof freshLogout) => ({
	signer: { logout, getNbunksec: () => 'nbunksec1test' },
	capability: localCapability,
	clientKeyHex: 'bb'.repeat(32),
})
const connectBunkerSigner = mock(async () => {
	const index = connectCount++
	if (index === 0 && firstConnectGate) {
		firstConnectStarted?.resolve()
		await firstConnectGate
	}
	return makeBundle(freshLogout)
})
const rehydrateNostrConnectSession = mock(async () => makeBundle(restoreLogout))
mock.module('@/lib/nostr/nostr-connect-signer', () => ({ connectBunkerSigner }))
mock.module('@/lib/nostr/nostr-connect-session', () => ({ rehydrateNostrConnectSession }))

const saveVaultedSession = mock(async (_nbunksec: string, _passphrase: string, _options?: unknown, assertCurrent?: () => void) => {
	expect(getSignerCapability()).toBeUndefined()
	expect(getSignerTeardown()).toBeUndefined()
	expect(ndkActions.getSigner()).toBeUndefined()
	if (persistenceError) throw persistenceError
	if (vaultSaveGate) {
		vaultSaveStarted?.resolve()
		await vaultSaveGate
	}
	assertCurrent?.()
	storage.set('nostr_session_v1', 'vault')
	afterVaultSave?.()
})
const migrateLegacySessionToVault = mock(async (_passphrase: string, _options?: unknown, assertCurrent?: () => void) => {
	if (migrationGate) {
		migrationStarted?.resolve()
		await migrationGate
	}
	assertCurrent?.()
	storage.set('nostr_session_v1', 'vault')
	storage.delete('nostr_local_signer')
	storage.delete('nostr_connect_url')
	return { nbunksec: 'nbunksec1legacy' }
})
mock.module('@/lib/nostr/session-vault', () => ({
	LEGACY_CONNECT_URL_KEY: 'nostr_connect_url',
	LEGACY_LOCAL_SIGNER_KEY: 'nostr_local_signer',
	clearVaultedSession: mock(() => void storage.delete('nostr_session_v1')),
	discardLegacySession: mock(() => {
		storage.delete('nostr_local_signer')
		storage.delete('nostr_connect_url')
	}),
	hasLegacyPlaintextSession: mock(() => storage.has('nostr_local_signer')),
	hasVaultedSession: mock(() => true),
	migrateLegacySessionToVault,
	saveVaultedSession,
	unlockVault: mock(async () => 'nbunksec1vaulted'),
}))

import { authActions, authStore } from '@/lib/stores/auth'
import {
	getSignerCapability,
	getSignerTeardown,
	runSignerTeardown,
	setSignerCapability,
	setSignerTeardown,
} from '@/lib/nostr/signer-registry'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'

const realWindow = globalThis.window
const realLocalStorage = globalThis.localStorage
const realConsoleError = console.error
const originalLoadRelays = ndkActions.loadRelaysFromNostr
const originalSelectWallet = ndkActions.selectAndSetInitialNwcWallet
const originalPublishSigner = (ndkActions as typeof ndkActions & { publishSigner?: (signer: unknown) => void }).publishSigner
const storage = new Map<string, string>()

function expectDetached() {
	expect(getSignerCapability()).toBeUndefined()
	expect(getSignerTeardown()).toBeUndefined()
	expect(ndkActions.getSigner()).toBeUndefined()
	expect(authStore.state.isAuthenticated).toBe(false)
}

function expectFullyDetached() {
	expectDetached()
	expect(authStore.state.user).toBeNull()
	expect(ndkStore.state.signer).toBeUndefined()
	expect(ndkStore.state.ndk?.signer).toBeUndefined()
	expect(ndkStore.state.zapNdk?.signer).toBeUndefined()
}

async function flushPostCommitWork(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const detachedEntryLanes = [
	{ name: 'nsec', login: () => authActions.loginWithPrivateKey('11'.repeat(32)) },
	{ name: 'NIP-07', login: () => authActions.loginWithExtension() },
	{ name: 'fresh NIP-46', login: () => authActions.loginWithNip46('bunker://entry-guard') },
	{ name: 'restored NIP-46', login: () => authActions.unlockVaultedSession('pass', { iterations: 1_000 }) },
]

beforeEach(async () => {
	await runSignerTeardown()
	setSignerCapability(undefined)
	setSignerTeardown(undefined)
	readinessError = undefined
	userError = undefined
	persistenceError = undefined
	adapterCount = 0
	readinessGates = []
	readinessStarted = []
	firstConnectGate = undefined
	firstConnectStarted = undefined
	connectCount = 0
	vaultSaveGate = undefined
	vaultSaveStarted = undefined
	afterVaultSave = undefined
	migrationGate = undefined
	migrationStarted = undefined
	freshLogout.mockClear()
	restoreLogout.mockClear()
	connectBunkerSigner.mockClear()
	rehydrateNostrConnectSession.mockClear()
	saveVaultedSession.mockClear()
	migrateLegacySessionToVault.mockClear()
	mockCartActions.reconcileRemoteCartForUser.mockClear()
	mockCartActions.clear.mockClear()
	storage.clear()
	authStore.setState(() => ({
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
		needsMigration: false,
		needsSessionUnlock: true,
	}))
	const ndk = { signer: undefined } as never
	const zapNdk = { signer: undefined } as never
	ndkStore.setState((state) => ({ ...state, ndk, zapNdk, signer: undefined, activeNwcWalletUri: null }))
	ndkActions.loadRelaysFromNostr = mock(async () => {})
	ndkActions.selectAndSetInitialNwcWallet = mock(async () => {})
	globalThis.window = { nostr: {} } as unknown as typeof window
	globalThis.localStorage = {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, value),
		removeItem: (key: string) => void storage.delete(key),
		clear: () => storage.clear(),
	} as unknown as Storage
	console.error = mock(() => {})
	expectDetached()
})

afterEach(async () => {
	console.error = realConsoleError
	globalThis.window = realWindow
	globalThis.localStorage = realLocalStorage
	ndkActions.loadRelaysFromNostr = originalLoadRelays
	ndkActions.selectAndSetInitialNwcWallet = originalSelectWallet
	if (originalPublishSigner) {
		;(ndkActions as typeof ndkActions & { publishSigner: (signer: unknown) => void }).publishSigner = originalPublishSigner
	}
	setSignerCapability(undefined)
	await runSignerTeardown()
	ndkStore.setState((state) => ({ ...state, ndk: null, zapNdk: null, signer: undefined, activeNwcWalletUri: null }))
})

describe('transactional signer authority attachment', () => {
	for (const lane of detachedEntryLanes) {
		test(`zap-only authority rejects ${lane.name} before candidate construction`, async () => {
			const occupiedSigner = { user: mock(async () => ({ pubkey: PRIOR_USER_PUBKEY })) }
			const adapterCountBefore = adapterCount
			const storageBefore = Array.from(storage.entries())
			ndkStore.state.zapNdk!.signer = occupiedSigner as never

			await expect(lane.login()).rejects.toThrow(/log out/i)

			expect(ndkStore.state.zapNdk?.signer === (occupiedSigner as never)).toBe(true)
			expect(ndkStore.state.ndk?.signer).toBeUndefined()
			expect(ndkStore.state.signer).toBeUndefined()
			expect(adapterCount).toBe(adapterCountBefore)
			expect(connectBunkerSigner).not.toHaveBeenCalled()
			expect(rehydrateNostrConnectSession).not.toHaveBeenCalled()
			expect(authStore.state.isAuthenticated).toBe(false)
			expect(authStore.state.isAuthenticating).toBe(false)
			expect(Array.from(storage.entries())).toEqual(storageBefore)
		})

		test(`store-only authority rejects ${lane.name} before candidate construction`, async () => {
			const occupiedSigner = { user: mock(async () => ({ pubkey: PRIOR_USER_PUBKEY })) }
			const adapterCountBefore = adapterCount
			const storageBefore = Array.from(storage.entries())
			ndkStore.setState((state) => ({ ...state, signer: occupiedSigner as never }))

			await expect(lane.login()).rejects.toThrow(/log out/i)

			expect(ndkStore.state.signer === (occupiedSigner as never)).toBe(true)
			expect(ndkStore.state.ndk?.signer).toBeUndefined()
			expect(ndkStore.state.zapNdk?.signer).toBeUndefined()
			expect(adapterCount).toBe(adapterCountBefore)
			expect(connectBunkerSigner).not.toHaveBeenCalled()
			expect(rehydrateNostrConnectSession).not.toHaveBeenCalled()
			expect(authStore.state.isAuthenticated).toBe(false)
			expect(authStore.state.isAuthenticating).toBe(false)
			expect(Array.from(storage.entries())).toEqual(storageBefore)
		})
	}

	const existingGuardCases = [
		{
			name: 'main signer',
			seed: (authority: unknown) => {
				ndkStore.state.ndk!.signer = authority as never
			},
			preserved: (authority: unknown) => ndkStore.state.ndk?.signer === authority,
		},
		{
			name: 'signer capability',
			seed: (authority: unknown) => setSignerCapability(authority as never),
			preserved: (authority: unknown) => getSignerCapability() === authority,
		},
		{
			name: 'signer teardown',
			seed: (authority: unknown) => setSignerTeardown(authority as never),
			preserved: (authority: unknown) => getSignerTeardown() === authority,
		},
		{
			name: 'authenticated state',
			seed: () => authStore.setState((state) => ({ ...state, isAuthenticated: true })),
			preserved: () => authStore.state.isAuthenticated,
		},
	]

	for (const guard of existingGuardCases) {
		test(`${guard.name}-only authority remains fail-closed`, async () => {
			const authority =
				guard.name === 'signer teardown'
					? mock(async () => {})
					: { getPublicKey: mock(async () => PRIOR_USER_PUBKEY), signEvent: mock(async () => ({})) }
			guard.seed(authority)
			const adapterCountBefore = adapterCount

			await expect(authActions.loginWithPrivateKey('11'.repeat(32))).rejects.toThrow(/log out/i)

			expect(guard.preserved(authority)).toBe(true)
			expect(adapterCount).toBe(adapterCountBefore)
			expect(connectBunkerSigner).not.toHaveBeenCalled()
		})
	}

	test('nsec readiness failure leaves every authority surface detached', async () => {
		readinessError = new Error('nsec readiness failed')
		await expect(authActions.loginWithPrivateKey('11'.repeat(32))).rejects.toThrow('nsec readiness failed')
		expectDetached()
	})

	test('NIP-07 readiness failure leaves every authority surface detached', async () => {
		readinessError = new Error('extension readiness failed')
		await expect(authActions.loginWithExtension()).rejects.toThrow('extension readiness failed')
		expectDetached()
	})

	test('fresh NIP-46 persistence failure never publishes authority and cleans the local signer once', async () => {
		persistenceError = new Error('vault persistence failed')
		await expect(
			authActions.loginWithNip46('bunker://test', undefined, { sessionPassphrase: 'pass', vaultIterations: 1_000 }),
		).rejects.toThrow('vault persistence failed')
		expectDetached()
		expect(freshLogout).toHaveBeenCalledTimes(1)
	})

	test('vaulted NIP-46 readiness failure cleans the local signer and stays detached', async () => {
		readinessError = new Error('restore readiness failed')
		await expect(authActions.unlockVaultedSession('pass', { minIterations: 1_000 })).rejects.toThrow('restore readiness failed')
		expectDetached()
		expect(restoreLogout).toHaveBeenCalledTimes(1)
	})

	test('a concurrent NIP-46 login is rejected before constructing its candidate and a later attempt may start', async () => {
		const gate = deferred()
		const started = deferred()
		firstConnectGate = gate.promise
		firstConnectStarted = started

		const loginA = authActions.loginWithNip46('bunker://a')
		await started.promise
		const loginB = authActions.loginWithNip46('bunker://b')
		const bOutcome = await loginB.then(
			() => 'fulfilled' as const,
			() => 'rejected' as const,
		)
		const authenticatingWhileAOwnsLease = authStore.state.isAuthenticating
		const callsBeforeAResumes = connectBunkerSigner.mock.calls.length

		gate.resolve()
		await loginA
		expect(bOutcome).toBe('rejected')
		expect(authenticatingWhileAOwnsLease).toBe(true)
		expect(callsBeforeAResumes).toBe(1)

		authActions.logout()
		const laterUser = await authActions.loginWithNip46('bunker://later')
		expect(laterUser.pubkey).toBe(USER_PUBKEY)
		expect(connectBunkerSigner).toHaveBeenCalledTimes(2)
	})

	test('logout cancels nsec private preparation without resurrection', async () => {
		const gate = deferred()
		const started = deferred()
		readinessGates = [gate.promise]
		readinessStarted = [started]
		const login = authActions.loginWithPrivateKey('11'.repeat(32))
		await started.promise
		authActions.logout()
		gate.resolve()
		await expect(login).rejects.toThrow(/cancel/i)
		expectFullyDetached()
	})

	test('logout cancels NIP-07 preparation before persistence', async () => {
		const gate = deferred()
		const started = deferred()
		readinessGates = [gate.promise]
		readinessStarted = [started]
		const login = authActions.loginWithExtension()
		await started.promise
		authActions.logout()
		gate.resolve()
		await expect(login).rejects.toThrow(/cancel/i)
		expect(storage.has('nostr_user_pubkey')).toBe(false)
		expect(storage.has('nostr_auto_login')).toBe(false)
		expectFullyDetached()
	})

	test('logout cancels fresh NIP-46 preparation and cleans its local transport once', async () => {
		const gate = deferred()
		const started = deferred()
		readinessGates = [gate.promise]
		readinessStarted = [started]
		const login = authActions.loginWithNip46('bunker://test')
		await started.promise
		authActions.logout()
		gate.resolve()
		await expect(login).rejects.toThrow(/cancel/i)
		await flushPostCommitWork()
		expect(freshLogout).toHaveBeenCalledTimes(1)
		expectFullyDetached()
	})

	test('logout cancels restored NIP-46 preparation and cleans its local transport once', async () => {
		const gate = deferred()
		const started = deferred()
		readinessGates = [gate.promise]
		readinessStarted = [started]
		const login = authActions.unlockVaultedSession('pass', { minIterations: 1_000 })
		await started.promise
		authActions.logout()
		gate.resolve()
		await expect(login).rejects.toThrow(/cancel/i)
		await flushPostCommitWork()
		expect(restoreLogout).toHaveBeenCalledTimes(1)
		expect(storage.has('nostr_auto_login')).toBe(false)
		expectFullyDetached()
	})

	test("a cancelled attempt's finally cannot clear a newer attempt's lifecycle flag", async () => {
		const gateA = deferred()
		const gateB = deferred()
		const startedA = deferred()
		const startedB = deferred()
		readinessGates = [gateA.promise, gateB.promise]
		readinessStarted = [startedA, startedB]

		const loginA = authActions.loginWithPrivateKey('11'.repeat(32))
		await startedA.promise
		authActions.logout()
		const loginB = authActions.loginWithPrivateKey('22'.repeat(32))
		await startedB.promise
		gateA.resolve()
		await expect(loginA).rejects.toThrow(/cancel/i)
		expect(authStore.state.isAuthenticating).toBe(true)

		gateB.resolve()
		const userB = await loginB
		expect(userB.pubkey).toBe(USER_PUBKEY)
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(authStore.state.isAuthenticating).toBe(false)
	})

	test('commit-time revalidation preserves an unexpected winner and cleans the stale NIP-46 candidate', async () => {
		const winnerCapability = {
			getPublicKey: mock(async () => PRIOR_USER_PUBKEY),
			signEvent: mock(async () => ({})),
		} as unknown as NonNullable<ReturnType<typeof getSignerCapability>>
		const winnerSigner = {
			user: mock(async () => ({ pubkey: PRIOR_USER_PUBKEY })),
		} as unknown as NonNullable<ReturnType<typeof ndkActions.getSigner>>
		const winnerTeardown = mock(async () => {})
		afterVaultSave = () => {
			authStore.setState((state) => ({ ...state, user: { pubkey: PRIOR_USER_PUBKEY } as never, isAuthenticated: true }))
			setSignerCapability(winnerCapability)
			setSignerTeardown(winnerTeardown)
			ndkActions.publishSigner(winnerSigner)
		}

		await expect(
			authActions.loginWithNip46('bunker://stale', undefined, { sessionPassphrase: 'pass', vaultIterations: 1_000 }),
		).rejects.toThrow(/attached|authority/i)

		expect(authStore.state.isAuthenticated).toBe(true)
		expect(authStore.state.user?.pubkey).toBe(PRIOR_USER_PUBKEY)
		expect(getSignerCapability()).toBe(winnerCapability)
		expect(getSignerTeardown()).toBe(winnerTeardown)
		expect(ndkActions.getSigner()).toBe(winnerSigner)
		expect(freshLogout).toHaveBeenCalledTimes(1)
		expect(winnerTeardown).toHaveBeenCalledTimes(0)
	})

	test('commit-time revalidation preserves zap-only authority and cleans the stale NIP-46 candidate', async () => {
		const occupiedSigner = { user: mock(async () => ({ pubkey: PRIOR_USER_PUBKEY })) }
		afterVaultSave = () => {
			ndkStore.state.zapNdk!.signer = occupiedSigner as never
		}

		await expect(
			authActions.loginWithNip46('bunker://stale-zap', undefined, { sessionPassphrase: 'pass', vaultIterations: 1_000 }),
		).rejects.toThrow(/attached|authority/i)

		expect(ndkStore.state.zapNdk?.signer === (occupiedSigner as never)).toBe(true)
		expect(ndkStore.state.ndk?.signer).toBeUndefined()
		expect(ndkStore.state.signer).toBeUndefined()
		expect(getSignerCapability()).toBeUndefined()
		expect(getSignerTeardown()).toBeUndefined()
		expect(authStore.state.isAuthenticated).toBe(false)
		expect(freshLogout).toHaveBeenCalledTimes(1)
	})

	test('commit-time revalidation preserves store-only authority and cleans the stale NIP-46 candidate', async () => {
		const occupiedSigner = { user: mock(async () => ({ pubkey: PRIOR_USER_PUBKEY })) }
		afterVaultSave = () => {
			ndkStore.setState((state) => ({ ...state, signer: occupiedSigner as never }))
		}

		await expect(
			authActions.loginWithNip46('bunker://stale-store', undefined, { sessionPassphrase: 'pass', vaultIterations: 1_000 }),
		).rejects.toThrow(/attached|authority/i)

		expect(ndkStore.state.signer === (occupiedSigner as never)).toBe(true)
		expect(ndkStore.state.ndk?.signer).toBeUndefined()
		expect(ndkStore.state.zapNdk?.signer).toBeUndefined()
		expect(getSignerCapability()).toBeUndefined()
		expect(getSignerTeardown()).toBeUndefined()
		expect(authStore.state.isAuthenticated).toBe(false)
		expect(freshLogout).toHaveBeenCalledTimes(1)
	})

	test('logout during fresh vault wrapping prevents stale vault persistence', async () => {
		const gate = deferred()
		const started = deferred()
		vaultSaveGate = gate.promise
		vaultSaveStarted = started
		const login = authActions.loginWithNip46('bunker://test', undefined, { sessionPassphrase: 'pass', vaultIterations: 1_000 })
		await started.promise
		authActions.logout()
		gate.resolve()
		await expect(login).rejects.toThrow(/cancel/i)
		expect(storage.has('nostr_session_v1')).toBe(false)
		expect(freshLogout).toHaveBeenCalledTimes(1)
		expectFullyDetached()
	})

	test('discard during legacy migration wrapping prevents every stale storage mutation', async () => {
		storage.set('nostr_local_signer', 'client-key')
		storage.set('nostr_connect_url', 'bunker://legacy')
		const gate = deferred()
		const started = deferred()
		migrationGate = gate.promise
		migrationStarted = started
		const login = authActions.unlockVaultedSession('pass', { iterations: 1_000 })
		await started.promise
		authActions.discardVaultedSession()
		gate.resolve()
		await expect(login).rejects.toThrow(/cancel/i)
		expect(storage.has('nostr_session_v1')).toBe(false)
		expect(storage.has('nostr_local_signer')).toBe(false)
		expect(storage.has('nostr_connect_url')).toBe(false)
		expectFullyDetached()
	})

	test('logout owns rejecting global teardown exactly once through the NDK detach chokepoint', async () => {
		const teardownError = new Error('remote logout failed')
		const rejectingTeardown = mock(async () => {
			throw teardownError
		})
		setSignerCapability(localCapability)
		setSignerTeardown(rejectingTeardown)
		ndkActions.publishSigner({ user: mock(async () => ({ pubkey: USER_PUBKEY })) } as never)
		authStore.setState((state) => ({ ...state, user: { pubkey: USER_PUBKEY } as never, isAuthenticated: true }))

		authActions.logout()
		await flushPostCommitWork()

		expect(rejectingTeardown).toHaveBeenCalledTimes(1)
		expect(console.error).toHaveBeenCalledWith('Failed to tear down signer session:', teardownError)
		expectFullyDetached()
	})

	test('authority publication is linearized before deferred signer services begin', async () => {
		const serviceGate = deferred()
		const serviceStarted = deferred()
		ndkActions.loadRelaysFromNostr = mock(async () => {
			serviceStarted.resolve()
			await serviceGate.promise
		})

		expectDetached()
		const login = authActions.loginWithPrivateKey('11'.repeat(32))
		await serviceStarted.promise

		const duringDeferredServices = {
			authenticated: authStore.state.isAuthenticated,
			capability: getSignerCapability(),
			ndkSigner: ndkActions.getSigner(),
		}
		const loginState = await Promise.race([
			login.then(() => 'resolved' as const),
			new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
		])
		serviceGate.resolve()
		await login

		expect(loginState).toBe('resolved')
		expect(duringDeferredServices.authenticated).toBe(true)
		expect(duringDeferredServices.capability).toBeDefined()
		expect(duringDeferredServices.ndkSigner).toBeDefined()
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(getSignerCapability()).toBe(duringDeferredServices.capability)
		expect(ndkActions.getSigner()).toBeDefined()
	})

	test('post-commit signer-service failure does not roll back a valid login', async () => {
		const serviceError = new Error('ancillary signer service failed')
		ndkActions.loadRelaysFromNostr = mock(async () => {
			throw serviceError
		})

		const user = await authActions.loginWithPrivateKey('11'.repeat(32))
		await flushPostCommitWork()

		expect(user.pubkey).toBe(USER_PUBKEY)
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(getSignerCapability()).toBeDefined()
		expect(ndkActions.getSigner()).toBeDefined()
		expect(console.error).toHaveBeenCalledWith('Failed to initialize signer services:', serviceError)
	})

	test('post-commit NIP-46 service failure retains authority and transport ownership', async () => {
		const serviceError = new Error('ancillary signer service failed')
		ndkActions.loadRelaysFromNostr = mock(async () => {
			throw serviceError
		})

		const user = await authActions.loginWithNip46('bunker://test')
		await flushPostCommitWork()

		expect(user.pubkey).toBe(USER_PUBKEY)
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(getSignerCapability()).toBe(localCapability)
		expect(ndkActions.getSigner()).toBeDefined()
		expect(getSignerTeardown()).toBeDefined()
		expect(freshLogout).toHaveBeenCalledTimes(0)
		expect(console.error).toHaveBeenCalledWith('Failed to initialize signer services:', serviceError)
	})

	test('logout during deferred signer services cannot resurrect authority', async () => {
		const serviceGate = deferred()
		const serviceStarted = deferred()
		ndkActions.loadRelaysFromNostr = mock(async () => {
			serviceStarted.resolve()
			await serviceGate.promise
		})

		const login = authActions.loginWithNip46('bunker://test')
		await serviceStarted.promise
		authActions.logout()
		const detachedAtLogout =
			!authStore.state.isAuthenticated &&
			getSignerCapability() === undefined &&
			getSignerTeardown() === undefined &&
			ndkActions.getSigner() === undefined
		const cleanupCountAtLogout = freshLogout.mock.calls.length

		serviceGate.resolve()
		await login
		await flushPostCommitWork()
		expect(detachedAtLogout).toBe(true)
		expect(cleanupCountAtLogout).toBe(1)
		expectDetached()
		expect(freshLogout).toHaveBeenCalledTimes(1)
	})

	test('a second login is rejected without altering the attached account', async () => {
		const priorCapability = {
			getPublicKey: mock(async () => PRIOR_USER_PUBKEY),
			signEvent: mock(async () => ({})),
		} as unknown as NonNullable<ReturnType<typeof getSignerCapability>>
		const priorNdkSigner = {
			user: mock(async () => ({ pubkey: PRIOR_USER_PUBKEY })),
		} as unknown as NonNullable<ReturnType<typeof ndkActions.getSigner>>
		const priorTeardown = mock(async () => {})
		authStore.setState((state) => ({ ...state, user: { pubkey: PRIOR_USER_PUBKEY } as never, isAuthenticated: true }))
		setSignerCapability(priorCapability)
		setSignerTeardown(priorTeardown)
		await ndkActions.setSigner(priorNdkSigner)

		await expect(authActions.loginWithPrivateKey('11'.repeat(32))).rejects.toThrow(/log out/i)

		expect(authStore.state.isAuthenticated).toBe(true)
		expect(authStore.state.user?.pubkey).toBe(PRIOR_USER_PUBKEY)
		expect(getSignerCapability()).toBe(priorCapability)
		expect(getSignerTeardown()).toBe(priorTeardown)
		expect(ndkActions.getSigner()).toBe(priorNdkSigner)
		expect(priorTeardown).toHaveBeenCalledTimes(0)
	})

	test('synchronous publication failure restores detached state and cleans NIP-46 exactly once', async () => {
		if (!originalPublishSigner) throw new Error('publishSigner production seam is missing')
		let failPublication = true
		;(ndkActions as typeof ndkActions & { publishSigner: (signer: unknown) => void }).publishSigner = (signer) => {
			originalPublishSigner(signer)
			if (signer && failPublication) {
				failPublication = false
				throw new Error('synchronous publication failed')
			}
		}

		await expect(authActions.loginWithNip46('bunker://test')).rejects.toThrow('synchronous publication failed')
		expectDetached()
		expect(freshLogout).toHaveBeenCalledTimes(1)
	})
})
