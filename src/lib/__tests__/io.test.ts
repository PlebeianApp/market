/**
 * Wave 0 seam tests: verifies the adapter-swap mechanism and pass-through
 * delegation, plus conformance AND behaviour of both real adapters (NDK bridge
 * and applesauce). Relay round-trip behaviour is exercised in Wave A1 against
 * the local nak relay; these tests pin the in-process contract and edge cases.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

// Stub the NDK singleton so `io-ndk.ts` loads without the full NDK graph.
// These handles are mutable so adapter-behaviour tests can reconfigure the
// store/actions per case (e.g. flip ndk on/off, return a present user).
const stubRawEvent = {
	id: 'evt-1',
	pubkey: 'pk-1',
	created_at: 1,
	kind: 1,
	tags: [],
	content: 'hello',
	sig: 'sig-1',
}
const stubRawEvent2 = { ...stubRawEvent, id: 'evt-2' }
const stubNdkEvent = { rawEvent: () => stubRawEvent }

const mockNdkStore = {
	state: {
		ndk: null as { subscribe: (filter: unknown, opts: unknown) => { stop: () => void } } | null,
		explicitRelayUrls: [] as string[],
	},
}
const mockNdkActions = {
	fetchEventsWithTimeout: mock(async () => new Set([stubNdkEvent])),
	publishEvent: mock(async () => new Set(['wss://relay.example'])),
	getSigner: () => undefined,
	getUser: mock(async () => null as { pubkey: string } | null),
}

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: mockNdkActions,
	ndkStore: mockNdkStore,
}))

// Controllable RelayPool stub for the applesauce adapter. The adapter caches a
// single pool instance (`let pool`), so the controllers below are module-level
// bindings the cached instance reads through its closures — reassigning them
// reconfigures behaviour for the next call without recreating the pool.
type ReqHandlers = { next: (e: typeof stubRawEvent) => void; complete: () => void; error: (e: unknown) => void }
let poolRequestController = (_h: ReqHandlers, _urls: string[], _filters: unknown): { unsubscribe: () => void } => ({
	unsubscribe: () => {},
})
let poolSubscriptionController = (
	_cb: (msg: unknown) => void,
	_urls: string[],
	_filters: unknown,
	_opts: unknown,
): { unsubscribe: () => void } => ({ unsubscribe: () => {} })
let poolPublishController = async (_urls: string[], _event: unknown): Promise<unknown> => undefined

mock.module('applesauce-relay', () => ({
	RelayPool: class MockRelayPool {
		request = (urls: string[], filters: unknown) => ({
			subscribe: (h: ReqHandlers) => poolRequestController(h, urls, filters),
		})
		subscription = (urls: string[], filters: unknown, opts: unknown) => ({
			subscribe: (cb: (msg: unknown) => void) => poolSubscriptionController(cb, urls, filters, opts),
		})
		publish = async (urls: string[], event: unknown) => poolPublishController(urls, event)
	},
}))

import { applesauceIo } from '../nostr/io-applesauce'
import { ndkIo } from '../nostr/io-ndk'
import { type NostrIo, fetchEvents, getNostrIo, getUser, publish, setNostrIo, sign, subscribe } from '../nostr/io'

const IO_METHODS = ['fetchEvents', 'subscribe', 'publish', 'sign', 'getUser'] as const

function makeStubIo(overrides: Partial<NostrIo> = {}): NostrIo {
	return {
		fetchEvents: mock(async () => []),
		subscribe: mock(() => () => {}),
		publish: mock(async () => {}),
		sign: mock(async () => ({}) as never),
		getUser: mock(async () => null),
		...overrides,
	}
}

function resetNdkState() {
	mockNdkStore.state.ndk = null
	mockNdkStore.state.explicitRelayUrls = []
	mockNdkActions.getUser.mockImplementation(async () => null)
	mockNdkActions.fetchEventsWithTimeout.mockImplementation(async () => new Set([stubNdkEvent]))
	mockNdkActions.fetchEventsWithTimeout.mockClear()
	mockNdkActions.publishEvent.mockClear()
}

describe('nostr io seam', () => {
	test('both adapters conform to the NostrIo contract', () => {
		for (const adapter of [ndkIo, applesauceIo]) {
			for (const method of IO_METHODS) {
				expect(typeof adapter[method]).toBe('function')
			}
		}
	})

	test('default adapter is the NDK bridge', () => {
		expect(getNostrIo()).toBe(ndkIo)
	})

	test('seam re-exports both adapters for per-module selection without disturbing the global default', async () => {
		// A module that has flipped (e.g. orders relay reads, Wave A1b) imports
		// applesauceIo through the seam and calls it directly, so the global
		// default stays NDK-backed until Wave D. One import swap = one revert.
		const seam = await import('../nostr/io')
		expect(seam.applesauceIo).toBe(applesauceIo)
		expect(seam.ndkIo).toBe(ndkIo)
		expect(getNostrIo()).toBe(ndkIo)
	})

	test('setNostrIo swaps the active adapter', () => {
		const stub = makeStubIo()
		setNostrIo(stub)
		expect(getNostrIo()).toBe(stub)
		// restore default for the rest of the suite
		setNostrIo(ndkIo)
		expect(getNostrIo()).toBe(ndkIo)
	})

	test('pass-throughs delegate to the active adapter', async () => {
		const stub = makeStubIo({
			fetchEvents: mock(async () => [stubRawEvent]),
			subscribe: mock(() => () => {}),
			publish: mock(async () => {}),
			sign: mock(async () => stubRawEvent as never),
			getUser: mock(async () => ({ pubkey: 'pk-stub' })),
		})
		setNostrIo(stub)

		await expect(fetchEvents({ kinds: [1] })).resolves.toEqual([stubRawEvent])
		expect(stub.fetchEvents).toHaveBeenCalledTimes(1)

		const stop = subscribe({ kinds: [1] }, () => {})
		expect(stub.subscribe).toHaveBeenCalledTimes(1)
		stop()

		await publish(stubRawEvent as never)
		expect(stub.publish).toHaveBeenCalledTimes(1)

		await expect(sign({ kind: 1, content: 'c', tags: [], created_at: 1 })).resolves.toBe(stubRawEvent)
		expect(stub.sign).toHaveBeenCalledTimes(1)

		await expect(getUser()).resolves.toEqual({ pubkey: 'pk-stub' })
		expect(stub.getUser).toHaveBeenCalledTimes(1)

		setNostrIo(ndkIo)
	})

	test('NDK bridge maps fetchEvents results to raw events', async () => {
		const events = await ndkIo.fetchEvents({ kinds: [1] })
		expect(events).toEqual([stubRawEvent])
	})
})

describe('ndk bridge adapter (io-ndk)', () => {
	afterEach(resetNdkState)

	test('subscribe is a no-op when NDK is not initialized', () => {
		mockNdkStore.state.ndk = null
		const stop = ndkIo.subscribe({ kinds: [1] }, () => {})
		// Returns a callable teardown that does nothing; calling it must not throw.
		expect(typeof stop).toBe('function')
		expect(() => stop()).not.toThrow()
	})

	test('subscribe relays converted raw events and closeOnEose defaults to false', () => {
		const stopFn = mock(() => {})
		mockNdkStore.state.ndk = {
			subscribe: mock((filter, opts) => {
				// Default closeOnEose must be false per the SubscribeOptions contract.
				expect((opts as { closeOnEose: boolean }).closeOnEose).toBe(false)
				;(opts as { onEvent: (e: unknown) => void }).onEvent(stubNdkEvent)
				return { stop: stopFn }
			}),
		}

		const seen: unknown[] = []
		const stop = ndkIo.subscribe({ kinds: [1] }, (event) => seen.push(event))

		// NDKEvent -> raw conversion happened in-flight.
		expect(seen).toEqual([stubRawEvent])
		stop()
		expect(stopFn).toHaveBeenCalledTimes(1)
	})

	test('publish throws "NDK not initialized" when the singleton is absent', async () => {
		mockNdkStore.state.ndk = null
		await expect(ndkIo.publish(stubRawEvent as never)).rejects.toThrow('NDK not initialized')
		expect(mockNdkActions.publishEvent).not.toHaveBeenCalled()
	})

	test('sign throws "NDK not initialized" without an NDK instance', async () => {
		mockNdkStore.state.ndk = null
		await expect(ndkIo.sign({ kind: 1, content: 'c', tags: [], created_at: 1 })).rejects.toThrow('NDK not initialized')
	})

	test('sign throws "No signer available" when NDK is present but no signer', async () => {
		mockNdkStore.state.ndk = {} as never
		await expect(ndkIo.sign({ kind: 1, content: 'c', tags: [], created_at: 1 })).rejects.toThrow('No signer available')
	})

	test('getUser maps a present user to { pubkey } and null otherwise', async () => {
		mockNdkActions.getUser.mockImplementation(async () => ({ pubkey: 'pk-present' }))
		await expect(ndkIo.getUser()).resolves.toEqual({ pubkey: 'pk-present' })

		mockNdkActions.getUser.mockImplementation(async () => null)
		await expect(ndkIo.getUser()).resolves.toBeNull()
	})
})

describe('applesauce adapter (io-applesauce)', () => {
	afterEach(resetNdkState)

	test('fetchEvents resolves [] when no relays are configured (short-circuit)', async () => {
		mockNdkStore.state.explicitRelayUrls = []
		await expect(applesauceIo.fetchEvents({ kinds: [1] })).resolves.toEqual([])
	})

	test('fetchEvents collects events until the observable completes', async () => {
		// Explicit relay override exercises the relay pool path without the store.
		poolRequestController = (h) => {
			h.next(stubRawEvent)
			h.next(stubRawEvent2)
			h.complete()
			return { unsubscribe: () => {} }
		}
		const events = await applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: ['wss://relay.example'] })
		expect(events).toEqual([stubRawEvent, stubRawEvent2])
	})

	test('fetchEvents rejects when the observable errors', async () => {
		poolRequestController = (h) => {
			h.error(new Error('relay down'))
			return { unsubscribe: () => {} }
		}
		await expect(applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: ['wss://relay.example'] })).rejects.toThrow('relay down')
	})

	test('fetchEvents returns whatever was collected before the timeout elapses', async () => {
		poolRequestController = (h) => {
			// One event arrives, but the observable never completes -> timeout must fire.
			h.next(stubRawEvent)
			return { unsubscribe: mock(() => {}) }
		}
		const events = await applesauceIo.fetchEvents(
			{ kinds: [1] },
			{
				relayUrls: ['wss://relay.example'],
				timeoutMs: 15,
			},
		)
		expect(events).toEqual([stubRawEvent])
	})

	test('subscribe is a no-op when no relays are configured (short-circuit)', () => {
		mockNdkStore.state.explicitRelayUrls = []
		const stop = applesauceIo.subscribe({ kinds: [1] }, () => {})
		expect(typeof stop).toBe('function')
		expect(() => stop()).not.toThrow()
	})

	test('subscribe forwards relay events, skips EOSE markers, and stop() unsubscribes', () => {
		const unsubscribe = mock(() => {})
		poolSubscriptionController = (cb) => {
			cb(stubRawEvent)
			cb('EOSE') // control marker — must be filtered out, not handed to onEvent
			cb(stubRawEvent2)
			return { unsubscribe }
		}
		const seen: unknown[] = []
		const stop = applesauceIo.subscribe({ kinds: [1] }, (e) => seen.push(e), { relayUrls: ['wss://relay.example'] })

		expect(seen).toEqual([stubRawEvent, stubRawEvent2])
		stop()
		expect(unsubscribe).toHaveBeenCalledTimes(1)
	})

	test('publish throws when no relays are configured', async () => {
		mockNdkStore.state.explicitRelayUrls = []
		await expect(applesauceIo.publish(stubRawEvent as never)).rejects.toThrow('No relays configured for publish')
	})

	test('publish forwards the event to the relay pool when relays are configured', async () => {
		mockNdkStore.state.explicitRelayUrls = ['wss://relay.example']
		poolPublishController = mock(async () => undefined)
		await applesauceIo.publish(stubRawEvent as never)
		expect(poolPublishController).toHaveBeenCalledWith(['wss://relay.example'], stubRawEvent)
	})

	test('sign throws the explicit Wave A3 not-wired error', async () => {
		await expect(applesauceIo.sign({ kind: 1, content: 'c', tags: [], created_at: 1 })).rejects.toThrow(
			'applesauceIo.sign is not wired until Wave A3',
		)
	})

	test('getUser delegates to the NDK bridge (signer not migrated yet)', async () => {
		mockNdkActions.getUser.mockImplementation(async () => ({ pubkey: 'pk-delegated' }))
		await expect(applesauceIo.getUser()).resolves.toEqual({ pubkey: 'pk-delegated' })
	})

	test('explicit relayUrls override wins; an empty override falls back to the store', async () => {
		// Override wins over the (empty) store configuration.
		let captured: string[] = []
		poolRequestController = (h, urls) => {
			captured = urls
			h.complete()
			return { unsubscribe: () => {} }
		}
		await applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: ['wss://override'] })
		expect(captured).toEqual(['wss://override'])

		// An empty override must NOT short-circuit to [] — it falls back to the store.
		mockNdkStore.state.explicitRelayUrls = ['wss://from-store']
		await applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: [] })
		expect(captured).toEqual(['wss://from-store'])
	})
})

describe('seam pass-through option forwarding', () => {
	afterEach(() => setNostrIo(ndkIo))

	test('fetchEvents forwards filter and opts to the active adapter', async () => {
		const fetchFn = mock(async () => [])
		setNostrIo(makeStubIo({ fetchEvents: fetchFn }))
		await fetchEvents({ kinds: [1] }, { timeoutMs: 500, relayUrls: ['wss://x'] })
		expect(fetchFn).toHaveBeenCalledWith({ kinds: [1] }, { timeoutMs: 500, relayUrls: ['wss://x'] })
	})

	test('subscribe forwards filter, callback, and opts to the active adapter', () => {
		const subFn = mock(() => () => {})
		setNostrIo(makeStubIo({ subscribe: subFn }))
		const cb = () => {}
		subscribe([{ kinds: [1] }, { kinds: [4] }], cb, { closeOnEose: true, relayUrls: ['wss://x'] })
		expect(subFn).toHaveBeenCalledWith([{ kinds: [1] }, { kinds: [4] }], cb, { closeOnEose: true, relayUrls: ['wss://x'] })
	})

	test('publish forwards the event and opts to the active adapter', async () => {
		const pubFn = mock(async () => {})
		setNostrIo(makeStubIo({ publish: pubFn }))
		await publish(stubRawEvent as never, { relayUrls: ['wss://x'] })
		expect(pubFn).toHaveBeenCalledWith(stubRawEvent, { relayUrls: ['wss://x'] })
	})
})
