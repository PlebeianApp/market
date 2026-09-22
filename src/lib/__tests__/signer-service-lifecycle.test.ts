import { beforeEach, describe, expect, mock, test } from 'bun:test'

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

const storage = new Map<string, string>()

let relayFetchImpl: (pubkey: string) => Promise<Array<{ url: string }>> = async () => []
let walletFetchImpl: (pubkey: string) => Promise<unknown[]> = async () => []
let balanceFetchImpl: (uri: string) => Promise<{ balance: number } | null> = async () => null

const fetchUserRelayListWithPreferences = mock((pubkey: string) => relayFetchImpl(pubkey))
const fetchUserNwcWallets = mock((pubkey: string) => walletFetchImpl(pubkey))
const fetchNwcWalletBalance = mock((uri: string) => balanceFetchImpl(uri))

mock.module('@/queries/relay-list', () => ({ fetchUserRelayListWithPreferences }))
mock.module('@/queries/wallet', () => ({ fetchUserNwcWallets, fetchNwcWalletBalance }))

interface FakeWalletRecord {
	id: string
	name: string
	nwcUri: string
	pubkey: string
	relays: string[]
	storedOnNostr: boolean
	createdAt: number
	updatedAt: number
}

interface FakeWalletState {
	wallets: FakeWalletRecord[]
	isLoading: boolean
	isInitialized: boolean
}

interface FakeWalletStore {
	state: FakeWalletState
	setState: (updater: (state: FakeWalletState) => FakeWalletState) => void
}

const walletState: FakeWalletStore = {
	state: { wallets: [], isLoading: false, isInitialized: false },
	setState(updater) {
		walletState.state = updater(walletState.state)
	},
}

let walletInitializeImpl: () => Promise<void> = async () => {
	walletState.setState((state) => ({ ...state, isInitialized: true, isLoading: false }))
}

const walletActions = {
	initialize: mock(() => walletInitializeImpl()),
	setNostrWallets: mock((wallets: FakeWalletRecord[]) => {
		const merged = [...walletState.state.wallets]
		for (const wallet of wallets) {
			const index = merged.findIndex((candidate) => candidate.id === wallet.id)
			if (index >= 0) merged[index] = wallet
			else merged.push(wallet)
		}
		storage.set('nwc_wallets', JSON.stringify(merged))
		walletState.setState((state) => ({ ...state, wallets: merged }))
	}),
	getWallets: mock(() => walletState.state.wallets),
}

mock.module('@/lib/stores/wallet', () => ({ walletActions, walletStore: walletState }))

type WalletEventName = 'balance_updated' | 'status_changed'

let walletFromImpl: (event: unknown) => Promise<FakeCashuWallet | null>
let walletStartImpl: (wallet: FakeCashuWallet) => Promise<void>
let consolidateImpl: (wallet: FakeCashuWallet) => Promise<void>
let transactionFetchImpl: (wallet: FakeCashuWallet) => Promise<Array<{ id: string; direction: string }>>
let walletMints: string[] = []
const constructedWallets: FakeCashuWallet[] = []

class FakeCashuWallet {
	static from = mock((event: unknown) => walletFromImpl(event))
	static create = mock(async () => ({}))

	readonly ndk: unknown
	relaySet: unknown
	mints = [...walletMints]
	mintBalances: Record<string, number> = {}
	readonly listeners = new Map<WalletEventName, Array<(value?: unknown) => void>>()
	readonly state = { dump: () => ({ totalBalance: 0, balances: {} }) }
	readonly start = mock(async () => walletStartImpl(this))
	readonly stop = mock(() => {})
	readonly removeAllListeners = mock(() => this.listeners.clear())
	readonly consolidateTokens = mock(async () => consolidateImpl(this))
	readonly fetchTransactions = mock(async () => transactionFetchImpl(this))
	readonly subscribeTransactions = mock((_callback: (tx: { id: string; direction: string }) => void) => mock(() => {}))

	constructor(ndk: unknown) {
		this.ndk = ndk
		constructedWallets.push(this)
	}

	on(event: WalletEventName, callback: (value?: unknown) => void) {
		const listeners = this.listeners.get(event) ?? []
		listeners.push(callback)
		this.listeners.set(event, listeners)
	}

	emit(event: WalletEventName, value?: unknown) {
		for (const listener of this.listeners.get(event) ?? []) listener(value)
	}
}

const ndkWalletModule = `${['@nostr', 'dev-kit'].join('-')}/wallet`
mock.module(ndkWalletModule, () => ({
	NDKCashuWallet: FakeCashuWallet,
	NDKCashuDeposit: class {},
	NDKWalletStatus: { READY: 'ready', FAILED: 'failed' },
}))

import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { nip60Actions, nip60Store } from '@/lib/stores/nip60'

const makeSigner = (pubkey: string) => ({ user: mock(async () => ({ pubkey })) })

function makeNdk(signer?: ReturnType<typeof makeSigner>): any {
	return {
		signer,
		addExplicitRelay: mock(() => {}),
		fetchEvent: mock(async () => null),
		pool: { relays: new Map<string, unknown>() },
	}
}

function makeNwcWallet(id: string, uri: string): FakeWalletRecord {
	return {
		id,
		name: id,
		nwcUri: uri,
		pubkey: id.padEnd(64, '0'),
		relays: [],
		storedOnNostr: true,
		createdAt: 1,
		updatedAt: 1,
	}
}

beforeEach(() => {
	nip60Actions.reset()
	storage.clear()
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key),
		},
	})

	relayFetchImpl = async () => []
	walletFetchImpl = async () => []
	balanceFetchImpl = async () => null
	walletInitializeImpl = async () => {
		walletState.setState((state) => ({ ...state, isInitialized: true, isLoading: false }))
	}
	walletFromImpl = async () => null
	walletStartImpl = async () => {}
	consolidateImpl = async () => {}
	transactionFetchImpl = async () => []
	walletMints = []
	constructedWallets.length = 0
	walletState.state = { wallets: [], isLoading: false, isInitialized: false }

	for (const fn of [
		fetchUserRelayListWithPreferences,
		fetchUserNwcWallets,
		fetchNwcWalletBalance,
		walletActions.initialize,
		walletActions.setNostrWallets,
		walletActions.getWallets,
		FakeCashuWallet.from,
	]) {
		fn.mockClear()
	}

	ndkStore.setState(() => ({
		ndk: null,
		zapNdk: null,
		isConnecting: false,
		isConnected: false,
		isZapNdkConnected: false,
		explicitRelayUrls: [],
		writeRelayUrls: [],
		activeNwcWalletUri: null,
		signer: undefined,
	}))
})

describe('signer-service session ownership', () => {
	test('a stale relay fetch cannot add A relays after logout and login B', async () => {
		const signerA = makeSigner('aa'.repeat(32))
		const signerB = makeSigner('bb'.repeat(32))
		const ndk = makeNdk(signerA)
		const relayGate = deferred<Array<{ url: string }>>()
		const fetchStarted = deferred()
		relayFetchImpl = async () => {
			fetchStarted.resolve()
			return await relayGate.promise
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))
		ndkActions.publishSigner(signerA as never)

		const pending = ndkActions.loadRelaysFromNostr()
		await fetchStarted.promise
		ndkActions.setSigner(undefined)
		ndkActions.publishSigner(signerB as never)
		relayGate.resolve([{ url: 'wss://a-only.example' }])
		await pending

		expect(ndk.addExplicitRelay).not.toHaveBeenCalledWith('wss://a-only.example')
		expect(ndkStore.state.explicitRelayUrls).not.toContain('wss://a-only.example')
		expect(ndkActions.getSigner() === (signerB as never)).toBe(true)
	})

	test('a stale remote-wallet fetch cannot merge or persist A wallets after logout', async () => {
		const signerA = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signerA)
		const walletGate = deferred<unknown[]>()
		const fetchStarted = deferred()
		walletFetchImpl = async () => {
			fetchStarted.resolve()
			return await walletGate.promise
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))
		ndkActions.publishSigner(signerA as never)

		const pending = ndkActions.selectAndSetInitialNwcWallet()
		await fetchStarted.promise
		ndkActions.setSigner(undefined)
		walletGate.resolve([makeNwcWallet('wallet-a', 'nostr+walletconnect://a')])
		await pending

		expect(walletActions.setNostrWallets).not.toHaveBeenCalled()
		expect(storage.has('nwc_wallets')).toBe(false)
		expect(ndkStore.state.activeNwcWalletUri).toBeNull()
		expect(walletState.state.isLoading).toBe(false)
	})

	test('A balance selection cannot replace B active NWC state', async () => {
		const signerA = makeSigner('aa'.repeat(32))
		const signerB = makeSigner('bb'.repeat(32))
		const ndk = makeNdk(signerA)
		const balanceGate = deferred<{ balance: number } | null>()
		const balanceStarted = deferred()
		walletFetchImpl = async () => [makeNwcWallet('wallet-a', 'nostr+walletconnect://a')]
		balanceFetchImpl = async () => {
			balanceStarted.resolve()
			return await balanceGate.promise
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))
		ndkActions.publishSigner(signerA as never)

		const pending = ndkActions.selectAndSetInitialNwcWallet()
		await balanceStarted.promise
		ndkActions.setSigner(undefined)
		ndkActions.publishSigner(signerB as never)
		ndkActions.setActiveNwcWalletUri('nostr+walletconnect://b')
		walletState.setState((state) => ({ ...state, isLoading: true }))
		balanceGate.resolve({ balance: 1000 })
		await pending

		expect(ndkStore.state.activeNwcWalletUri).toBe('nostr+walletconnect://b')
		expect(walletState.state.isLoading).toBe(true)
		expect(ndkActions.getSigner() === (signerB as never)).toBe(true)
	})

	test('A wallet initialization completion cannot clear B loading ownership', async () => {
		const signerA = makeSigner('aa'.repeat(32))
		const signerB = makeSigner('bb'.repeat(32))
		const ndk = makeNdk(signerA)
		const gateA = deferred()
		const gateB = deferred()
		const startedA = deferred()
		const startedB = deferred()
		let initializeCount = 0
		walletInitializeImpl = async () => {
			const index = initializeCount++
			if (index === 0) {
				startedA.resolve()
				await gateA.promise
			} else {
				startedB.resolve()
				await gateB.promise
			}
			walletState.setState((state) => ({ ...state, isInitialized: true, isLoading: false }))
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))
		ndkActions.publishSigner(signerA as never)

		const pendingA = ndkActions.selectAndSetInitialNwcWallet()
		await startedA.promise
		ndkActions.setSigner(undefined)
		ndkActions.publishSigner(signerB as never)
		const pendingB = ndkActions.selectAndSetInitialNwcWallet()
		await startedB.promise
		expect(walletState.state.isLoading).toBe(true)

		gateA.resolve()
		await pendingA
		expect(walletState.state.isLoading).toBe(true)
		expect(ndkActions.getSigner() === (signerB as never)).toBe(true)

		gateB.resolve()
		await pendingB
		expect(walletState.state.isLoading).toBe(false)
	})
})

describe('NIP-60 lifecycle ownership', () => {
	test('reset during wallet-event fetch leaves reset state and suppresses stale errors', async () => {
		const signer = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signer)
		const fetchGate = deferred<null>()
		const fetchStarted = deferred()
		ndk.fetchEvent = mock(async () => {
			fetchStarted.resolve()
			return await fetchGate.promise
		})
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))

		const pending = nip60Actions.initialize('aa'.repeat(32))
		await fetchStarted.promise
		nip60Actions.reset()
		fetchGate.reject(new Error('late A failure'))
		await pending

		expect(nip60Store.state.status).toBe('idle')
		expect(nip60Store.state.wallet).toBeNull()
		expect(nip60Store.state.error).toBeNull()
	})

	test('a wallet produced by stale async construction is cleaned without installation', async () => {
		const signer = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signer)
		const candidate = new FakeCashuWallet(ndk)
		const constructionGate = deferred<FakeCashuWallet | null>()
		const constructionStarted = deferred()
		ndk.fetchEvent = mock(async () => ({ id: 'wallet-event' }))
		walletFromImpl = async () => {
			constructionStarted.resolve()
			return await constructionGate.promise
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))

		const pending = nip60Actions.initialize('aa'.repeat(32))
		await constructionStarted.promise
		nip60Actions.reset()
		constructionGate.resolve(candidate)
		await pending

		expect(nip60Store.state.wallet).toBeNull()
		expect(nip60Store.state.status).toBe('idle')
		expect(candidate.stop).toHaveBeenCalledTimes(1)
		expect(candidate.removeAllListeners).toHaveBeenCalledTimes(1)
	})

	test('reset while wallet.start is pending prevents stale state and callback writes', async () => {
		const signer = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signer)
		const startGate = deferred()
		const startStarted = deferred()
		walletStartImpl = async () => {
			startStarted.resolve()
			await startGate.promise
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))

		const pending = nip60Actions.initialize('aa'.repeat(32))
		await startStarted.promise
		const candidate = constructedWallets.at(-1)!
		const balanceListeners = [...(candidate.listeners.get('balance_updated') ?? [])]
		const statusListeners = [...(candidate.listeners.get('status_changed') ?? [])]
		nip60Actions.reset()
		startGate.resolve()
		await pending
		for (const listener of balanceListeners) listener()
		for (const listener of statusListeners) listener('failed')

		expect(nip60Store.state.status).toBe('idle')
		expect(nip60Store.state.wallet).toBeNull()
		expect(nip60Store.state.balance).toBe(0)
		expect(nip60Store.state.error).toBeNull()
		expect(candidate.stop).toHaveBeenCalledTimes(1)
	})

	test('reset during transaction fetch prevents stale transactions and subscriptions', async () => {
		const signer = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signer)
		const transactionGate = deferred<Array<{ id: string; direction: string }>>()
		const transactionStarted = deferred()
		walletMints = ['https://mint.example']
		transactionFetchImpl = async () => {
			transactionStarted.resolve()
			return await transactionGate.promise
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))

		await nip60Actions.initialize('aa'.repeat(32))
		await transactionStarted.promise
		const candidate = constructedWallets.at(-1)!
		nip60Actions.reset()
		transactionGate.resolve([{ id: 'stale-tx', direction: 'in' }])
		await Promise.resolve()
		await Promise.resolve()

		expect(nip60Store.state.transactions).toEqual([])
		expect(candidate.subscribeTransactions).not.toHaveBeenCalled()
		expect(nip60Store.state.status).toBe('idle')
	})

	test('reset invalidates transaction callbacks already installed by initialization', async () => {
		const signer = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signer)
		walletMints = ['https://mint.example']
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))

		await nip60Actions.initialize('aa'.repeat(32))
		const candidate = constructedWallets.at(-1)!
		for (let index = 0; index < 4 && candidate.subscribeTransactions.mock.calls.length === 0; index += 1) {
			await Promise.resolve()
		}
		const callback = candidate.subscribeTransactions.mock.calls[0]?.[0]
		expect(callback).toBeFunction()
		nip60Actions.reset()
		callback?.({ id: 'late-callback', direction: 'in' })

		expect(nip60Store.state.transactions).toEqual([])
		expect(nip60Store.state.status).toBe('idle')
	})

	test('reset while initialization-spawned auto-cleanup is pending cannot repopulate state', async () => {
		const signer = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signer)
		const consolidateGate = deferred()
		const consolidateStarted = deferred()
		walletMints = ['https://mint.example']
		consolidateImpl = async () => {
			consolidateStarted.resolve()
			await consolidateGate.promise
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))

		await nip60Actions.initialize('aa'.repeat(32))
		await consolidateStarted.promise
		nip60Actions.reset()
		consolidateGate.resolve()
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()

		expect(nip60Store.state.wallet).toBeNull()
		expect(nip60Store.state.mints).toEqual([])
		expect(nip60Store.state.balance).toBe(0)
		expect(nip60Store.state.transactions).toEqual([])
		expect(nip60Store.state.status).toBe('idle')
	})

	test('late A completion cannot replace initialized wallet B', async () => {
		const signer = makeSigner('aa'.repeat(32))
		const ndk = makeNdk(signer)
		const startAGate = deferred()
		const startAStarted = deferred()
		let startCount = 0
		walletStartImpl = async () => {
			if (startCount++ === 0) {
				startAStarted.resolve()
				await startAGate.promise
			}
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))

		const pendingA = nip60Actions.initialize('aa'.repeat(32))
		await startAStarted.promise
		const walletA = constructedWallets.at(-1)!
		nip60Actions.reset()
		await nip60Actions.initialize('bb'.repeat(32))
		const walletB = constructedWallets.at(-1)!
		expect(walletB).not.toBe(walletA)
		startAGate.resolve()
		await pendingA
		walletA.emit('status_changed', 'failed')

		expect(nip60Store.state.wallet === (walletB as never)).toBe(true)
		expect(nip60Store.state.status).toBe('no_wallet')
		expect(nip60Store.state.error).toBeNull()
	})
})
